import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runSalesSync } from '@/lib/square/sales-sync'

export const dynamic = 'force-dynamic'

/**
 * MOK-172: scheduled Square sales sync.
 *
 * Runs runSalesSync for every active tenant so POS sales decrement inventory (keeping COGS
 * ending-inventory accurate) without a manual click — and crucially covers invoices that
 * auto-confirm inside the Deno pipeline, which can't call this Node code directly. Tenants
 * without Square configured are skipped as a no-op.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically when the
 * CRON_SECRET env var is set; manual/test callers must pass the same bearer.
 * Optional `?tenant_id=` scopes the run to one tenant (used by tests to avoid touching others).
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { searchParams } = new URL(request.url)
  const scopedTenantId = searchParams.get('tenant_id')

  let tenantIds: string[]
  if (scopedTenantId) {
    tenantIds = [scopedTenantId]
  } else {
    const { data, error } = await supabase
      .from('tenants')
      .select('id')
      .eq('is_active', true)
    if (error) {
      return NextResponse.json({ error: `Failed to list tenants: ${error.message}` }, { status: 500 })
    }
    tenantIds = (data ?? []).map((t) => t.id as string)
  }

  const results: Array<{
    tenant_id: string
    status: 'synced' | 'skipped' | 'error'
    orders?: number
    error?: string
  }> = []

  for (const tenantId of tenantIds) {
    try {
      const result = await runSalesSync(supabase, tenantId, { adminId: null })
      if (result.ok) {
        results.push({ tenant_id: tenantId, status: 'synced', orders: result.metrics.ordersProcessed })
      } else if ('skipped' in result) {
        results.push({ tenant_id: tenantId, status: 'skipped' })
      } else {
        results.push({ tenant_id: tenantId, status: 'error', error: result.error })
      }
    } catch (err) {
      results.push({
        tenant_id: tenantId,
        status: 'error',
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }

  return NextResponse.json({
    success: true,
    tenants: tenantIds.length,
    synced: results.filter((r) => r.status === 'synced').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errored: results.filter((r) => r.status === 'error').length,
    results,
  })
}
