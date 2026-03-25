import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { id } = await context.params
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Fetch exception with full context
    const { data: exception, error } = await supabase
      .from('invoice_exceptions')
      .select(`
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
        updated_at
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Exception not found' }, { status: 404 })
      }
      console.error('Error fetching exception:', error)
      return NextResponse.json(
        { error: 'Failed to fetch exception', details: error.message },
        { status: 500 }
      )
    }

    // Fetch the linked invoice with supplier
    const { data: invoice } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        total_amount,
        pipeline_stage,
        supplier_id,
        suppliers (
          id,
          name
        )
      `)
      .eq('id', exception.invoice_id)
      .eq('tenant_id', tenantId)
      .single()

    // Fetch linked invoice item if applicable
    let invoiceItem = null
    if (exception.invoice_item_id) {
      const { data: item } = await supabase
        .from('invoice_items')
        .select(`
          id,
          item_description,
          unit_price,
          quantity
        `)
        .eq('id', exception.invoice_item_id)
        .single()
      invoiceItem = item
    }

    // Count other open exceptions on the same invoice
    const { count: otherOpenCount } = await supabase
      .from('invoice_exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('invoice_id', exception.invoice_id)
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .neq('id', id)

    return NextResponse.json({
      success: true,
      data: {
        ...exception,
        invoice,
        invoice_item: invoiceItem,
        other_open_exceptions_count: otherOpenCount || 0
      }
    })
  } catch (error) {
    console.error('Failed to fetch exception:', error)
    return NextResponse.json(
      { error: 'Failed to fetch exception', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
