import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface RouteContext {
  params: Promise<{ id: string }>
}

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
      resolution_notes = body.resolution_notes
    } catch {
      // Notes are optional
    }

    // Fetch the exception to verify it exists and is open
    const { data: exception, error: fetchError } = await supabase
      .from('invoice_exceptions')
      .select('id, status, invoice_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Exception not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'Failed to fetch exception', details: fetchError.message },
        { status: 500 }
      )
    }

    if (exception.status !== 'open') {
      return NextResponse.json(
        { error: `Exception is already ${exception.status}` },
        { status: 422 }
      )
    }

    // Mark as dismissed
    const { error: dismissError } = await supabase
      .from('invoice_exceptions')
      .update({
        status: 'dismissed',
        resolution_notes: resolution_notes || null,
        resolved_by: adminAuth.userId,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (dismissError) {
      console.error('Error dismissing exception:', dismissError)
      return NextResponse.json(
        { error: 'Failed to dismiss exception', details: dismissError.message },
        { status: 500 }
      )
    }

    console.log(`✅ Exception ${id} dismissed`)

    return NextResponse.json({
      success: true,
      exception_id: id
    })
  } catch (error) {
    console.error('Failed to dismiss exception:', error)
    return NextResponse.json(
      { error: 'Failed to dismiss exception', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
