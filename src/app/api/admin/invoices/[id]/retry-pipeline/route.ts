import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

type ValidFromStage = 'extracting' | 'matching_po' | 'matching_items'

const VALID_FROM_STAGES: ValidFromStage[] = ['extracting', 'matching_po', 'matching_items']

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { id } = await context.params

    let from_stage: ValidFromStage = 'extracting'
    try {
      const body = await request.json()
      if (body.from_stage) {
        if (!VALID_FROM_STAGES.includes(body.from_stage)) {
          return NextResponse.json(
            { error: `Invalid from_stage. Must be one of: ${VALID_FROM_STAGES.join(', ')}` },
            { status: 400 }
          )
        }
        from_stage = body.from_stage
      }
    } catch {
      // Body is optional — default to 'extracting'
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Verify invoice exists and belongs to this tenant
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('id, status, pipeline_stage, invoice_number, pipeline_started_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'Failed to fetch invoice', details: fetchError.message },
        { status: 500 }
      )
    }

    // Only allow retry if invoice is in a retriable state
    const retriableStatuses = ['error', 'pending_exceptions', 'pipeline_running', 'uploaded']
    if (!retriableStatuses.includes(invoice.status)) {
      return NextResponse.json(
        {
          error: `Cannot retry pipeline for invoice with status '${invoice.status}'. ` +
            `Retriable statuses: ${retriableStatuses.join(', ')}`
        },
        { status: 422 }
      )
    }

    // MOK-148: prevent stacking concurrent runs against the same invoice.
    // Pre-MOK-148 the retry route would reset status to 'uploaded' even when
    // a pipeline was actively running, allowing the orchestrator's
    // optimistic lock to claim again — two runs interleaved writes against
    // the same row, producing zombie `pipeline_running` rows with corrupted
    // timestamps (`pipeline_completed_at` < `pipeline_started_at`). Block
    // retry while a recent run is in flight; expire the block after the
    // staleness threshold so genuinely-stuck rows can still be recovered.
    const PIPELINE_RUNNING_RECENT_THRESHOLD_MS = 5 * 60 * 1000
    if (
      invoice.status === 'pipeline_running' &&
      invoice.pipeline_started_at &&
      Date.now() - new Date(invoice.pipeline_started_at).getTime() <
        PIPELINE_RUNNING_RECENT_THRESHOLD_MS
    ) {
      return NextResponse.json(
        {
          error:
            `Invoice ${invoice.invoice_number} is currently being processed ` +
            `(started ${invoice.pipeline_started_at}). ` +
            'Wait for the current run to complete (typically under 2 minutes). ' +
            'If it appears stuck, retry will be available 5 minutes after the run started.',
          code: 'PIPELINE_ALREADY_RUNNING',
          pipeline_started_at: invoice.pipeline_started_at,
        },
        { status: 409 }
      )
    }

    // Reset pipeline state to retrigger the DB webhook
    // The webhook fires on INSERT with status='uploaded'.
    // For a retry we reset to 'uploaded' so that if the webhook is re-fired manually
    // (or via an explicit Edge Function call), it picks up cleanly from the desired stage.
    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        status: 'uploaded',
        pipeline_stage: null,
        pipeline_error: null,
        pipeline_completed_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (updateError) {
      console.error('Error resetting invoice pipeline state:', updateError)
      return NextResponse.json(
        { error: 'Failed to reset pipeline state', details: updateError.message },
        { status: 500 }
      )
    }

    // MOK-128: dismiss any open exceptions from the previous run. The new
    // pipeline run will create fresh exceptions for whatever issues remain;
    // leaving the old ones as `open` clutters the queue and conflates
    // pre-retry vs post-retry signals. Stage 1's idempotency already deletes
    // existing invoice_items for the invoice — exceptions deserve the same
    // treatment for the same reason.
    //
    // Non-fatal: an exception cleanup failure shouldn't block the retry; the
    // worst case is the admin sees stale exceptions in the queue and has to
    // dismiss them manually (the pre-MOK-128 behavior).
    const dismissalNote = `Superseded by pipeline re-run on ${new Date().toISOString().slice(0, 10)}`
    const { count: staleExceptionsDismissed, error: cleanupError } = await supabase
      .from('invoice_exceptions')
      .update({
        status: 'dismissed',
        resolution_notes: dismissalNote,
        resolved_by: authResult.userId,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('invoice_id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'open')

    if (cleanupError) {
      console.warn(
        `[retry-pipeline] Failed to dismiss stale exceptions for invoice ${id}:`,
        cleanupError.message,
      )
    }

    // MOK-172: refresh the Square catalog before re-running the pipeline (same rationale as the
    // upload path — fresh products to match against). Non-fatal.
    try {
      const { syncMenusFromSquare } = await import('@/lib/square/menu-sync')
      await syncMenusFromSquare(supabase, tenantId)
    } catch (menuSyncError) {
      console.warn(
        `[retry-pipeline] menu-sync failed for tenant=${tenantId} (non-fatal):`,
        menuSyncError instanceof Error ? menuSyncError.message : menuSyncError,
      )
    }

    // Directly call the Edge Function since DB webhooks only fire on INSERT, not UPDATE.
    // We mimic the webhook payload format so the Edge Function handles it identically.
    const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/invoice-pipeline`
    try {
      const pipelineResponse = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SECRET_KEY}`
        },
        body: JSON.stringify({
          type: 'INSERT',
          table: 'invoices',
          record: { id, tenant_id: tenantId, status: 'uploaded' }
        })
      })
      if (!pipelineResponse.ok) {
        console.warn(
          `Edge Function call returned ${pipelineResponse.status} for invoice ${id}. ` +
          'Pipeline may not have started. Check Edge Function logs.'
        )
      }
    } catch (edgeError) {
      console.error('Failed to call Edge Function for pipeline retry:', edgeError)
      // Non-fatal: the invoice state has been reset, admin can try again.
    }

    console.log(
      `✅ Pipeline retry initiated for invoice ${invoice.invoice_number} (${id}), from_stage=${from_stage}`
    )

    return NextResponse.json(
      {
        success: true,
        message: 'Pipeline retry initiated',
        invoice_id: id,
        from_stage,
        stale_exceptions_dismissed: staleExceptionsDismissed ?? 0,
      },
      { status: 202 }
    )
  } catch (error) {
    console.error('Failed to retry pipeline:', error)
    return NextResponse.json(
      {
        error: 'Failed to retry pipeline',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
