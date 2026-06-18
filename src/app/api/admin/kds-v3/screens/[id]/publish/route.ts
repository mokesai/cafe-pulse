/**
 * MOK-159 / KDS v3 phase 6.5 — publish endpoint.
 *
 *   POST /api/admin/kds-v3/screens/[id]/publish
 *
 * Snapshots the current draft of a screen into the published tables.
 * Pi devices reading from `source: 'published'` will see the new state
 * within ~30s (their polling interval).
 *
 * Response: { success: true, data: { published_at, diff: { added, changed, removed } } }
 * 404 if the screen doesn't exist for the tenant.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { publishKdsScreen } from '@/lib/kds/publish'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id } = await context.params
  try {
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()
    const result = await publishKdsScreen(supabase, tenantId, id)
    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    const code = (err as { code?: string }).code
    const status = (err as { status?: number }).status
    if (code === 'KDS_SCREEN_NOT_FOUND') {
      return NextResponse.json(
        { success: false, error: 'Screen not found.', code },
        { status: status ?? 404 },
      )
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message, code: 'KDS_PUBLISH_FAILED' },
      { status: 500 },
    )
  }
}
