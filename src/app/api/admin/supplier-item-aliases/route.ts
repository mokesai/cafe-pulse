import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { searchParams } = new URL(request.url)
    const supplier_id = searchParams.get('supplier_id')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    let query = supabase
      .from('supplier_item_aliases')
      .select(`
        id,
        tenant_id,
        supplier_id,
        supplier_description,
        inventory_item_id,
        confidence,
        source,
        use_count,
        last_seen_invoice_id,
        last_seen_at,
        created_at,
        updated_at,
        suppliers (
          id,
          name
        ),
        inventory_items (
          id,
          item_name,
          unit_cost
        )
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)

    if (supplier_id) {
      query = query.eq('supplier_id', supplier_id)
    }

    const offset = (page - 1) * limit
    query = query
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data: aliases, error, count } = await query

    if (error) {
      console.error('Error fetching supplier item aliases:', error)
      return NextResponse.json(
        { error: 'Failed to fetch aliases', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: aliases || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    })
  } catch (error) {
    console.error('Failed to fetch supplier item aliases:', error)
    return NextResponse.json(
      { error: 'Failed to fetch aliases', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
