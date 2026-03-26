/**
 * Pipeline Orchestrator
 *
 * Coordinates all 5 pipeline stages for a single invoice.
 * Triggered by the Edge Function entry point (index.ts) on invoice INSERT.
 *
 * Idempotency:
 * - Optimistic lock: UPDATE invoices SET status='pipeline_running' WHERE status='uploaded'
 *   If this returns 0 rows, another invocation already claimed the invoice → exit.
 * - If pipeline_stage='completed', exits immediately (already done).
 *
 * Architecture: §2.4, §2.5, §2.8
 * Runtime: Deno (Supabase Edge Function)
 */

import { createClient } from '@supabase/supabase-js'
import type { PipelineContext, TenantSettings } from './context.ts'
import { runExtraction } from './stages/01-extract.ts'
import { runSupplierResolution } from './stages/02-resolve-supplier.ts'
import { runPOMatching } from './stages/03-match-po.ts'
import { runItemMatching } from './stages/04-match-items.ts'
import { runConfirmation } from './stages/05-confirm.ts'

// ============================================================
// StageResult type (imported by stages)
// ============================================================

export type StageResult =
  | { ok: true }
  | { ok: false; fatal: boolean; error: string }
// fatal=true  → halt pipeline, set invoice.status='error'
// fatal=false → create exception, continue to next stage

// ============================================================
// Main entry point
// ============================================================

export async function runInvoicePipeline(
  invoiceId: string,
  tenantId: string
): Promise<void> {
  console.log(JSON.stringify({
    event: 'pipeline_start',
    invoice_id: invoiceId,
    tenant_id: tenantId,
    timestamp: new Date().toISOString(),
  }))

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Service role client — bypasses RLS
  // All queries MUST include explicit .eq('tenant_id', tenantId) filters
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // ── Idempotency lock: claim this invoice ─────────────────────────────────
  const pipelineStartedAt = new Date().toISOString()

  const { data: claimedRows, error: claimError } = await supabase
    .from('invoices')
    .update({
      status: 'pipeline_running',
      pipeline_started_at: pipelineStartedAt,
    })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .eq('status', 'uploaded') // Only claim if still in 'uploaded' state
    .select('id, file_url, file_path, file_type, supplier_id, invoice_number, pipeline_stage')

  if (claimError) {
    console.error('[orchestrator] Failed to claim invoice:', claimError.message)
    return
  }

  if (!claimedRows || claimedRows.length === 0) {
    // Another invocation already claimed this invoice, or it's not in 'uploaded' state
    console.log(JSON.stringify({
      event: 'pipeline_skipped',
      reason: 'invoice_not_claimable',
      invoice_id: invoiceId,
      tenant_id: tenantId,
    }))
    return
  }

  const invoiceRow = claimedRows[0]

  // ── Check if already completed (idempotency) ─────────────────────────────
  if (invoiceRow.pipeline_stage === 'completed') {
    console.log(JSON.stringify({
      event: 'pipeline_skipped',
      reason: 'already_completed',
      invoice_id: invoiceId,
    }))
    return
  }

  // ── Load tenant settings ─────────────────────────────────────────────────
  let tenantSettings: TenantSettings
  try {
    tenantSettings = await loadTenantSettings(supabase, tenantId)
  } catch (err) {
    console.error('[orchestrator] Failed to load tenant settings:', err)
    await failPipeline(supabase, invoiceId, tenantId, 'Failed to load tenant settings')
    return
  }

  // ── Build PipelineContext ────────────────────────────────────────────────
  const ctx: PipelineContext = {
    invoiceId,
    tenantId,
    supabase,
    tenantSettings,
    invoice: {
      file_url: invoiceRow.file_url ?? '',
      file_path: invoiceRow.file_path ?? '',
      file_type: invoiceRow.file_type ?? 'pdf',
      supplier_id: invoiceRow.supplier_id ?? null,
      invoice_number: invoiceRow.invoice_number ?? null,
    },
    parsedData: null,
    resolvedSupplierId: null,
    poMatchId: null,
    matchedItemCount: 0,
    skippedItemCount: 0,
    openExceptionCount: 0,
    hasBlockingExceptions: false,
    pipelineStartedAt,
  }

  // Verify required invoice fields
  if (!ctx.invoice.file_url && !ctx.invoice.file_path) {
    console.error('[orchestrator] Invoice missing both file_url and file_path')
    await failPipeline(supabase, invoiceId, tenantId, 'Invoice file URL/path not set')
    return
  }

  // ── Execute pipeline stages ──────────────────────────────────────────────

  // Stage 1: Extract
  await setPipelineStage(ctx, 'extracting')
  const extractResult = await runExtraction(ctx)
  if (!extractResult.ok) {
    if (extractResult.fatal) {
      return await failPipeline(supabase, invoiceId, tenantId, extractResult.error)
    }
    // Non-fatal stop (e.g. low_extraction_confidence) — pipeline halted, invoice in pending_exceptions
    console.log(JSON.stringify({
      event: 'pipeline_halted_non_fatal',
      stage: 'extracting',
      invoice_id: invoiceId,
      reason: extractResult.error,
    }))
    return
  }

  // Stage 2: Resolve Supplier
  await setPipelineStage(ctx, 'resolving_supplier')
  const supplierResult = await runSupplierResolution(ctx)
  if (!supplierResult.ok && supplierResult.fatal) {
    return await failPipeline(supabase, invoiceId, tenantId, supplierResult.error)
  }

  // Stage 3: Match PO (never fatal)
  await setPipelineStage(ctx, 'matching_po')
  await runPOMatching(ctx)

  // Stage 4: Match Items (never fatal)
  await setPipelineStage(ctx, 'matching_items')
  await runItemMatching(ctx)

  // Stage 5: Confirm (auto-confirm or set pending_exceptions)
  await setPipelineStage(ctx, 'confirming')
  await runConfirmation(ctx)

  console.log(JSON.stringify({
    event: 'pipeline_complete',
    invoice_id: invoiceId,
    tenant_id: tenantId,
    matched_items: ctx.matchedItemCount,
    skipped_items: ctx.skippedItemCount,
    open_exceptions: ctx.openExceptionCount,
    has_blocking_exceptions: ctx.hasBlockingExceptions,
    duration_ms: Date.now() - new Date(pipelineStartedAt).getTime(),
  }))
}

