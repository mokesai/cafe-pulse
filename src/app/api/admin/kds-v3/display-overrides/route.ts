/**
 * MOK-157 / KDS v3 phase 5 — list the tenant's display overrides.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-157
 * Plan: .planning/kds-v3/PHASE-5-PLAN.md (T3)
 *
 *   GET /api/admin/kds-v3/display-overrides
 *
 * Returns every row in kds_display_overrides for the current tenant. For
 * rows that bind an alt_image, computes the signed/external thumbnail URL
 * server-side via the same logic as phase 4's image list (batched
 * createSignedUrls).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

const SIGNED_URL_TTL_SECONDS = 3600

interface OverrideRow {
  id: string
  target_kind: 'item' | 'variation'
  target_id: string
  alt_display_name: string | null
  alt_image_aesthetic_image_id: string | null
  hidden_from_kds: boolean
  created_at: string
  updated_at: string
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data, error } = await supabase
    .from('kds_display_overrides')
    .select(
      'id, target_kind, target_id, alt_display_name, alt_image_aesthetic_image_id, ' +
        'hidden_from_kds, created_at, updated_at',
    )
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'KDS_DISPLAY_OVERRIDES_LIST_FAILED' },
      { status: 500 },
    )
  }

  const rows = (data ?? []) as unknown as OverrideRow[]

  // Resolve alt_image thumbnail URLs in a single batched pass.
  const imageIds = Array.from(
    new Set(
      rows
        .map((r) => r.alt_image_aesthetic_image_id)
        .filter((v): v is string => typeof v === 'string'),
    ),
  )
  const thumbnailByImageId = new Map<string, string>()
  if (imageIds.length > 0) {
    const { data: images } = await supabase
      .from('kds_aesthetic_images')
      .select('id, source_kind, storage_path, external_url')
      .eq('tenant_id', tenantId)
      .in('id', imageIds)

    const uploadedPaths: string[] = []
    const imageMeta = new Map<string, { source_kind: string; storage_path: string | null; external_url: string | null }>()
    for (const img of ((images ?? []) as Array<{ id: string; source_kind: string; storage_path: string | null; external_url: string | null }>)) {
      imageMeta.set(img.id, {
        source_kind: img.source_kind,
        storage_path: img.storage_path,
        external_url: img.external_url,
      })
      if (img.source_kind === 'uploaded' && img.storage_path) {
        uploadedPaths.push(img.storage_path)
      }
    }

    const signedByPath = new Map<string, string>()
    if (uploadedPaths.length > 0) {
      const { data: signed } = await supabase.storage
        .from('kds-v3-aesthetic-images')
        .createSignedUrls(uploadedPaths, SIGNED_URL_TTL_SECONDS)
      for (const entry of signed ?? []) {
        if (entry.path && entry.signedUrl) {
          signedByPath.set(entry.path, entry.signedUrl)
        }
      }
    }

    for (const [id, meta] of imageMeta) {
      if (meta.source_kind === 'uploaded' && meta.storage_path) {
        const url = signedByPath.get(meta.storage_path)
        if (url) thumbnailByImageId.set(id, url)
      } else if (meta.source_kind === 'external' && meta.external_url) {
        thumbnailByImageId.set(id, meta.external_url)
      }
    }
  }

  const responseRows = rows.map((r) => ({
    ...r,
    alt_image_thumbnail_url:
      r.alt_image_aesthetic_image_id !== null
        ? thumbnailByImageId.get(r.alt_image_aesthetic_image_id) ?? null
        : null,
  }))

  return NextResponse.json({ success: true, data: responseRows })
}
