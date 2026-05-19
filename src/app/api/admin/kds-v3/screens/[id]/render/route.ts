/**
 * KDS v3 phase 6 — admin-only screen render endpoint.
 *
 *   GET /api/admin/kds-v3/screens/[id]/render
 *
 * Returns the same ResolvedScreen shape the Pi-facing route consumes, but
 * gated by admin auth (requireAdminAuth) instead of device-token auth.
 * Powers the in-place "Preview" tab on the edit page so the operator can
 * iterate without a page transition.
 *
 * 404 on:
 *   - screen not found OR cross-tenant (tenant scope enforced inside
 *     resolveScreenForRender — wrong tenant returns null)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { resolveScreenForRender } from '@/lib/kds/v3-render'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id } = await context.params
  try {
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()
    const resolved = await resolveScreenForRender(supabase, tenantId, id)
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: 'Screen not found.', code: 'KDS_SCREEN_NOT_FOUND' },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, data: resolved })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message, code: 'KDS_SCREEN_RENDER_FAILED' },
      { status: 500 },
    )
  }
}
