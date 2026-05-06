import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * MOK-150 — re-validate quantity variance after a manual re-match.
 *
 * Stage 4's `checkQuantityVariance` runs once during pipeline processing,
 * looking up the PO line by the matched inventory_item_id. When the
 * operator later corrects a wrong match via the Re-match form, the new
 * matched_item_id is written but the quantity check never re-runs against
 * it. Result: invoices with corrected matches were silently auto-confirming
 * with real shortages on the books.
 *
 * This helper mirrors stage 4's quantity-variance logic for the Node-side
 * resolve route, including pack-aware normalization (per MOK-133's
 * detectPriceMode). Called after `match_item` / `create_and_match_item`
 * actions in the resolve route.
 *
 * Returns whether a variance exception was raised. Callers do not need to
 * branch on this; the function is fire-and-forget for the operator's
 * resolution flow (the new exception, if any, surfaces in the queue).
 */
export interface RematchRevalidationResult {
  raised: boolean
  variancePct?: number
  severity?: 'block' | 'info'
}

interface InvoiceItemRow {
  id: string
  invoice_id: string
  quantity: number | string | null
  unit_price: number | string | null
}
interface InventoryItemRow {
  id: string
  item_name: string
  unit_cost: number | string | null
  pack_size: number | string | null
}
interface OrderInvoiceMatchRow {
  id: string
  purchase_order_id: string | null
}
interface PoItemRow {
  id: string
  quantity_ordered: number | string | null
}

export async function checkQuantityVarianceForRematch(
  supabase: SupabaseClient,
  tenantId: string,
  invoiceItemId: string,
  newMatchedItemId: string,
): Promise<RematchRevalidationResult> {
  // Load invoice item
  const { data: invoiceItem } = await supabase
    .from('invoice_items')
    .select('id, invoice_id, quantity, unit_price')
    .eq('id', invoiceItemId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!invoiceItem) return { raised: false }
  const ii = invoiceItem as InvoiceItemRow

  // Load matched inventory item (for pack-aware mode detection + name in message)
  const { data: invItem } = await supabase
    .from('inventory_items')
    .select('id, item_name, unit_cost, pack_size')
    .eq('id', newMatchedItemId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!invItem) return { raised: false }
  const inv = invItem as InventoryItemRow

  // Find linked PO for this invoice
  const { data: oimRow } = await supabase
    .from('order_invoice_matches')
    .select('id, purchase_order_id')
    .eq('invoice_id', ii.invoice_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!oimRow || !(oimRow as OrderInvoiceMatchRow).purchase_order_id) return { raised: false }
  const oim = oimRow as OrderInvoiceMatchRow

  // Look up PO line for the new matched inventory item
  const { data: poItem } = await supabase
    .from('purchase_order_items')
    .select('id, quantity_ordered')
    .eq('purchase_order_id', oim.purchase_order_id!)
    .eq('inventory_item_id', newMatchedItemId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!poItem) return { raised: false }
  const po = poItem as PoItemRow
  if (!po.quantity_ordered) return { raised: false }

  // Pack-aware quantity normalization (mirror stage 4's detectPriceMode logic)
  const packSize = Math.max(1, Number(inv.pack_size ?? 1))
  const invUnitCost = Number(inv.unit_cost ?? 0)
  const invoiceUnitPrice = Number(ii.unit_price ?? 0)
  let mode: 'per_unit' | 'per_pack' = 'per_unit'
  if (invUnitCost > 0 && packSize > 1) {
    const variancePerUnit = Math.abs(invoiceUnitPrice - invUnitCost) / invUnitCost
    const inventoryPackCost = invUnitCost * packSize
    const variancePerPack = Math.abs(invoiceUnitPrice - inventoryPackCost) / inventoryPackCost
    mode = variancePerPack < variancePerUnit ? 'per_pack' : 'per_unit'
  }
  const invoiceQty = Number(ii.quantity ?? 0)
  const effectiveInvoiceQty = mode === 'per_pack' ? invoiceQty * packSize : invoiceQty
  const poQty = Number(po.quantity_ordered ?? 0)

  if (poQty <= 0) return { raised: false }

  const variancePct = Math.abs((effectiveInvoiceQty - poQty) / poQty) * 100
  if (variancePct === 0) return { raised: false }

  // Load tenant threshold (mirror stage 4's settings access)
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('invoice_total_variance_threshold_pct')
    .eq('id', tenantId)
    .maybeSingle()
  const thresholdPct = Number(
    (tenantRow as { invoice_total_variance_threshold_pct?: number })
      ?.invoice_total_variance_threshold_pct ?? 5,
  )
  const severity: 'block' | 'info' = variancePct > thresholdPct ? 'block' : 'info'

  // Load PO number for the message
  const { data: poRow } = await supabase
    .from('purchase_orders')
    .select('order_number')
    .eq('id', oim.purchase_order_id!)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const poNumber = (poRow as { order_number?: string } | null)?.order_number ?? 'Unknown'

  const direction = severity === 'block'
    ? `Exceeds the ${thresholdPct}% threshold.`
    : `Below the ${thresholdPct}% threshold — informational only.`
  const packNote = mode === 'per_pack'
    ? ` (invoice ${invoiceQty} packs × ${packSize} = ${effectiveInvoiceQty} units)`
    : ''

  await supabase.from('invoice_exceptions').insert({
    tenant_id: tenantId,
    invoice_id: ii.invoice_id,
    invoice_item_id: ii.id,
    exception_type: 'quantity_variance',
    severity,
    status: 'open',
    exception_message:
      `Quantity for "${inv.item_name}" differs from PO by ${variancePct.toFixed(1)}% ` +
      `(PO: ${poQty}, Invoice: ${effectiveInvoiceQty})${packNote}. ${direction} ` +
      `Raised after re-match.`,
    exception_context: {
      item_description: inv.item_name,
      inventory_item_id: inv.id,
      po_quantity: poQty,
      invoice_quantity: effectiveInvoiceQty,
      invoice_quantity_raw: invoiceQty,
      variance_pct: variancePct,
      threshold_pct: thresholdPct,
      purchase_order_id: oim.purchase_order_id,
      purchase_order_number: poNumber,
      price_mode: mode,
      pack_size: packSize,
      raised_by_rematch: true,
    },
    pipeline_stage_at_creation: 'matching_items',
  })

  return { raised: true, variancePct, severity }
}
