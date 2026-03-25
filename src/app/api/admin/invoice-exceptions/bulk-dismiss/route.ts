import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

const MAX_BULK_SIZE = 50

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const adminAuth = authResult

    let body: { exception_ids?: unknown; resolution_notes?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { exception_ids, resolution_notes } = body

    if (!Array.isArray(exception_ids) || exception_ids.length === 0) {
      return NextResponse.json(
        { error: 'exception_ids must be a non-empty array' },
        { status: 400 }
      )
    }

    if (exception_ids.length > MAX_BULK_SIZE) {
      return NextResponse.json(
        { error: `Maximum bulk dismiss size is ${MAX_BULK_SIZE} exceptions` },
        { status: 400 }
      )
    }

    // Validate all IDs are strings
    const ids = exception_ids as string[]
    if (ids.some(id => typeof id !== 'string')) {
      return NextResponse.json(
        { error: 'All exception_ids must be strings (UUIDs)' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Fetch all requested exceptions to verify ownership and status
    const { data: exceptions, error: fetchError } = await supabase
      .from('invoice_exceptions')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .in('id', ids)

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to fetch exceptions', details: fetchError.message },
        { status: 500 }
      )
    }

    const foundIds = new Set((exceptions || []).map(e => e.id))
    const failedIds: string[] = []

    // IDs not found (not owned by this tenant or don't exist)
    for (const id of ids) {
      if (!foundIds.has(id)) {
        failedIds.push(id)
      }
    }

    // IDs that exist but aren't open
    const dismissibleIds: string[] = []
    for (const exception of exceptions || []) {
      if (exception.status === 'open') {
        dismissibleIds.push(exception.id)
      } else {
        failedIds.push(exception.id)
      }
    }

    if (dismissibleIds.length === 0) {
      return NextResponse.json({
        success: true,
        dismissed_count: 0,
        failed_ids: failedIds
      })
    }

    // Bulk dismiss — cross-type bulk dismiss is allowed
    const { error: dismissError } = await supabase
      .from('invoice_exceptions')
      .update({
        status: 'dismissed',
        resolution_notes: typeof resolution_notes === 'string' ? resolution_notes : null,
        resolved_by: adminAuth.userId,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('tenant_id', tenantId)
      .in('id', dismissibleIds)

    if (dismissError) {
      console.error('Error bulk dismissing exceptions:', dismissError)
      return NextResponse.json(
        { error: 'Failed to bulk dismiss exceptions', details: dismissError.message },
        { status: 500 }
      )
    }

    console.log(`✅ Bulk dismissed ${dismissibleIds.length} exceptions`)

    return NextResponse.json({
      success: true,
      dismissed_count: dismissibleIds.length,
      failed_ids: failedIds
    })
  } catch (error) {
    console.error('Failed to bulk dismiss exceptions:', error)
    return NextResponse.json(
      { error: 'Failed to bulk dismiss exceptions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
