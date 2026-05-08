/**
 * MOK-151 / KDS v3 phase 1 — manual Square menu mirror full-resync endpoint.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-151
 * Plan: .planning/kds-v3/PHASE-1-PLAN.md (T6)
 *
 * Admin-only POST. Calls the same syncMenusFromSquare service the webhook
 * handler uses (MOK-151 T5). Useful for first-time onboarding (no webhook
 * has fired yet) and recovery from missed webhook deliveries.
 *
 * Request:  POST /api/admin/square/menu-sync
 *           Body (optional): { fullResync?: boolean }  — defaults to false
 * Response: see PHASE-1-PLAN.md T6 for the full contract
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { syncMenusFromSquare } from '@/lib/square/menu-sync'

interface RequestBody {
  fullResync?: boolean
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }

  let fullResync = false
  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody
    if (typeof body.fullResync === 'boolean') {
      fullResync = body.fullResync
    }
  } catch {
    // Body is optional — ignore parse errors and default to incremental.
  }

  try {
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()
    const result = await syncMenusFromSquare(supabase, tenantId, { fullResync })
    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[admin/square/menu-sync] sync failed:', message)
    return NextResponse.json(
      {
        success: false,
        error: message,
        code: 'MENU_SYNC_FAILED',
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Square menu mirror sync endpoint',
    methods: ['POST'],
    description:
      'Manually triggers a Square menu mirror sync for the current tenant. ' +
      'Body: { fullResync?: boolean } — defaults to false (incremental from last_synced_at).',
  })
}
