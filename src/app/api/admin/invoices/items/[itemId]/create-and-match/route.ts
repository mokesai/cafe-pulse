import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

/**
 * MOK-125: create an inventory item directly from an invoice line and link
 * the line to it in one round trip.
 *
 * The route auto-populates as much as possible from the invoice line context
 * (unit_cost, pack_size, supplier_id, item description) so the admin only
 * needs to confirm the name + category. It also writes a manual
 * supplier_item_alias so the next invoice from the same supplier with the
 * same description auto-matches without admin intervention — closing the
 * "first time you see this product, then never again" loop.
 *
 * Body shape (all new_item_data fields optional; missing ones populate
 * from the invoice line):
 *   {
 *     new_item_data?: {
 *       name?: string                  // defaults to invoice item_description
 *       unit_cost?: number             // defaults to invoice unit_price
 *       unit_type?: string             // defaults to invoice unit_type
 *       pack_size?: number             // defaults to invoice units_per_package
 *       location?: string
 *       minimum_threshold?: number
 *       reorder_point?: number
 *       item_type?: 'supply' | 'ingredient'
 *       notes?: string
 *     }
 *   }
 */
interface NewItemData {
  name?: string
  unit_cost?: number
  unit_type?: string
  pack_size?: number
  location?: string
  minimum_threshold?: number
  reorder_point?: number
  item_type?: 'supply' | 'ingredient'
  notes?: string
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> },
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { itemId } = await context.params

    let body: { new_item_data?: NewItemData } = {}
    try {
      body = await request.json()
    } catch {
      // body is optional — every field can come from invoice line context
    }
    const newItemData: NewItemData = body.new_item_data ?? {}

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // ── Load invoice line + parent invoice for context ────────────────────────
    const { data: invoiceItem, error: itemErr } = await supabase
      .from('invoice_items')
      .select(
        'id, invoice_id, item_description, supplier_item_code, ' +
        'quantity, unit_price, total_price, package_size, unit_type, ' +
        'units_per_package',
      )
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (itemErr) {
      return formatApiError('look up invoice item', itemErr)
    }
    if (!invoiceItem) {
      return apiError('Invoice item not found.', 404, 'INVOICE_ITEM_NOT_FOUND')
    }

    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select('id, supplier_id, invoice_number')
      .eq('id', invoiceItem.invoice_id)
      .eq('tenant_id', tenantId)
      .single()

    if (invErr || !invoice) {
      return apiError('Parent invoice not found.', 404, 'INVOICE_NOT_FOUND')
    }

    // ── Build inventory_items insert: invoice line context as defaults ────────
    const itemName =
      (newItemData.name ?? invoiceItem.item_description ?? '').trim()
    if (!itemName) {
      return apiError(
        'A name for the new inventory item is required (none on the invoice line either).',
        400,
        'INVENTORY_ITEM_NAME_REQUIRED',
      )
    }

    const unitCost =
      newItemData.unit_cost ?? Number(invoiceItem.unit_price ?? 0)
    const unitType = newItemData.unit_type ?? invoiceItem.unit_type ?? 'each'
    const packSize =
      newItemData.pack_size ?? Number(invoiceItem.units_per_package ?? 1)
    const itemType = newItemData.item_type ?? 'supply'

    const auditNote =
      newItemData.notes
      ?? `Created from invoice ${invoice.invoice_number ?? invoiceItem.invoice_id} ` +
         `on ${new Date().toISOString().slice(0, 10)}.`

    // square_item_id is NOT NULL with no default. Synthesize a stable,
    // traceable identifier from the invoice line so it's clear this item
    // didn't come from Square. Square-sync code paths skip non-Square ids.
    const syntheticSquareId = `manual-inv-${itemId}`

    // ── Insert inventory_items ────────────────────────────────────────────────
    const { data: newItem, error: createErr } = await supabase
      .from('inventory_items')
      .insert({
        tenant_id: tenantId,
        square_item_id: syntheticSquareId,
        item_name: itemName,
        current_stock: 0,
        unit_cost: unitCost,
        unit_type: unitType,
        pack_size: packSize,
        supplier_id: invoice.supplier_id,
        location: newItemData.location ?? null,
        minimum_threshold: newItemData.minimum_threshold ?? 5,
        reorder_point: newItemData.reorder_point ?? 10,
        is_ingredient: itemType === 'ingredient',
        item_type: itemType,
        notes: auditNote,
      })
      .select()
      .single()

    if (createErr) {
      return formatApiError('create inventory item from invoice', createErr)
    }

    // ── Link invoice line to the new inventory item ──────────────────────────
    const { error: matchError } = await supabase
      .from('invoice_items')
      .update({
        matched_item_id: newItem.id,
        match_confidence: 1.0,
        match_method: 'manual',
        is_reviewed: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .eq('tenant_id', tenantId)

    if (matchError) {
      // Roll back the inventory item — keeps "no orphan items" invariant
      await supabase.from('inventory_items').delete().eq('id', newItem.id)
      return formatApiError('link invoice item to newly created inventory item', matchError)
    }

    // ── Upsert manual supplier_item_alias (MOK-125) ───────────────────────────
    // The whole point: next invoice with the same supplier_description
    // auto-matches in stage 4 without admin intervention. Manual aliases
    // never get overwritten by the pipeline (alias-service.ts line 100).
    let aliasId: string | null = null
    if (invoice.supplier_id && invoiceItem.item_description) {
      const { data: aliasRow, error: aliasErr } = await supabase
        .from('supplier_item_aliases')
        .upsert(
          {
            tenant_id: tenantId,
            supplier_id: invoice.supplier_id,
            supplier_description: invoiceItem.item_description,
            inventory_item_id: newItem.id,
            confidence: 1.0,
            source: 'manual',
            use_count: 1,
            last_seen_invoice_id: invoiceItem.invoice_id,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,supplier_id,supplier_description' },
        )
        .select('id')
        .single()

      if (aliasErr) {
        // Non-fatal — the inventory_item + match are already in place; the
        // admin can re-create the alias by editing the link. Log and proceed.
        console.warn(
          '[create-and-match] Failed to upsert supplier_item_alias:',
          aliasErr.message,
        )
      } else {
        aliasId = aliasRow?.id ?? null
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        inventory_item: newItem,
        invoice_item_id: itemId,
        supplier_item_alias_id: aliasId,
        message: 'Inventory item created, invoice line linked, and supplier alias recorded.',
      },
    })
  } catch (error) {
    return unexpectedError('create and match inventory item from invoice', error)
  }
}
