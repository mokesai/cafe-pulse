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
 * For each matched invoice item that had no price_variance exception,
 * update the inventory item's unit_cost to the invoice price.
 * This keeps inventory costs current without requiring manual updates.
 */
async function updateInventoryCosts(ctx: PipelineContext): Promise<void> {
  // Get all confirmed invoice items with matches
  const { data: matchedItems, error } = await ctx.supabase
    .from('invoice_items')
    .select('matched_item_id, unit_price, id')
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
    (priceExceptions ?? []).map((e: { invoice_item_id: string }) => e.invoice_item_id)
  )

  // Update costs for items without price variance exceptions
  for (const item of matchedItems as Array<{ matched_item_id: string; unit_price: number; id: string }>) {
    if (!priceExceptionItemIds.has(item.id) && item.matched_item_id) {
      await ctx.supabase
        .from('inventory_items')
        .update({ unit_cost: item.unit_price })
        .eq('id', item.matched_item_id)
        .eq('tenant_id', ctx.tenantId)
    }
  }
}
