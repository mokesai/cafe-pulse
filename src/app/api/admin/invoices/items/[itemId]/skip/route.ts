import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, unexpectedError } from '@/lib/api/errors'

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { itemId } = await context.params
    const { skip_reason } = await request.json()

    console.log('⏭️ Skipping invoice item:', {
      itemId,
      skip_reason
    })

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Update the invoice item to mark as skipped
    const { error: skipError } = await supabase
      .from('invoice_items')
      .update({
        matched_item_id: null, // Clear any existing match
        match_confidence: null,
        match_method: 'skipped',
        notes: skip_reason || 'Manually skipped during review',
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .eq('tenant_id', tenantId)

    if (skipError) {
      return formatApiError('skip invoice item', skipError)
    }

    console.log('✅ Invoice item marked as skipped')

    return NextResponse.json({
      success: true,
      data: {
        message: 'Invoice item skipped successfully'
      }
    })

  } catch (error) {
    return unexpectedError('skip invoice item', error)
  }
}
