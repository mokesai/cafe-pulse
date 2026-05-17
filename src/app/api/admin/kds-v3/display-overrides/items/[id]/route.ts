/**
 * MOK-157 / KDS v3 phase 5 — item-level display override.
 *
 *   PUT    /api/admin/kds-v3/display-overrides/items/[square_item_id]
 *   DELETE /api/admin/kds-v3/display-overrides/items/[square_item_id]
 *
 * PUT upserts the override (or auto-deletes when all fields are at
 * defaults — see upsertDisplayOverride). DELETE is idempotent.
 */
import { NextRequest } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'
import {
  upsertDisplayOverride,
  deleteDisplayOverride,
  type UpsertOverrideBody,
} from '@/lib/kds/display-overrides'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id } = await context.params
  let body: UpsertOverrideBody
  try {
    body = (await request.json()) as UpsertOverrideBody
  } catch {
    const { NextResponse } = await import('next/server')
    return NextResponse.json(
      { success: false, error: 'Body must be valid JSON.', code: 'KDS_DISPLAY_OVERRIDE_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const tenantId = await getCurrentTenantId()
  return upsertDisplayOverride({ tenantId, targetKind: 'item', targetId: id }, body)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id } = await context.params
  const tenantId = await getCurrentTenantId()
  return deleteDisplayOverride({ tenantId, targetKind: 'item', targetId: id })
}
