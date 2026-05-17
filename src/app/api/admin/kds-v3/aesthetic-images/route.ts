/**
 * MOK-156 / KDS v3 phase 4 — list the tenant's aesthetic images.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-156
 * Plan: .planning/kds-v3/PHASE-4-PLAN.md (T4)
 *
 *   GET /api/admin/kds-v3/aesthetic-images
 *
 * Returns every image row for the current tenant — including soft-deleted
 * rows (so the editor's picker can flag stale bindings as "(deleted)"
 * rather than silently dropping operator intent).
 *
 * For each row, computes `thumbnail_url`:
 *   - source_kind='uploaded': signed URL into the Storage bucket (TTL ~1 hour)
 *   - source_kind='external': pass-through of external_url
 *
 * The signed-URL TTL means a library page left open past ~1 hour will start
 * showing broken thumbnails until reload — acceptable v1 trade-off, the
 * page can re-fetch on focus as a future polish.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

const SIGNED_URL_TTL_SECONDS = 3600

interface ImageRow {
  id: string
  tenant_id: string
  name: string
  source_kind: 'uploaded' | 'external'
  storage_path: string | null
  external_url: string | null
  alt_text: string | null
  mime_type: string | null
  width_px: number | null
  height_px: number | null
  bytes: number | null
  is_deleted: boolean
  created_at: string
  updated_at: string
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data, error } = await supabase
    .from('kds_aesthetic_images')
    .select(
      'id, tenant_id, name, source_kind, storage_path, external_url, alt_text, ' +
        'mime_type, width_px, height_px, bytes, is_deleted, created_at, updated_at',
    )
    .eq('tenant_id', tenantId)
    .order('is_deleted', { ascending: true })
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'KDS_AESTHETIC_IMAGES_LIST_FAILED' },
      { status: 500 },
    )
  }

  const rows = (data ?? []) as unknown as ImageRow[]

  // Compute thumbnail_url per row. Batch the signed-URL requests for
  // uploaded sources — Supabase Storage has a bulk `createSignedUrls` call.
  const uploadedPaths = rows
    .filter((r) => r.source_kind === 'uploaded' && r.storage_path != null)
    .map((r) => r.storage_path as string)

  const signedUrlByPath = new Map<string, string>()
  if (uploadedPaths.length > 0) {
    const { data: signed, error: signErr } = await supabase.storage
      .from('kds-v3-aesthetic-images')
      .createSignedUrls(uploadedPaths, SIGNED_URL_TTL_SECONDS)
    if (signErr) {
      return NextResponse.json(
        {
          success: false,
          error: signErr.message,
          code: 'KDS_AESTHETIC_IMAGES_SIGN_URL_FAILED',
        },
        { status: 500 },
      )
    }
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) {
        signedUrlByPath.set(entry.path, entry.signedUrl)
      }
    }
  }

  const responseRows = rows.map((r) => ({
    id: r.id,
    name: r.name,
    source_kind: r.source_kind,
    storage_path: r.storage_path,
    external_url: r.external_url,
    alt_text: r.alt_text,
    mime_type: r.mime_type,
    width_px: r.width_px,
    height_px: r.height_px,
    bytes: r.bytes,
    is_deleted: r.is_deleted,
    thumbnail_url:
      r.source_kind === 'uploaded'
        ? signedUrlByPath.get(r.storage_path as string) ?? null
        : r.external_url,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }))

  return NextResponse.json({ success: true, data: responseRows })
}
