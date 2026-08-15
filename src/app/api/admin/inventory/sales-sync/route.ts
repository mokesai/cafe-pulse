import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { runSalesSync } from '@/lib/square/sales-sync'

interface SalesSyncRequestBody {
  dryRun?: boolean
}

// MOK-172: the heavy lifting lives in src/lib/square/sales-sync.ts (runSalesSync) so the same
// logic also runs from the invoice-confirm flow and the scheduled /api/cron/sales-sync job.
export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }

  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const body = (await request.json().catch(() => ({}))) as SalesSyncRequestBody

  const result = await runSalesSync(supabase, tenantId, {
    dryRun: body.dryRun,
    adminId: authResult.userId ?? null,
  })

  if (result.ok) {
    return NextResponse.json({
      success: true,
      runId: result.runId,
      message: `Processed ${result.metrics.ordersProcessed} orders`,
      metrics: result.metrics,
    })
  }

  if ('skipped' in result) {
    return NextResponse.json({ error: 'Square not configured' }, { status: 503 })
  }

  return NextResponse.json({ error: result.error }, { status: 500 })
}
