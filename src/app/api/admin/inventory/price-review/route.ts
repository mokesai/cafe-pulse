import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import {
  getCostJumpItems,
  COST_JUMP_THRESHOLD_PCT,
  COST_JUMP_WINDOW_DAYS,
} from '@/lib/inventory/cost-jump'

// B3 / MOK-175: inventory items whose supplier cost jumped >= threshold over the window — the
// "review your menu price" signal. Computed on read from inventory_item_cost_history.
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()
    const items = await getCostJumpItems(supabase, tenantId)

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      threshold_pct: COST_JUMP_THRESHOLD_PCT,
      window_days: COST_JUMP_WINDOW_DAYS,
    })
  } catch (error) {
    console.error('Failed to compute price-review items:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
