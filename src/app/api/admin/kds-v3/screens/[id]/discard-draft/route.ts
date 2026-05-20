/**
 * MOK-159 / KDS v3 phase 6.5 — discard-draft endpoint.
 *
 *   POST /api/admin/kds-v3/screens/[id]/discard-draft
 *
 * Replaces the current draft of a screen with the last published
 * snapshot — the inverse of publish. Lets an operator abandon an
 * in-progress iteration.
 *
 * Response: { success: true, data: { reverted_to_published_at } }
 * 404 if the screen doesn't exist for the tenant.
 * 422 if the screen has never been published (nothing to revert to).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { discardKdsScreenDraft } from '@/lib/kds/publish'

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
    const result = await discardKdsScreenDraft(supabase, tenantId, id)
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
    if (code === 'KDS_NO_PUBLISHED_VERSION') {
      return NextResponse.json(
        {
          success: false,
          error:
            'No published version to revert to. Publish the current draft first if you want to keep this state.',
          code,
        },
        { status: status ?? 422 },
      )
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message, code: 'KDS_DISCARD_DRAFT_FAILED' },
      { status: 500 },
    )
  }
}
