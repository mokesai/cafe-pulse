import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
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
    
    // Fetch all customers (profiles with role 'customer')
    const { data: customers, error: customersError } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (customersError) {
      console.error('Error fetching customers:', customersError)
      return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 })
    }
    
    // For each customer, we could fetch their order statistics
    // For now, returning basic customer data
    const customersWithStats = customers?.map(customer => ({
      ...customer,
      orderCount: 0, // TODO: Calculate from orders table
      totalSpent: 0,  // TODO: Calculate from orders table
      lastOrderDate: null // TODO: Get from orders table
    }))
    
    return NextResponse.json({
      customers: customersWithStats || [],
      total: customers?.length || 0
    })
    
  } catch (error) {
    console.error('Error in admin customers API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
