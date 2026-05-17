/**
 * MOK-156 / KDS v3 phase 4 — upload an aesthetic image (multipart).
 *
 * Spec: https://linear.app/mokesai/issue/MOK-156
 * Plan: .planning/kds-v3/PHASE-4-PLAN.md (T5)
 *
 *   POST /api/admin/kds-v3/aesthetic-images/upload
 *
 * Multipart form fields:
 *   - file       (the image — required)
 *   - name       (operator-facing label — required)
 *   - alt_text   (optional)
 *
 * Server flow:
 *   1. Auth + tenant scoping.
 *   2. Parse multipart, validate file size + mime + name length.
 *   3. Allocate id; build storage_path = "<tenant_id>/<id>.<ext>".
 *   4. Upload blob to Storage via service-role client (RLS already checked
 *      by the route-level auth).
 *   5. INSERT the kds_aesthetic_images row with source_kind='uploaded'.
 *   6. If INSERT fails after the storage write succeeded, delete the
 *      orphan storage object so we don't leak.
 *
 * Width / height dimensions are intentionally left NULL on upload — would
 * require an image-decoding lib (sharp, image-size). Phase 4 ships without
 * them; future polish if the editor's image picker wants to surface them.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

const BUCKET = 'kds-v3-aesthetic-images'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const NAME_MAX = 80
const ALT_TEXT_MAX = 200

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Body must be multipart/form-data.',
        code: 'KDS_AESTHETIC_IMAGE_BAD_REQUEST',
      },
      { status: 400 },
    )
  }

  const file = form.get('file')
  const nameRaw = form.get('name')
  const altTextRaw = form.get('alt_text')

  const errors: string[] = []

  if (!(file instanceof File) || file.size === 0) {
    errors.push('file is required and must be a non-empty image')
  } else {
    if (file.size > MAX_BYTES) {
      errors.push(`file must be <= ${MAX_BYTES} bytes (got ${file.size})`)
    }
    if (!MIME_TO_EXT[file.type]) {
      errors.push(
        `file mime type must be one of: ${Object.keys(MIME_TO_EXT).join(', ')} ` +
          `(got "${file.type}")`,
      )
    }
  }

  const name = typeof nameRaw === 'string' ? nameRaw.trim() : ''
  if (name.length === 0) errors.push('name is required')
  if (name.length > NAME_MAX) errors.push(`name must be <= ${NAME_MAX} chars`)

  const altText =
    typeof altTextRaw === 'string' && altTextRaw.length > 0 ? altTextRaw : null
  if (altText !== null && altText.length > ALT_TEXT_MAX) {
    errors.push(`alt_text must be <= ${ALT_TEXT_MAX} chars`)
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

  // At this point file is the validated File object.
  const blob = file as File
  const tenantId = await getCurrentTenantId()
  const id = randomUUID()
  const ext = MIME_TO_EXT[blob.type]
  const storagePath = `${tenantId}/${id}.${ext}`

  const supabase = createServiceClient()

  // Step 4: upload to Storage.
  const arrayBuffer = await blob.arrayBuffer()
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, new Uint8Array(arrayBuffer), {
      contentType: blob.type,
      cacheControl: '3600',
      upsert: false,
    })
  if (uploadError) {
    return NextResponse.json(
      {
        success: false,
        error: uploadError.message,
        code: 'KDS_AESTHETIC_IMAGE_UPLOAD_FAILED',
      },
      { status: 500 },
    )
  }

  // Step 5: INSERT the row.
  const { data: created, error: insertError } = await supabase
    .from('kds_aesthetic_images')
    .insert({
      id,
      tenant_id: tenantId,
      name,
      source_kind: 'uploaded',
      storage_path: storagePath,
      alt_text: altText,
      mime_type: blob.type,
      bytes: blob.size,
    })
    .select('*')
    .single()

  // Step 6: orphan cleanup if INSERT failed after storage succeeded.
  if (insertError) {
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([storagePath])
    if (cleanupError) {
      // Best-effort cleanup; surfacing both errors so ops can manually
      // GC the orphan. Don't fail-hard on cleanup error — the primary
      // failure is the INSERT.
      console.error(
        `[aesthetic-images/upload] orphan cleanup failed for ${storagePath}: ${cleanupError.message}`,
      )
    }
    return NextResponse.json(
      {
        success: false,
        error: insertError.message,
        code: 'KDS_AESTHETIC_IMAGE_CREATE_FAILED',
      },
      { status: 500 },
    )
  }

  // Compute the signed thumbnail URL so the library page can render
  // immediately without re-fetching the list.
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600)

  return NextResponse.json(
    {
      success: true,
      data: {
        ...created,
        thumbnail_url: signed?.signedUrl ?? null,
      },
    },
    { status: 201 },
  )
}
