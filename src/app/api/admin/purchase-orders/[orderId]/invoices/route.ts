import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'

interface RouteContext {
  params: Promise<{ orderId: string }>
}

interface AvailableInvoiceSummary {
  id: string
  invoice_number: string
  invoice_date: string | null
  total_amount: number | null
  status: string
  parsing_confidence: number | null
  file_url: string | null
  file_name: string | null
  created_at: string
}

const INVOICE_MATCH_SELECT = `
  id,
  invoice_id,
  match_confidence,
  match_method,
  status,
  quantity_variance,
  amount_variance,
  variance_notes,
  created_at,
  invoices:invoices!order_invoice_matches_invoice_id_fkey (
    id,
    invoice_number,
    invoice_date,
    due_date,
    total_amount,
    status,
    parsing_confidence,
    file_url,
    file_name,
    file_type,
    suppliers:suppliers!invoices_supplier_id_fkey (
      id,
      name
    )
  )
`

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { orderId } = await context.params
    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createCurrentTenantClient()

    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .select('id, supplier_id')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const { data: matches, error: matchesError } = await supabase
      .from('order_invoice_matches')
      .select(INVOICE_MATCH_SELECT)
      .eq('purchase_order_id', orderId)
      .order('created_at', { ascending: false })

    if (matchesError) {
      console.error('Failed to fetch invoice matches:', matchesError)
      return NextResponse.json(
        { error: 'Failed to fetch invoice matches', details: matchesError.message },
        { status: 500 }
      )
    }

    let availableInvoices: AvailableInvoiceSummary[] = []
    if (order.supplier_id) {
      const matchedInvoiceIds = (matches || [])
        .map(match => match?.invoice_id)
        .filter((id): id is string => Boolean(id))

      let availableQuery = supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          invoice_date,
          total_amount,
          status,
          parsing_confidence,
          file_url,
          file_name,
          created_at
        `)
        .eq('supplier_id', order.supplier_id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (matchedInvoiceIds.length > 0) {
        // Exclude already-linked invoices; the PostgREST `in` filter accepts a comma list of UUIDs
        const idList = matchedInvoiceIds.join(',')
        availableQuery = availableQuery.not('id', 'in', `(${idList})`)
      }

      const { data: availableData, error: availableError } = await availableQuery
      if (availableError) {
        console.error('Failed to fetch available invoices:', availableError)
      } else if (availableData) {
        availableInvoices = availableData as AvailableInvoiceSummary[]
      }
    }

    return NextResponse.json({
      success: true,
      matches: matches || [],
      available_invoices: availableInvoices
    })
  } catch (error) {
    console.error('Error fetching purchase order invoices:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch purchase order invoices',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const admin = authResult

    const { orderId } = await context.params
    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const {
      invoice_id,
      match_confidence,
      match_method,
      status,
      quantity_variance,
      amount_variance,
      variance_notes
    } = body

    if (!invoice_id) {
      return NextResponse.json(
        { error: 'invoice_id is required' },
        { status: 400 }
      )
    }

    const supabase = await createCurrentTenantClient()

    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .select('id, supplier_id')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, supplier_id, status')
      .eq('id', invoice_id)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    if (order.supplier_id && invoice.supplier_id && order.supplier_id !== invoice.supplier_id) {
      return NextResponse.json(
        { error: 'Invoice supplier does not match purchase order supplier' },
        { status: 400 }
      )
    }

    const { data: existingMatch } = await supabase
      .from('order_invoice_matches')
      .select(INVOICE_MATCH_SELECT)
      .eq('purchase_order_id', orderId)
      .eq('invoice_id', invoice_id)
      .maybeSingle()

    if (existingMatch) {
      // Idempotent response: if already linked, return existing match instead of failing
      return NextResponse.json({
        success: true,
        match: existingMatch
      })
    }

    const { data: insertedMatch, error: insertError } = await supabase
      .from('order_invoice_matches')
      .insert({
        purchase_order_id: orderId,
        invoice_id,
        match_confidence: typeof match_confidence === 'number' ? match_confidence : 0.5,
        match_method: match_method || 'manual',
        status: status || 'pending',
        quantity_variance: quantity_variance ?? null,
        amount_variance: amount_variance ?? null,
        variance_notes: variance_notes || null,
        reviewed_by: null,
        reviewed_at: null,
        review_notes: null
      })
      .select(INVOICE_MATCH_SELECT)
      .single()

    if (insertError) {
      console.error('Failed to create invoice match:', insertError)
      return NextResponse.json(
        { error: 'Failed to link invoice to purchase order', details: insertError.message },
        { status: 500 }
      )
    }

    if (invoice.status === 'uploaded') {
      await supabase
        .from('invoices')
        .update({
          status: 'matched',
          processed_by: admin.userId,
          processed_at: new Date().toISOString()
        })
        .eq('id', invoice_id)
    }

    return NextResponse.json({
      success: true,
      match: insertedMatch
    }, { status: 201 })
  } catch (error) {
    console.error('Error linking invoice to purchase order:', error)
    return NextResponse.json(
      {
        error: 'Failed to link invoice to purchase order',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