// ============================================================
// Stage management helpers
// ============================================================

async function setPipelineStage(
  ctx: PipelineContext,
  stage: string
): Promise<void> {
  const { error } = await ctx.supabase
    .from('invoices')
    .update({
      pipeline_stage: stage,
      status: 'pipeline_running',
    })
    .eq('id', ctx.invoiceId)
    .eq('tenant_id', ctx.tenantId)

  if (error) {
    console.warn(`[orchestrator] Failed to set pipeline stage '${stage}':`, error.message)
    // Non-fatal — continue pipeline
  }
}

async function failPipeline(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  invoiceId: string,
  tenantId: string,
  errorMessage: string
): Promise<void> {
  console.error(JSON.stringify({
    event: 'pipeline_failed',
    invoice_id: invoiceId,
    tenant_id: tenantId,
    error: errorMessage,
  }))

  await supabase
    .from('invoices')
    .update({
      status: 'error',
      pipeline_stage: 'failed',
      pipeline_completed_at: new Date().toISOString(),
      pipeline_error: errorMessage.slice(0, 500),
    })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
}

// ============================================================
// Load tenant settings
// ============================================================

async function loadTenantSettings(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenantId: string
): Promise<TenantSettings> {
  const { data, error } = await supabase
    .from('tenants')
    .select(
      'invoice_no_po_match_behavior, invoice_price_variance_threshold_pct, ' +
      'invoice_total_variance_threshold_pct, invoice_match_confidence_threshold_pct, ' +
      'invoice_vision_confidence_threshold_pct'
    )
    .eq('id', tenantId)
    .single()

  if (error) {
    throw new Error(`Failed to load tenant settings: ${error.message}`)
  }

  return {
    noPomatchBehavior: (data.invoice_no_po_match_behavior ?? 'always_create') as TenantSettings['noPomatchBehavior'],
    priceVarianceThresholdPct: data.invoice_price_variance_threshold_pct ?? 10,
    totalVarianceThresholdPct: data.invoice_total_variance_threshold_pct ?? 5,
    matchConfidenceThresholdPct: data.invoice_match_confidence_threshold_pct ?? 85,
    visionConfidenceThresholdPct: data.invoice_vision_confidence_threshold_pct ?? 60,
  }
}
