import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    const resolvedParams = await params
    const customerId = resolvedParams.customerId

    // Fetch orders for the specific customer within this tenant
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        created_at,
        total_amount,
        status,
        order_items (
          id,
          item_name,
          quantity,
          total_price
        )
      `)
      .eq('user_id', customerId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (ordersError) {
      console.error('Error fetching customer orders:', ordersError)
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
    }

    return NextResponse.json({
      orders: orders || [],
      customerId
    })

  } catch (error) {
    console.error('Error in customer orders API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
