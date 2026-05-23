/**
 * MOK-162 / KDS Pi Deployment phase 6 — admin device item routes.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-162
 * Plan: .planning/kds-v3-pi/PHASE-6-PLAN.md (T2)
 *
 *   PATCH  /api/admin/kds-v3/devices/[deviceId]  — rename / bind / unbind
 *   DELETE /api/admin/kds-v3/devices/[deviceId]  — revoke (deletes row;
 *                                                  Pi's next heartbeat 401s)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface PatchBody {
  name?: string
  screen_1_id?: string | null
  screen_2_id?: string | null
}

function isUuidOrNull(v: unknown): v is string | null {
  if (v === null) return true
  if (typeof v !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { deviceId } = await params

  let body: PatchBody = {}
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body must be valid JSON.', code: 'KDS_DEVICE_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const update: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'name cannot be empty', code: 'KDS_DEVICE_BAD_REQUEST' },
        { status: 400 },
      )
    }
    if (name.length > 80) {
      return NextResponse.json(
        { success: false, error: 'name must be 80 characters or fewer', code: 'KDS_DEVICE_BAD_REQUEST' },
        { status: 400 },
      )
    }
    update.name = name
  }

  if ('screen_1_id' in body) {
    if (!isUuidOrNull(body.screen_1_id)) {
      return NextResponse.json(
        { success: false, error: 'screen_1_id must be a UUID or null', code: 'KDS_DEVICE_BAD_REQUEST' },
        { status: 400 },
      )
    }
    update.screen_1_id = body.screen_1_id
  }
  if ('screen_2_id' in body) {
    if (!isUuidOrNull(body.screen_2_id)) {
      return NextResponse.json(
        { success: false, error: 'screen_2_id must be a UUID or null', code: 'KDS_DEVICE_BAD_REQUEST' },
        { status: 400 },
      )
    }
    update.screen_2_id = body.screen_2_id
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { success: false, error: 'No update fields provided', code: 'KDS_DEVICE_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // Confirm the device belongs to this tenant before we update (FK + RLS aren't
  // on the path because we use the service client).
  const { data: existing, error: lookupError } = await supabase
    .from('kds_devices')
    .select('id, tenant_id')
    .eq('id', deviceId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (lookupError) {
    return NextResponse.json(
      { success: false, error: lookupError.message, code: 'KDS_DEVICE_UPDATE_FAILED' },
      { status: 500 },
    )
  }
  if (!existing) {
    return NextResponse.json(
      { success: false, error: 'Device not found', code: 'KDS_DEVICE_NOT_FOUND' },
      { status: 404 },
    )
  }

  // Cross-tenant defense — any screen IDs in the update must belong to this
  // tenant. The FK enforces existence; this enforces ownership.
  const screenIdsToValidate: string[] = []
  if (typeof update.screen_1_id === 'string') screenIdsToValidate.push(update.screen_1_id)
  if (typeof update.screen_2_id === 'string') screenIdsToValidate.push(update.screen_2_id)
  if (screenIdsToValidate.length > 0) {
    const { data: screens, error: screensError } = await supabase
      .from('kds_screens')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', screenIdsToValidate)
    if (screensError) {
      return NextResponse.json(
        { success: false, error: screensError.message, code: 'KDS_DEVICE_UPDATE_FAILED' },
        { status: 500 },
      )
    }
    const ownedIds = new Set((screens ?? []).map((s) => s.id as string))
    for (const sid of screenIdsToValidate) {
      if (!ownedIds.has(sid)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Screen does not belong to this tenant',
            code: 'KDS_DEVICE_SCREEN_NOT_OWNED',
          },
          { status: 422 },
        )
      }
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('kds_devices')
    .update(update)
    .eq('id', deviceId)
    .eq('tenant_id', tenantId)
    .select(
      'id, name, status, setup_code, setup_code_expires_at, last_heartbeat_at, ip_address, registered_at, created_at, screen_1_id, screen_2_id',
    )
    .single()

  if (updateError || !updated) {
    return NextResponse.json(
      { success: false, error: updateError?.message ?? 'Update failed', code: 'KDS_DEVICE_UPDATE_FAILED' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data: updated })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { deviceId } = await params
  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // Tenant-scoped delete — if the row belongs to a different tenant we
  // surface 404 (don't leak existence).
  const { data: deleted, error } = await supabase
    .from('kds_devices')
    .delete()
    .eq('id', deviceId)
    .eq('tenant_id', tenantId)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'KDS_DEVICE_DELETE_FAILED' },
      { status: 500 },
    )
  }
  if (!deleted) {
    return NextResponse.json(
      { success: false, error: 'Device not found', code: 'KDS_DEVICE_NOT_FOUND' },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true })
}
