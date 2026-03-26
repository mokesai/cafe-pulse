import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

/**
 * GET /api/admin/inventory/categories
 *
 * Returns a distinct list of category strings from inventory_items for the
 * authenticated tenant. Used by NewInventoryItemDrawer to populate the
 * category dropdown when creating inventory items from the exception queue.
 *
 * Response: { categories: string[] }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    const { data, error } = await supabase
      .from('inventory_items')
      .select('category')
      .eq('tenant_id', tenantId)
      .not('category', 'is', null)

    if (error) {
      console.error('Error fetching inventory categories:', error)
      return NextResponse.json(
        { error: 'Failed to fetch categories', details: error.message },
        { status: 500 }
      )
    }

    const categories = [
      ...new Set(
        (data ?? [])
          .map((r: { category: string | null }) => r.category)
          .filter((c): c is string => Boolean(c))
      ),
    ].sort()

    return NextResponse.json({ categories })
  } catch (error) {
    console.error('Failed to fetch inventory categories:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch categories',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
