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

    // Fetch customers who have placed orders with this tenant
    // Profiles are global (no tenant_id) so we scope via the orders table
    const { data: customerIds, error: customerIdsError } = await supabase
      .from('orders')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .not('user_id', 'is', null)

    if (customerIdsError) {
      console.error('Error fetching customer IDs:', customerIdsError)
      return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 })
    }

    const uniqueCustomerIds = [...new Set(customerIds?.map(o => o.user_id) || [])]

    let customers: Record<string, unknown>[] = []
    if (uniqueCustomerIds.length > 0) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('id', uniqueCustomerIds)
        .order('created_at', { ascending: false })
      if (error) {
        console.error('Error fetching customer profiles:', error)
        return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 })
      }
      customers = data || []
    }

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
