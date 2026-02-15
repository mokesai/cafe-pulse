import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const supabase = createServiceClient()
    
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
    
    const resolvedParams = await params
    const customerId = resolvedParams.customerId
    
    // Fetch orders for the specific customer
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