/**
 * Stage 05 — Auto-Confirmation
 *
 * Automatically confirms the invoice if no blocking exceptions exist.
 * If blocking exceptions are present, transitions invoice to 'pending_exceptions'
 * and updates open_exception_count.
 *
 * Architecture: §2.4
 * Runtime: Deno (Supabase Edge Function)
 */

import type { PipelineContext } from '../context.ts'
import type { StageResult } from '../orchestrator.ts'

const STAGE = 'confirming'

export async function runConfirmation(ctx: PipelineContext): Promise<StageResult> {
  console.log(JSON.stringify({
    event: 'stage_start',
    stage: STAGE,
    invoice_id: ctx.invoiceId,
    tenant_id: ctx.tenantId,
    has_blocking_exceptions: ctx.hasBlockingExceptions,
    open_exception_count: ctx.openExceptionCount,
  }))

  if (ctx.hasBlockingExceptions) {
    // Cannot auto-confirm — transition to pending_exceptions
    const { error } = await ctx.supabase
      .from('invoices')
      .update({
        status: 'pending_exceptions',
        pipeline_stage: 'completed',
        pipeline_completed_at: new Date().toISOString(),
        open_exception_count: ctx.openExceptionCount,
      })
      .eq('id', ctx.invoiceId)
      .eq('tenant_id', ctx.tenantId)

    if (error) {
      console.error('[05-confirm] Failed to set pending_exceptions status:', error.message)
      return { ok: false, fatal: false, error: error.message }
    }

    console.log(JSON.stringify({
      event: 'invoice_pending_exceptions',
      invoice_id: ctx.invoiceId,
      tenant_id: ctx.tenantId,
      open_exception_count: ctx.openExceptionCount,
    }))

    return { ok: true }
  }

  // ── No blocking exceptions — auto-confirm ────────────────────────────────
  const { error: confirmError } = await ctx.supabase
    .from('invoices')
    .update({
      status: 'confirmed',
      pipeline_stage: 'completed',
      pipeline_completed_at: new Date().toISOString(),
      open_exception_count: 0,
    })
    .eq('id', ctx.invoiceId)
    .eq('tenant_id', ctx.tenantId)

  if (confirmError) {
    console.error('[05-confirm] Failed to confirm invoice:', confirmError.message)
    return { ok: false, fatal: false, error: confirmError.message }
  }

  // ── Update PO match status if matched ────────────────────────────────────
  if (ctx.poMatchId) {
    await ctx.supabase
      .from('order_invoice_matches')
      .update({ status: 'confirmed' })
      .eq('id', ctx.poMatchId)
      .eq('tenant_id', ctx.tenantId)
  }

  // ── Update inventory costs for matched items ──────────────────────────────
  // Update unit_cost on inventory_items where price changed (if no price_variance exception)
  // Only update if pipeline had no price_variance exceptions at all
  if (!ctx.hasBlockingExceptions) {
    await updateInventoryCosts(ctx)
    // Distribute any supplier fees (delivery, shipping, etc.) to cost history
    await distributeSupplierFees(ctx)
  }

  console.log(JSON.stringify({
    event: 'invoice_confirmed',
    invoice_id: ctx.invoiceId,
    tenant_id: ctx.tenantId,
    matched_items: ctx.matchedItemCount,
    skipped_items: ctx.skippedItemCount,
  }))

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Update inventory costs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For each matched invoice item that had no open price_variance exception,
 * write the invoice price back to inventory_items.unit_cost. Keeps inventory
 * costs current without manual updates.
 *
 * MOK-133: pack-aware. invoice_items.unit_price might be the per-pack
 * price (e.g. a 4-pack croissant at $6.19) when the matched inventory item
 * has pack_size > 1. The canonical inventory.unit_cost is per-individual,
 * so we re-derive the price mode (same logic as stage 4) and divide by
 * pack_size when the invoice was per-pack. Without this, a per-pack
 * invoice would silently overwrite unit_cost to the pack price ($6.19
 * instead of $1.55), corrupting future variance checks and COGS.
 */
async function updateInventoryCosts(ctx: PipelineContext): Promise<void> {
  // Get all confirmed invoice items with matches. Pull the joined
  // inventory unit_cost + pack_size so we can re-detect the price mode.
  const { data: matchedItems, error } = await ctx.supabase
    .from('invoice_items')
    .select(
      'id, matched_item_id, unit_price, ' +
        'inventory_items:matched_item_id(unit_cost, pack_size)',
    )
    .eq('invoice_id', ctx.invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .not('matched_item_id', 'is', null)

  if (error || !matchedItems) return

  // Get invoice items that have NO open price_variance exception
  const { data: priceExceptions } = await ctx.supabase
    .from('invoice_exceptions')
    .select('invoice_item_id')
    .eq('invoice_id', ctx.invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .eq('exception_type', 'price_variance')
    .eq('status', 'open')

  const priceExceptionItemIds = new Set(
    (priceExceptions ?? []).map((e: { invoice_item_id: string }) => e.invoice_item_id),
  )

  type MatchedRow = {
    id: string
    matched_item_id: string
    unit_price: number
    inventory_items: { unit_cost: number | null; pack_size: number | null } | null
  }

  for (const item of matchedItems as MatchedRow[]) {
    if (priceExceptionItemIds.has(item.id) || !item.matched_item_id) continue

    const inv = item.inventory_items
    const invUnitCost = Number(inv?.unit_cost ?? 0)
    const invPackSize = Number(inv?.pack_size ?? 1)

    const mode = detectPriceModeForCostUpdate(item.unit_price, invUnitCost, invPackSize)
    const newUnitCost = mode === 'per_pack' ? item.unit_price / Math.max(1, invPackSize) : item.unit_price

    await ctx.supabase
      .from('inventory_items')
      .update({ unit_cost: newUnitCost })
      .eq('id', item.matched_item_id)
      .eq('tenant_id', ctx.tenantId)
  }
}

/**
 * MOK-133: same logic as stages/04-match-items.ts:detectPriceMode but
 * scoped to the cost-update decision (we only need the mode, not the
 * variance). Inlined here to avoid a cross-stage import; the math is
 * tiny and stable. Tested via 04-extract-detect-price-mode.test.ts and
 * exercised end-to-end by integration tests.
 */
function detectPriceModeForCostUpdate(
  invoiceUnitPrice: number,
  inventoryUnitCost: number,
  inventoryPackSize: number,
): 'per_unit' | 'per_pack' {
  const packSize = Math.max(1, inventoryPackSize || 1)
  if (inventoryUnitCost <= 0 || packSize === 1) return 'per_unit'

  const variancePerUnit = Math.abs(invoiceUnitPrice - inventoryUnitCost) / inventoryUnitCost
  const inventoryPackCost = inventoryUnitCost * packSize
  const variancePerPack = Math.abs(invoiceUnitPrice - inventoryPackCost) / inventoryPackCost
  return variancePerPack < variancePerUnit ? 'per_pack' : 'per_unit'
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribute supplier fees to cost history
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proportionally allocate invoice supplier fees across matched line items.
 * Records each allocation as an `invoice_fee` entry in inventory_item_cost_history.
 * This surfaces fee overhead in the cost time-series without permanently inflating unit_cost.
 */
export async function distributeSupplierFees(ctx: PipelineContext): Promise<void> {
  // Fetch invoice total_fees, fee_cogs_distributed flag, and invoice_number
  const { data: invoice } = await ctx.supabase
    .from('invoices')
    .select('id, total_fees, fee_cogs_distributed, invoice_number, suppliers(name)')
    .eq('id', ctx.invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .single()

  if (!invoice) return

  const totalFees = typeof (invoice as { total_fees?: unknown }).total_fees === 'number'
    ? (invoice as { total_fees: number }).total_fees
    : 0
  const alreadyDistributed = Boolean((invoice as { fee_cogs_distributed?: unknown }).fee_cogs_distributed)

  if (totalFees <= 0 || alreadyDistributed) return

  // Get all matched invoice items for fee weighting
  const { data: matchedItems } = await ctx.supabase
    .from('invoice_items')
    .select('id, matched_item_id, quantity, total_price')
    .eq('invoice_id', ctx.invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .not('matched_item_id', 'is', null)

  if (!matchedItems || matchedItems.length === 0) return

  const totalMatchedValue = (matchedItems as Array<{ total_price: unknown }>).reduce(
    (sum, item) => sum + Math.max(0, Number(item.total_price ?? 0)),
    0
  )
  if (totalMatchedValue <= 0) return

  type MatchedItem = { id: string; matched_item_id: string; quantity: unknown; total_price: unknown }

  const historyRows: Array<Record<string, unknown>> = []

  for (const item of matchedItems as MatchedItem[]) {
    if (!item.matched_item_id) continue

    const itemValue = Math.max(0, Number(item.total_price ?? 0))
    const feeShare = (itemValue / totalMatchedValue) * totalFees
    const roundedFeeShare = Math.round(feeShare * 10000) / 10000

    if (roundedFeeShare <= 0) continue

    // Fetch current unit_cost
    const { data: invRow } = await ctx.supabase
      .from('inventory_items')
      .select('id, unit_cost')
      .eq('id', item.matched_item_id)
      .eq('tenant_id', ctx.tenantId)
      .single()

    if (!invRow) continue

    const currentCost = Number((invRow as { unit_cost?: unknown }).unit_cost ?? 0)
    const qty = Math.max(1, Number(item.quantity ?? 1))
    const feePerUnit = Math.round((roundedFeeShare / qty) * 10000) / 10000
    if (feePerUnit <= 0) continue

    const newCost = Math.round((currentCost + feePerUnit) * 10000) / 10000

    const supplierName = (invoice as { suppliers?: { name?: string } }).suppliers?.name ?? 'Unknown Supplier'
    const invoiceNumber = (invoice as { invoice_number?: string }).invoice_number ?? ctx.invoiceId

    historyRows.push({
      tenant_id: ctx.tenantId,
      inventory_item_id: item.matched_item_id,
      previous_unit_cost: currentCost,
      new_unit_cost: newCost,
      pack_size: 1,
      source: 'invoice_fee',
      source_ref: ctx.invoiceId,
      notes: `Fee allocation from Invoice ${invoiceNumber} (${supplierName}): $${roundedFeeShare.toFixed(4)} of $${totalFees.toFixed(2)} total fees`,
      changed_by: null,
      fee_amount: roundedFeeShare,
    })
  }

  if (historyRows.length > 0) {
    const { error: insertError } = await ctx.supabase
      .from('inventory_item_cost_history')
      .insert(historyRows)

    if (insertError) {
      console.warn('[05-confirm] Failed to insert fee cost history:', insertError.message)
      return
    }

    // Mark fees as distributed on the invoice
    await ctx.supabase
      .from('invoices')
      .update({ fee_cogs_distributed: true })
      .eq('id', ctx.invoiceId)
      .eq('tenant_id', ctx.tenantId)

    console.log(JSON.stringify({
      event: 'supplier_fees_distributed',
      invoice_id: ctx.invoiceId,
      tenant_id: ctx.tenantId,
      total_fees: totalFees,
      items_allocated: historyRows.length,
    }))
  }
}
