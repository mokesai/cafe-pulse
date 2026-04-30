import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { applyPriceVarianceCostUpdate } from '@/lib/invoice-exceptions/apply-price-variance-cost'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * MOK-123: acknowledge an exception without dismissing the invoice.
 *
 * Distinct from /resolve (admin took corrective action) and /dismiss
 * (admin chose to ignore). 'acknowledged' is the right state when the
 * variance is real, accepted as-is, and noted for supplier-performance
 * tracking — not a problem to fix, just a fact to record.
 *
 * Side effects:
 * - Sets exception.status='acknowledged', resolved_by, resolved_at,
 *   resolution_notes (the column reuses the same metadata fields as
 *   resolve/dismiss).
 * - Updates the linked invoice_variance_history row(s) with
 *   acknowledged_at, acknowledged_by, acknowledgment_notes so the
 *   supplier-performance signal includes the human attestation.
 *
 * Auto-confirm: like resolve/dismiss, acknowledging the last open
 * exception makes the invoice eligible for auto-confirmation. The
 * auto-confirm logic counts only `status='open'` exceptions, so
 * 'acknowledged' (like 'resolved' and 'dismissed') doesn't gate it.
 * This route does NOT trigger auto-confirm itself; the existing
 * /resolve route handles that for the broader resolution flow.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const adminAuth = authResult

    const { id } = await context.params
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    let resolution_notes: string | undefined
    try {
      const body = await request.json()
      resolution_notes = body.notes ?? body.resolution_notes
    } catch {
      // Notes are optional
    }

    // Fetch the exception to verify it exists and is open. Pull the type +
    // context too so we can apply the price-variance cost update for
    // price_variance acknowledgments (MOK-130).
    const { data: exception, error: fetchError } = await supabase
      .from('invoice_exceptions')
      .select('id, status, invoice_id, invoice_item_id, exception_type, exception_context')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Exception not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'Failed to fetch exception', details: fetchError.message },
        { status: 500 },
      )
    }

    if (exception.status !== 'open') {
      return NextResponse.json(
        { error: `Exception is already ${exception.status}` },
        { status: 422 },
      )
    }

    const now = new Date().toISOString()

    // Mark exception as acknowledged
    const { error: ackError } = await supabase
      .from('invoice_exceptions')
      .update({
        status: 'acknowledged',
        resolution_notes: resolution_notes || null,
        resolved_by: adminAuth.userId,
        resolved_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (ackError) {
      console.error('Error acknowledging exception:', ackError)
      return NextResponse.json(
        { error: 'Failed to acknowledge exception', details: ackError.message },
        { status: 500 },
      )
    }

    // MOK-122 + MOK-123: propagate acknowledgment to the variance history
    // shadow row(s). Failures here are non-fatal — the exception state is
    // the user-visible signal.
    const { error: historyError } = await supabase
      .from('invoice_variance_history')
      .update({
        acknowledged_at: now,
        acknowledged_by: adminAuth.userId,
        acknowledgment_notes: resolution_notes || null,
      })
      .eq('related_exception_id', id)
      .eq('tenant_id', tenantId)

    if (historyError) {
      console.warn(
        'Acknowledgment recorded on exception, but variance history update failed:',
        historyError.message,
      )
    }

    // MOK-130: when acknowledging a price-variance, apply the new price to
    // inventory. Acknowledge means "accepted as-is, log it" — the natural
    // companion is to make sure inventory cost reflects the accepted price.
    let costApplied: { applied: boolean; new_unit_cost?: number; error?: string } | null = null
    if (exception.exception_type === 'price_variance') {
      const result = await applyPriceVarianceCostUpdate(supabase, tenantId, {
        invoiceId: exception.invoice_id,
        invoiceItemId: exception.invoice_item_id,
        exceptionContext: exception.exception_context as Record<string, unknown>,
        source: 'acknowledge',
        changedBy: adminAuth.userId,
      })
      costApplied = {
        applied: result.applied,
        new_unit_cost: result.newUnitCost,
        error: result.error,
      }
      if (result.error) {
        console.warn(
          `[acknowledge] price-variance cost update issue (applied=${result.applied}):`,
          result.error,
        )
      }
    }

    console.log(`✅ Exception ${id} acknowledged`)

    return NextResponse.json({
      success: true,
      exception_id: id,
      status: 'acknowledged',
      cost_update: costApplied,
    })
  } catch (error) {
    console.error('Failed to acknowledge exception:', error)
    return NextResponse.json(
      {
        error: 'Failed to acknowledge exception',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
