import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }

  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  try {
    const [{ data: latestRunData, error: latestRunError }, { data: pendingManualData, error: pendingManualError }, { data: recentRuns, error: recentRunsError }] = await Promise.all([
      supabase
        .from('inventory_sales_sync_runs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false })
        .limit(1),
      supabase
        .from('view_pending_manual_inventory_deductions')
        .select('*'),
      supabase
        .from('inventory_sales_sync_runs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false })
        .limit(5)
    ])

    if (latestRunError) {
      throw new Error(latestRunError.message)
    }
    if (pendingManualError) {
      throw new Error(pendingManualError.message)
    }
    if (recentRunsError) {
      throw new Error(recentRunsError.message)
    }

    const latestRun = latestRunData?.[0] ?? null
    const pendingItems = (pendingManualData || []).map(item => ({
      inventory_item_id: item.inventory_item_id,
      item_name: item.item_name,
      total_quantity: Number(item.total_quantity || 0),
      last_transaction_at: item.last_transaction_at,
      last_sync_run_id: item.last_sync_run_id
    }))

    const pendingTotal = pendingItems.reduce((sum, item) => sum + item.total_quantity, 0)

    const recentErrors = (recentRuns || [])
      .filter(run => run.status === 'error')
      .slice(0, 3)
      .map(run => ({
        id: run.id,
        error_message: run.error_message,
        finished_at: run.finished_at,
        started_at: run.started_at
      }))

    return NextResponse.json({
      success: true,
      lastRun: latestRun,
      pendingManual: {
        totalQuantity: pendingTotal,
        items: pendingItems
      },
      recentRuns,
      recentErrors
    })
  } catch (error) {
    console.error('Sales sync status error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
