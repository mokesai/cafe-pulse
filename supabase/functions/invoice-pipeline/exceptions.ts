/**
 * Exception creation helper for the invoice pipeline.
 *
 * All pipeline stages use createException() to record issues
 * that require human review via the exception queue UI.
 *
 * Architecture: §2.6
 * Runtime: Deno (Supabase Edge Function)
 */

import type { PipelineContext } from './context.ts'

// ============================================================
// Exception Types (mirrors public.invoice_exception_type enum)
// ============================================================

export type ExceptionType =
  | 'low_extraction_confidence'
  | 'no_supplier_match'
  | 'no_po_match'
  | 'no_item_match'
  | 'price_variance'
  | 'quantity_variance'
  | 'parse_error'
  | 'duplicate_invoice'

// ============================================================
// Input shape
// ============================================================

export interface CreateExceptionInput {
  /** Exception classification */
  type: ExceptionType
  /** Human-readable message explaining the issue and recommended action */
  message: string
  /** Structured context for the UI to render type-specific resolution forms */
  context: Record<string, unknown>
  /** If this is an item-level exception, the invoice_item_id */
  invoiceItemId?: string
  /** Pipeline stage name when exception was created */
  pipelineStage: string
}

// ============================================================
// createException()
// ============================================================

/**
 * Insert an invoice_exception record and update ctx tracking counters.
 *
 * Returns the new exception's UUID.
 *
 * @throws Error if the DB insert fails (caller should handle this as fatal)
 */
export async function createException(
  ctx: PipelineContext,
  input: CreateExceptionInput
): Promise<string> {
  const { data, error } = await ctx.supabase
    .from('invoice_exceptions')
    .insert({
      tenant_id: ctx.tenantId,
      invoice_id: ctx.invoiceId,
      invoice_item_id: input.invoiceItemId ?? null,
      exception_type: input.type,
      exception_message: input.message,
      exception_context: input.context,
      pipeline_stage_at_creation: input.pipelineStage,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`[exceptions] Failed to create ${input.type} exception: ${error.message}`)
  }

  // Update context counters — used by Stage 5 to gate auto-confirmation
  ctx.openExceptionCount++
  ctx.hasBlockingExceptions = true

  console.log(JSON.stringify({
    event: 'exception_created',
    invoice_id: ctx.invoiceId,
    tenant_id: ctx.tenantId,
    exception_id: data.id,
    exception_type: input.type,
    pipeline_stage: input.pipelineStage,
    invoice_item_id: input.invoiceItemId ?? null,
  }))

  return data.id
}

// ============================================================
// checkForDuplicateItemException()
// ============================================================

/**
 * Returns true if an open 'no_item_match' exception already exists
 * for the given invoice_item_id. Used to prevent duplicate exceptions
 * on pipeline retry (idempotency).
 */
export async function checkForDuplicateItemException(
  ctx: PipelineContext,
  invoiceItemId: string,
  exceptionType: ExceptionType
): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from('invoice_exceptions')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('invoice_id', ctx.invoiceId)
    .eq('invoice_item_id', invoiceItemId)
    .eq('exception_type', exceptionType)
    .eq('status', 'open')
    .maybeSingle()

  if (error) {
    console.warn('[exceptions] checkForDuplicateItemException error:', error.message)
    return false
  }

  return !!data
}

// ============================================================
// sanitizeError()
// ============================================================

/**
 * Strip stack traces and sensitive details from error messages
 * before storing them in the DB or exception_context.
 */
export function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    // Return only the message (no stack), truncated to 500 chars
    return err.message.slice(0, 500)
  }
  return String(err).slice(0, 500)
}
