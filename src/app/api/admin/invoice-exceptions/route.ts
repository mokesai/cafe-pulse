import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import type { InvoiceExceptionType } from '@/types/invoice-exceptions'

// Exception type priority for sort ordering (parse_error first, then others)
const EXCEPTION_TYPE_PRIORITY: Record<InvoiceExceptionType, number> = {
  parse_error: 0,
  low_extraction_confidence: 1,
  no_supplier_match: 2,
  no_po_match: 3,
  no_item_match: 4,
  price_variance: 5,
  quantity_variance: 6,
  duplicate_invoice: 7
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { searchParams } = new URL(request.url)

    const status = searchParams.get('status') || 'open'
    const typeParam = searchParams.get('type') // comma-separated
    const invoice_id = searchParams.get('invoice_id')
    const supplier_id = searchParams.get('supplier_id')
    const start_date = searchParams.get('start_date')
    const end_date = searchParams.get('end_date')
    const search = searchParams.get('search')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Build base query
    const selectColumns = `
      id,
      tenant_id,
      invoice_id,
      invoice_item_id,
      exception_type,
      exception_message,
      exception_context,
      status,
      resolution_notes,
      resolved_by,
      resolved_at,
      pipeline_stage_at_creation,
      created_at,
      updated_at,
      invoices (
        invoice_number,
        suppliers (
          id,
          name
        )
      ),
      invoice_items (
        item_description,
        unit_price,
        quantity
      )
    `

    let query = supabase
      .from('invoice_exceptions')
      .select(selectColumns, { count: 'exact' })
      .eq('tenant_id', tenantId)

    // Status filter
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    // Exception type filter (comma-separated)
    if (typeParam) {
      const types = typeParam.split(',').map(t => t.trim()).filter(Boolean)
      if (types.length === 1) {
        query = query.eq('exception_type', types[0])
      } else if (types.length > 1) {
        query = query.in('exception_type', types)
      }
    }

    // Invoice ID filter
    if (invoice_id) {
      query = query.eq('invoice_id', invoice_id)
    }

    // Supplier ID filter — need to join via invoices
    if (supplier_id) {
      // Filter via the joined invoices.supplier_id
      query = (query as typeof query & { eq: (col: string, val: string) => typeof query }).eq(
        'invoices.supplier_id',
        supplier_id
      )
    }

    // Date range filter
    if (start_date) {
      query = query.gte('created_at', start_date)
    }
    if (end_date) {
      // Include the full end day
      const endOfDay = new Date(end_date)
      endOfDay.setHours(23, 59, 59, 999)
      query = query.lte('created_at', endOfDay.toISOString())
    }

    // Text search on exception_message (simple ilike)
    if (search && search.trim()) {
      query = query.ilike('exception_message', `%${search.trim()}%`)
    }

    // Apply pagination
    const offset = (page - 1) * limit
    query = query
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1)

    const { data: exceptions, error, count } = await query

    if (error) {
      console.error('Error fetching invoice exceptions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch exceptions', details: error.message },
        { status: 500 }
      )
    }

    // Sort by exception type priority (parse_error first), then created_at ASC within type
    const sorted = (exceptions || []).sort((a, b) => {
      const aPriority = EXCEPTION_TYPE_PRIORITY[a.exception_type as InvoiceExceptionType] ?? 99
      const bPriority = EXCEPTION_TYPE_PRIORITY[b.exception_type as InvoiceExceptionType] ?? 99
      if (aPriority !== bPriority) return aPriority - bPriority
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })

    // Always fetch open count for badge display
    const { count: openCount } = await supabase
      .from('invoice_exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open')

    return NextResponse.json({
      success: true,
      data: sorted,
      open_count: openCount || 0,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    })
  } catch (error) {
    console.error('Failed to fetch invoice exceptions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch exceptions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
