/**
 * Stage 03 — Purchase Order Matching
 *
 * Attempts to match the invoice to an open purchase order for the resolved supplier.
 * Behavior when no match is found is controlled by tenant settings:
 *   - 'always_create': create no_po_match exception (non-fatal)
 *   - 'auto_dismiss':  silently continue without PO match
 *   - 'notify_continue': create exception but flag as non-blocking
 *
 * This stage is never fatal — the pipeline always continues to Stage 4.
 *
 * Architecture: §2.4
 * Runtime: Deno (Supabase Edge Function)
 */

import type { PipelineContext } from '../context.ts'
import type { StageResult } from '../orchestrator.ts'
import { createException } from '../exceptions.ts'

const STAGE = 'matching_po'
/** How far back in days to search for matching POs */
const PO_SEARCH_WINDOW_DAYS = 90

interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  total_amount: number | null
  status: string
  order_date: string
  tenant_id: string
}

export async function runPOMatching(ctx: PipelineContext): Promise<StageResult> {
  console.log(JSON.stringify({
    event: 'stage_start',
    stage: STAGE,
    invoice_id: ctx.invoiceId,
    tenant_id: ctx.tenantId,
    resolved_supplier_id: ctx.resolvedSupplierId,
  }))

  // No supplier resolved → can't match PO
  if (!ctx.resolvedSupplierId) {
    console.log('[03-match-po] No supplier resolved — skipping PO match')
    ctx.poMatchId = null
    return { ok: true }
  }

  const invoiceTotal = ctx.parsedData?.total_amount ?? null
  const invoiceDate = ctx.parsedData?.invoice_date ?? new Date().toISOString().split('T')[0]

  // ── Search for open POs from this supplier ────────────────────────────────
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - PO_SEARCH_WINDOW_DAYS)

  const { data: purchaseOrders, error: poError } = await ctx.supabase
    .from('purchase_orders')
    .select('id, po_number, supplier_id, total_amount, status, order_date, tenant_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('supplier_id', ctx.resolvedSupplierId)
    .in('status', ['pending', 'sent', 'partial']) // open statuses
    .gte('order_date', windowStart.toISOString())
    .order('order_date', { ascending: false })

  if (poError) {
    console.warn('[03-match-po] Failed to query purchase_orders:', poError.message)
    // Non-fatal — treat as no match
    ctx.poMatchId = null
    return await handleNoPoMatch(ctx, invoiceTotal, invoiceDate)
  }

  const pos = (purchaseOrders ?? []) as PurchaseOrder[]

  if (pos.length === 0) {
    ctx.poMatchId = null
    return await handleNoPoMatch(ctx, invoiceTotal, invoiceDate)
  }

  // ── Find best matching PO ──────────────────────────────────────────────────
  // Primary criteria: supplier match (already filtered)
  // Secondary: closest total amount to invoice total
  // Tertiary: most recent order date

  let bestPo = pos[0]

  if (invoiceTotal !== null && pos.length > 1) {
    bestPo = pos.reduce((best, po) => {
      if (po.total_amount === null) return best
      if (best.total_amount === null) return po
      const bestDiff = Math.abs(best.total_amount - invoiceTotal)
      const currentDiff = Math.abs(po.total_amount - invoiceTotal)
      return currentDiff < bestDiff ? po : best
    }, pos[0])
  }

  // ── Check variance against tenant threshold ───────────────────────────────
  if (invoiceTotal !== null && bestPo.total_amount !== null) {
    const variancePct =
      Math.abs((invoiceTotal - bestPo.total_amount) / bestPo.total_amount) * 100

    const thresholdPct = ctx.tenantSettings.totalVarianceThresholdPct

    if (variancePct > thresholdPct) {
      // Variance too large — treat as no match
      ctx.poMatchId = null
      return await handleNoPoMatch(ctx, invoiceTotal, invoiceDate)
    }
  }

  // ── Check for existing match (idempotency) ────────────────────────────────
  const { data: existingMatch } = await ctx.supabase
    .from('order_invoice_matches')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('invoice_id', ctx.invoiceId)
    .eq('purchase_order_id', bestPo.id)
    .maybeSingle()

  if (existingMatch) {
    ctx.poMatchId = existingMatch.id
    console.log(JSON.stringify({
      event: 'po_match_existing',
      invoice_id: ctx.invoiceId,
      purchase_order_id: bestPo.id,
      match_id: existingMatch.id,
    }))
    return { ok: true }
  }

  // ── Insert new match record ───────────────────────────────────────────────
  const { data: newMatch, error: matchError } = await ctx.supabase
    .from('order_invoice_matches')
    .insert({
      tenant_id: ctx.tenantId,
      invoice_id: ctx.invoiceId,
      purchase_order_id: bestPo.id,
      match_method: 'ai',
      match_confidence: invoiceTotal !== null && bestPo.total_amount !== null
        ? Math.max(0, 1 - Math.abs(invoiceTotal - bestPo.total_amount) / Math.max(invoiceTotal, bestPo.total_amount))
        : 0.7,
      status: 'pending',
    })
    .select('id')
    .single()

  if (matchError) {
    console.error('[03-match-po] Failed to insert order_invoice_match:', matchError.message)
    ctx.poMatchId = null
    // Non-fatal
    return { ok: true }
  }

  ctx.poMatchId = newMatch.id

  console.log(JSON.stringify({
    event: 'po_matched',
    invoice_id: ctx.invoiceId,
    purchase_order_id: bestPo.id,
    po_number: bestPo.po_number,
    match_id: newMatch.id,
    invoice_total: invoiceTotal,
    po_total: bestPo.total_amount,
  }))

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handle no PO match
// ─────────────────────────────────────────────────────────────────────────────

async function handleNoPoMatch(
  ctx: PipelineContext,
  invoiceTotal: number | null,
  invoiceDate: string
): Promise<StageResult> {
  const behavior = ctx.tenantSettings.noPomatchBehavior

  if (behavior === 'auto_dismiss') {
    // Silently continue without PO match
    console.log(JSON.stringify({
      event: 'po_match_auto_dismissed',
      invoice_id: ctx.invoiceId,
      behavior,
    }))
    return { ok: true }
  }

  // 'always_create' or 'notify_continue' — create an exception
  const { data: supplier } = await ctx.supabase
    .from('suppliers')
    .select('name')
    .eq('id', ctx.resolvedSupplierId!)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  await createException(ctx, {
    type: 'no_po_match',
    message: `No matching purchase order found for ${supplier?.name ?? 'the supplier'} with invoice total ${invoiceTotal != null ? `$${invoiceTotal.toFixed(2)}` : '(unknown)'}. You can link a PO manually or confirm without one.`,
    context: {
      invoice_total: invoiceTotal,
      invoice_date: invoiceDate,
      supplier_id: ctx.resolvedSupplierId,
      supplier_name: supplier?.name ?? null,
      search_window_days: PO_SEARCH_WINDOW_DAYS,
    },
    pipelineStage: STAGE,
  })

  // 'notify_continue' is non-blocking — don't set hasBlockingExceptions
  if (behavior === 'notify_continue') {
    // Override the blocking flag set by createException
    ctx.hasBlockingExceptions = ctx.openExceptionCount > 1 // only block if there are OTHER exceptions
  }

  console.log(JSON.stringify({
    event: 'no_po_match',
    invoice_id: ctx.invoiceId,
    behavior,
    invoice_total: invoiceTotal,
  }))

  return { ok: true }
}
