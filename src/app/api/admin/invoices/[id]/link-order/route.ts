import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const { id } = await context.params
    const body = await request.json()
    const { purchase_order_id } = body

    if (!id || !purchase_order_id) {
      return NextResponse.json(
        { error: 'invoice_id and purchase_order_id are required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, supplier_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    const { data: purchaseOrder, error: orderError } = await supabase
      .from('purchase_orders')
      .select('id, supplier_id')
      .eq('id', purchase_order_id)
      .eq('tenant_id', tenantId)
      .single()

    if (orderError || !purchaseOrder) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    if (
      invoice.supplier_id &&
      purchaseOrder.supplier_id &&
      invoice.supplier_id !== purchaseOrder.supplier_id
    ) {
      return NextResponse.json(
        { error: 'Invoice supplier does not match purchase order supplier' },
        { status: 400 }
      )
    }

    await supabase
      .from('order_invoice_matches')
      .delete()
      .eq('invoice_id', id)

    const { error: insertError } = await supabase
      .from('order_invoice_matches')
      .insert({
        invoice_id: id,
        purchase_order_id,
        match_confidence: body.match_confidence ?? 0.9,
        match_method: 'manual',
        status: 'pending',
        quantity_variance: body.quantity_variance ?? null,
        amount_variance: body.amount_variance ?? null,
        variance_notes: body.variance_notes || 'Linked manually from review interface'
      })

    if (insertError) {
      console.error('Failed to link invoice to purchase order:', insertError)
      return NextResponse.json(
        { error: 'Failed to link invoice to purchase order', details: insertError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Invoice linked to purchase order'
    })
  } catch (error) {
    console.error('Failed to link invoice to purchase order:', error)
    return NextResponse.json(
      {
        error: 'Failed to link invoice to purchase order',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
