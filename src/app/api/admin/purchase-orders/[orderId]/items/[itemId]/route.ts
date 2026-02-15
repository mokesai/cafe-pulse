import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string; itemId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult
    const admin = authResult

    const { orderId, itemId } = await params
    if (!orderId || !itemId) {
      return NextResponse.json({ error: 'Order ID and Item ID are required' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const { is_excluded, reason, phase } = body

    if (typeof is_excluded !== 'boolean') {
      return NextResponse.json({ error: 'is_excluded must be boolean' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: updated, error } = await supabase
      .from('purchase_order_items')
      .update({
        is_excluded,
        exclusion_reason: is_excluded ? reason || null : null,
        exclusion_phase: is_excluded ? (phase || 'post_send') : null,
        excluded_at: is_excluded ? new Date().toISOString() : null,
        excluded_by: is_excluded ? admin.userId : null
      })
      .eq('id', itemId)
      .eq('purchase_order_id', orderId)
      .select('*')
      .single()

    if (error) {
      console.error('Failed to update purchase order item exclusion:', error)
      return NextResponse.json(
        { error: 'Failed to update item', details: error.message },
        { status: 500 }
      )
    }

    // Recalculate order total based on non-excluded items
    const { data: items } = await supabase
      .from('purchase_order_items')
      .select('quantity_ordered, unit_cost, is_excluded, total_cost')
      .eq('purchase_order_id', orderId)

    const totalAmount = (items || []).reduce((sum, item) => {
      if (item.is_excluded) return sum
      const lineTotal = typeof item.total_cost === 'number'
        ? item.total_cost
        : (item.quantity_ordered || 0) * (item.unit_cost || 0)
      return sum + lineTotal
    }, 0)

    const { error: poUpdateError } = await supabase
      .from('purchase_orders')
      .update({ total_amount: totalAmount })
      .eq('id', orderId)

    if (poUpdateError) {
      console.warn('Failed to update purchase order total after item exclusion:', poUpdateError)
    }

    return NextResponse.json({ success: true, item: updated, total_amount: totalAmount })
  } catch (error) {
    console.error('Error updating purchase order item exclusion:', error)
    return NextResponse.json(
      { error: 'Failed to update item exclusion', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
