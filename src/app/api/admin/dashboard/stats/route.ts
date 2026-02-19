import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    // Use service client for data queries with explicit tenant filtering
    const supabase = createServiceClient()

    // Get tenant ID from cookie
    const cookieStore = await cookies()
    const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'

    // Get today's date for filtering
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Fetch today's orders
    const { data: todayOrders, error: ordersError } = await supabase
      .from('orders')
      .select('total_amount, status')
      .eq('tenant_id', tenantId)
      .gte('created_at', today.toISOString())
      .lt('created_at', tomorrow.toISOString())

    if (ordersError) {
      console.error('Error fetching today\'s orders:', ordersError)
    }

    // Fetch total customers
    const { count: totalCustomers, error: customersError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'customer')

    if (customersError) {
      console.error('Error fetching customer count:', customersError)
    }

    // Fetch pending orders
    const { count: pendingOrders, error: pendingError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'preparing'])

    if (pendingError) {
      console.error('Error fetching pending orders:', pendingError)
    }

    // Calculate statistics
    const orders = todayOrders || []
    const todayRevenue = orders.reduce((sum, order) => sum + (order.total_amount || 0), 0)
    const todayOrdersCount = orders.length
    const completedOrders = orders.filter(order => order.status === 'completed').length
    const cancelledOrders = orders.filter(order => order.status === 'cancelled').length

    const stats = {
      todayRevenue: todayRevenue / 100, // Convert cents to dollars
      todayOrders: todayOrdersCount,
      totalCustomers: totalCustomers || 0,
      pendingOrders: pendingOrders || 0,
      completedOrders: completedOrders,
      cancelledOrders: cancelledOrders
    }

    return NextResponse.json(stats)

  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
