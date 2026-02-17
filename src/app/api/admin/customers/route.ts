import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Fetch all customers (profiles) for this tenant
    const { data: customers, error: customersError } = await supabase
      .from('profiles')
      .select('*')
      .eq('tenant_id', tenantId)
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
