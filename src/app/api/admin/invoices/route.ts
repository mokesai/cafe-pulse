import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

type TextQueue =
  | 'all'
  | 'needs-ocr'
  | 'manual-review'
  | 'high-confidence'
  | 'ready-to-match'

interface FilterParams {
  status?: string | null
  supplier_id?: string | null
  start_date?: string | null
  end_date?: string | null
}

interface FilterableQuery<TSelf> {
  eq(column: string, value: unknown): TSelf
  gte(column: string, value: unknown): TSelf
  lte(column: string, value: unknown): TSelf
  gt(column: string, value: unknown): TSelf
  neq(column: string, value: unknown): TSelf
}

function applyBaseFilters<T extends FilterableQuery<T>>(query: T, filters: FilterParams) {
  const { status, supplier_id, start_date, end_date } = filters
  if (status) query = query.eq('status', status)
  if (supplier_id) query = query.eq('supplier_id', supplier_id)
  if (start_date) query = query.gte('invoice_date', start_date)
  if (end_date) query = query.lte('invoice_date', end_date)
  return query
}

function applyTextQueueFilter<T extends FilterableQuery<T>>(query: T, queue: TextQueue | null) {
  if (!queue || queue === 'all') {
    return query
  }

  switch (queue) {
    case 'needs-ocr':
      return query.eq('text_analysis->>needs_ocr', 'true')
    case 'manual-review':
      return query.eq('text_analysis->>needs_manual_review', 'true')
    case 'high-confidence':
      return query
        .gte('text_analysis->>validation_confidence', '0.75')
        .neq('text_analysis->>needs_manual_review', 'true')
    case 'ready-to-match':
      return query
        .eq('status', 'parsed')
        .gt('text_analysis->>line_item_candidates', '0')
        .neq('text_analysis->>needs_manual_review', 'true')
    default:
      return query
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const status = searchParams.get('status')
    const supplier_id = searchParams.get('supplier_id')
    const start_date = searchParams.get('start_date')
    const end_date = searchParams.get('end_date')
    const text_queue = (searchParams.get('text_queue') as TextQueue) || 'all'

    const supabase = createServiceClient()

    // Get tenant ID from cookie
    const cookieStore = await cookies()
    const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'
    const filters: FilterParams = { status, supplier_id, start_date, end_date }

    const columns = `
      id,
      invoice_number,
      invoice_date,
      due_date,
      total_amount,
      status,
      file_name,
      file_type,
      parsing_confidence,
      parsing_error,
      text_analysis,
      created_at,
      updated_at,
      suppliers (
        id,
        name
      )
    `

    // Build query
    let query = supabase
      .from('invoices')
      .select(columns, { count: 'exact' })
      .eq('tenant_id', tenantId)

    query = applyBaseFilters(query, filters)
    query = applyTextQueueFilter(query, text_queue)

    // Apply pagination
    const offset = (page - 1) * limit
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data: invoices, error, count } = await query

    if (error) {
      console.error('Error fetching invoices:', error)
      return NextResponse.json(
        { error: 'Failed to fetch invoices', details: error.message },
        { status: 500 }
      )
    }

    // Gather summary stats
    const [{ count: pendingReviewCount }, { count: confirmedCount }, { count: errorCount }] = await Promise.all([
      supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .in('status', ['uploaded', 'parsing', 'parsed', 'reviewing']),
      supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'confirmed'),
      supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'error')
    ])

    // Compute queue counts for filter tabs
    const textQueueIds: TextQueue[] = ['all', 'needs-ocr', 'manual-review', 'high-confidence', 'ready-to-match']
    const queueCountResults = await Promise.all(
      textQueueIds.map(async (queueId) => {
        let queueQuery = supabase
          .from('invoices')
          .select('*', { count: 'exact', head: true })
        queueQuery = applyBaseFilters(queueQuery, filters)
        queueQuery = applyTextQueueFilter(queueQuery, queueId)
        const { count } = await queueQuery
        return [queueId, count || 0] as const
      })
    )

    const textQueueCounts = Object.fromEntries(queueCountResults) as Record<TextQueue, number>

    return NextResponse.json({
      success: true,
      data: invoices,
      stats: {
        total: queueCountResults.find(([queueId]) => queueId === 'all')?.[1] || 0,
        pending_review: pendingReviewCount || 0,
        confirmed: confirmedCount || 0,
        errors: errorCount || 0
      },
      text_queue_counts: textQueueCounts,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    })

  } catch (error) {
    console.error('Failed to fetch invoices:', error)
    return NextResponse.json(
      { error: 'Failed to fetch invoices', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const adminAuth = authResult

    const body = await request.json()
    const {
      supplier_id,
      invoice_number,
      invoice_date,
      due_date,
      total_amount,
      file_url,
      file_name,
      file_type,
      file_size
    } = body

    if (!supplier_id || !invoice_number || !invoice_date) {
      return NextResponse.json(
        { error: 'Missing required fields: supplier_id, invoice_number, invoice_date' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Get tenant ID from cookie
    const cookieStore = await cookies()
    const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'

    // Check for duplicate invoice
    const { data: existingInvoice } = await supabase
      .from('invoices')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplier_id)
      .eq('invoice_number', invoice_number)
      .single()

    if (existingInvoice) {
      return NextResponse.json(
        { error: 'Invoice with this number already exists for this supplier' },
        { status: 409 }
      )
    }

    // Create new invoice
    const { data: newInvoice, error } = await supabase
      .from('invoices')
      .insert({
        tenant_id: tenantId,
        supplier_id,
        invoice_number,
        invoice_date,
        due_date,
        total_amount: total_amount || 0,
        file_url,
        file_name,
        file_type,
        file_size,
        status: 'uploaded',
        created_by: adminAuth.userId
      })
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        total_amount,
        status,
        file_name,
        file_type,
        created_at,
        suppliers (
          id,
          name
        )
      `)
      .single()

    if (error) {
      console.error('Error creating invoice:', error)
      return NextResponse.json(
        { error: 'Failed to create invoice', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Successfully created invoice:', newInvoice.invoice_number)

    return NextResponse.json({
      success: true,
      data: newInvoice,
      message: 'Invoice created successfully'
    }, { status: 201 })

  } catch (error) {
    console.error('Failed to create invoice:', error)
    return NextResponse.json(
      { error: 'Failed to create invoice', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
