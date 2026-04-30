import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

interface RouteContext {
  params: Promise<{ itemId: string }>
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await context.params
    const { itemId } = resolvedParams
    const body = await request.json()
    const {
      matched_item_id,
      match_confidence,
      match_method,
      review_notes
    } = body

    if (!matched_item_id) {
      return apiError('A matched_item_id is required to link an invoice item to inventory.')
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Verify the invoice item exists. Pull invoice_id so we can look up the
    // supplier for the alias write below (MOK-135).
    const { data: invoiceItem, error: fetchError } = await supabase
      .from('invoice_items')
      .select('id, invoice_id, item_description')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError || !invoiceItem) {
      return apiError(
        'Invoice item not found. It may have been deleted — refresh and try again.',
        404,
        'NOT_FOUND'
      )
    }

    // Verify the inventory item exists
    const { data: inventoryItem, error: inventoryError } = await supabase
      .from('inventory_items')
      .select('id, item_name, current_stock, unit_cost')
      .eq('id', matched_item_id)
      .eq('tenant_id', tenantId)
      .single()

    if (inventoryError || !inventoryItem) {
      return apiError(
        'The selected inventory item was not found. It may have been deleted — refresh the inventory list and try again.',
        404,
        'INVENTORY_ITEM_NOT_FOUND'
      )
    }

    // Update the invoice item with the match
    const { data: updatedItem, error: updateError } = await supabase
      .from('invoice_items')
      .update({
        matched_item_id,
        match_confidence: match_confidence || 1.0,
        match_method: match_method || 'manual',
        is_reviewed: true,
        review_notes
      })
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .select(`
        id,
        item_description,
        matched_item_id,
        match_confidence,
        match_method,
        is_reviewed,
        review_notes,
        inventory_items (
          id,
          item_name,
          current_stock,
          unit_cost
        )
      `)
      .single()

    if (updateError) {
      return formatApiError('match invoice item to inventory', updateError)
    }

    // MOK-135: teach the pipeline. When the admin manually re-matches an
    // invoice line, write a supplier_item_alias so future invoices from the
    // same supplier with the same description auto-match to the chosen
    // inventory row. Manual aliases are sticky — pipeline auto-aliases never
    // overwrite them (alias-service.ts:upsertAlias short-circuits on
    // source='manual').
    //
    // Failures here are non-fatal: the invoice line is correctly matched
    // either way; only the future-invoice optimization is lost. Surface as
    // a warning in the response so the UI can flag persistent issues.
    let aliasResult: { upserted: boolean; error?: string } = { upserted: false }
    if (invoiceItem.item_description?.trim()) {
      const { data: invoice } = await supabase
        .from('invoices')
        .select('supplier_id')
        .eq('id', invoiceItem.invoice_id)
        .eq('tenant_id', tenantId)
        .single()

      if (invoice?.supplier_id) {
        const { error: aliasError } = await supabase
          .from('supplier_item_aliases')
          .upsert(
            {
              tenant_id: tenantId,
              supplier_id: invoice.supplier_id,
              supplier_description: invoiceItem.item_description,
              inventory_item_id: matched_item_id,
              confidence: 1.0,
              source: 'manual',
              last_seen_invoice_id: invoiceItem.invoice_id,
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: 'tenant_id,supplier_id,supplier_description' },
          )
        if (aliasError) {
          console.warn(
            `[match] alias upsert failed for "${invoiceItem.item_description}":`,
            aliasError.message,
          )
          aliasResult = { upserted: false, error: aliasError.message }
        } else {
          aliasResult = { upserted: true }
        }
      }
    }

    console.log(
      `✅ Updated item match: ${invoiceItem.item_description} -> ${inventoryItem.item_name}` +
        (aliasResult.upserted ? ' (alias upserted)' : ''),
    )

    return NextResponse.json({
      success: true,
      data: updatedItem,
      alias: aliasResult,
      message: 'Item match updated successfully'
    })

  } catch (error) {
    return unexpectedError('match invoice item to inventory', error)
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await context.params
    const { itemId } = resolvedParams
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Remove the match from the invoice item
    const { data: updatedItem, error: updateError } = await supabase
      .from('invoice_items')
      .update({
        matched_item_id: null,
        match_confidence: null,
        match_method: null,
        is_reviewed: true,
        review_notes: 'Match removed manually'
      })
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .select('id, item_description')
      .single()

    if (updateError) {
      return formatApiError('remove invoice item match', updateError)
    }

    console.log(`✅ Removed item match for: ${updatedItem?.item_description}`)

    return NextResponse.json({
      success: true,
      message: 'Item match removed successfully'
    })

  } catch (error) {
    return unexpectedError('remove invoice item match', error)
  }
}