/**
 * MOK-156 / KDS v3 phase 4 — per-image PATCH (rename/alt-text) + DELETE
 * (soft).
 *
 * Spec: https://linear.app/mokesai/issue/MOK-156
 * Plan: .planning/kds-v3/PHASE-4-PLAN.md (T4)
 *
 *   PATCH  /api/admin/kds-v3/aesthetic-images/[id]
 *   DELETE /api/admin/kds-v3/aesthetic-images/[id]
 *
 * Image sources (storage_path / external_url / source_kind) are immutable
 * after create — to swap, soft-delete and add a new row.
 *
 * DELETE soft-deletes by setting is_deleted=true; the Storage object (if
 * any) is left in place. A future cleanup job can hard-delete soft-deleted
 * rows older than a retention window.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface PatchBody {
  name?: string
  alt_text?: string | null
}

const NAME_MAX = 80
const ALT_TEXT_MAX = 200

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id } = await context.params
  let body: PatchBody = {}
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body must be valid JSON.', code: 'KDS_AESTHETIC_IMAGE_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const errors: string[] = []
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.name !== undefined) {
    const trimmed = body.name.trim()
    if (trimmed.length === 0) {
      errors.push('name must not be empty')
    } else if (trimmed.length > NAME_MAX) {
      errors.push(`name must be <= ${NAME_MAX} chars`)
    } else {
      update.name = trimmed
    }
  }

  if (body.alt_text !== undefined) {
    if (body.alt_text === null || body.alt_text === '') {
      update.alt_text = null
    } else if (typeof body.alt_text === 'string' && body.alt_text.length > ALT_TEXT_MAX) {
      errors.push(`alt_text must be <= ${ALT_TEXT_MAX} chars`)
    } else {
      update.alt_text = body.alt_text
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: errors.join('; '),
        code: 'KDS_AESTHETIC_IMAGE_BAD_REQUEST',
        validation_errors: errors,
      },
      { status: 400 },
    )
  }

  // If only updated_at would be touched, the operator sent an empty patch.
  // Still allow it (acts as a touch); harmless.

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data: updated, error } = await supabase
    .from('kds_aesthetic_images')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'KDS_AESTHETIC_IMAGE_UPDATE_FAILED' },
      { status: 500 },
    )
  }
  if (!updated) {
    return NextResponse.json(
      { success: false, error: 'Image not found.', code: 'KDS_AESTHETIC_IMAGE_NOT_FOUND' },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true, data: updated })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id } = await context.params
  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // Soft-delete only. Storage object (if any) intentionally left in place;
  // a future GC job can hard-delete soft-deleted rows past a retention
  // window and clean up the storage objects in the same pass.
  const { data: deleted, error } = await supabase
    .from('kds_aesthetic_images')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, is_deleted')
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'KDS_AESTHETIC_IMAGE_DELETE_FAILED' },
      { status: 500 },
    )
  }
  if (!deleted) {
    return NextResponse.json(
      { success: false, error: 'Image not found.', code: 'KDS_AESTHETIC_IMAGE_NOT_FOUND' },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true, data: deleted })
}
