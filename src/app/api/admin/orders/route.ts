import { NextRequest, NextResponse } from 'next/server'
import { createCurrentTenantClient } from '@/lib/supabase/server'

interface OrderUpdatePayload {
  status: string
  updated_at: string
  admin_notes?: string
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createCurrentTenantClient()
    
    // Check if user is authenticated and admin
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    // Check admin role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    
    if (profileError || profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    
    // Get query parameters
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    
    // Build query - fetch orders and order_items, handle profiles separately
    let query = supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    
    // Apply filters
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    
    if (startDate) {
      const startDateTime = new Date(startDate + 'T00:00:00.000Z')
      query = query.gte('created_at', startDateTime.toISOString())
    }
    
    if (endDate) {
      const endDateTime = new Date(endDate + 'T23:59:59.999Z')
      query = query.lte('created_at', endDateTime.toISOString())
    }
    
    const { data: orders, error: ordersError } = await query
    
    if (ordersError) {
      console.error('Error fetching orders:', ordersError)
      return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
    }

    // Fetch profile data separately for users who have orders
    let ordersWithProfiles = orders || []
    if (orders && orders.length > 0) {
      const userIds = orders
        .map(order => order.user_id)
        .filter(id => id) // Remove null user_ids
        .filter((id, index, arr) => arr.indexOf(id) === index) // Remove duplicates

      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', userIds)

        if (!profilesError && profiles) {
          ordersWithProfiles = orders.map(order => ({
            ...order,
            profiles: order.user_id ? profiles.find(p => p.id === order.user_id) : null
          }))
        }
      }
    }
    
    // Get total count for pagination
    let countQuery = supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
    
    if (status && status !== 'all') {
      countQuery = countQuery.eq('status', status)
    }
    
    if (startDate) {
      const startDateTime = new Date(startDate + 'T00:00:00.000Z')
      countQuery = countQuery.gte('created_at', startDateTime.toISOString())
    }
    
    if (endDate) {
      const endDateTime = new Date(endDate + 'T23:59:59.999Z')
      countQuery = countQuery.lte('created_at', endDateTime.toISOString())
    }
    
    const { count: totalOrders, error: countError } = await countQuery
    
    if (countError) {
      console.error('Error counting orders:', countError)
    }
    
    return NextResponse.json({
      orders: ordersWithProfiles,
      pagination: {
        total: totalOrders || 0,
        limit,
        offset,
        hasMore: (totalOrders || 0) > offset + limit
      }
    })
    
  } catch (error) {
    console.error('Error in admin orders API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createCurrentTenantClient()
    
    // Check if user is authenticated and admin
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    
    // Check admin role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    
    if (profileError || profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    
    const body = await request.json()
    const { orderId, status, notes } = body
    
    if (!orderId || !status) {
      return NextResponse.json({ error: 'Order ID and status are required' }, { status: 400 })
    }
    
    // Update order status
    const updates: OrderUpdatePayload = { 
      status,
      updated_at: new Date().toISOString()
    }
    
    if (notes) {
      updates.admin_notes = notes
    }
    
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', orderId)
      .select(`
        *,
        order_items (*)
      `)
      .single()

    // Fetch profile data separately if needed
    if (!updateError && updatedOrder && updatedOrder.user_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('id', updatedOrder.user_id)
        .single()

      if (profile) {
        updatedOrder.profiles = profile
      }
    }
    
    if (updateError) {
      console.error('Error updating order:', updateError)
      return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
    }
    
    // Create notification for order status update
    if (updatedOrder && updatedOrder.user_id) {
      try {
        await supabase.rpc('create_order_notification', {
          p_user_id: updatedOrder.user_id,
          p_order_id: updatedOrder.id,
          p_status: status,
          p_order_number: updatedOrder.order_number || updatedOrder.id.substring(0, 8).toUpperCase()
        })
      } catch (notificationError) {
        console.error('Error creating notification:', notificationError)
        // Don't fail the order update if notification creation fails
      }
    }
    
    // TODO: Send notification email to customer about status change
    // if (updatedOrder.customer_email) {
    //   await sendOrderStatusEmail(updatedOrder)
    // }
    
    return NextResponse.json({ order: updatedOrder })
    
  } catch (error) {
    console.error('Error updating order:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
