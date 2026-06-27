/**
 * MOK-156 / KDS v3 phase 4 — add an external-URL aesthetic image.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-156
 * Plan: .planning/kds-v3/PHASE-4-PLAN.md (T4)
 *
 *   POST /api/admin/kds-v3/aesthetic-images/external
 *
 * Body: { name, external_url, alt_text? }
 *
 * No fetch-to-verify — per the MOK-156 "skip fetch" decision, we trust the
 * operator and rely on visual confirmation via the thumbnail in the
 * library page. URL must parse and use https://.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface CreateExternalBody {
  name?: string
  external_url?: string
  alt_text?: string | null
}

const NAME_MAX = 80
const ALT_TEXT_MAX = 200

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  let body: CreateExternalBody = {}
  try {
    body = (await request.json()) as CreateExternalBody
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body must be valid JSON.', code: 'KDS_AESTHETIC_IMAGE_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const errors: string[] = []
  const name = body.name?.trim() ?? ''
  if (name.length === 0) errors.push('name is required')
  if (name.length > NAME_MAX) errors.push(`name must be <= ${NAME_MAX} chars`)

  const rawUrl = body.external_url?.trim() ?? ''
  let parsedUrl: URL | null = null
  if (rawUrl.length === 0) {
    errors.push('external_url is required')
  } else {
    try {
      parsedUrl = new URL(rawUrl)
    } catch {
      errors.push('external_url must be a well-formed URL')
    }
    if (parsedUrl && parsedUrl.protocol !== 'https:') {
      errors.push('external_url must use the https:// scheme')
    }
  }

  const altText = body.alt_text?.toString() ?? null
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

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data: created, error: insertError } = await supabase
    .from('kds_aesthetic_images')
    .insert({
      tenant_id: tenantId,
      name,
      source_kind: 'external',
      external_url: parsedUrl!.toString(),
      alt_text: altText,
    })
    .select('*')
    .single()

  if (insertError) {
    return NextResponse.json(
      {
        success: false,
        error: insertError.message,
        code: 'KDS_AESTHETIC_IMAGE_CREATE_FAILED',
      },
      { status: 500 },
    )
  }

  // No thumbnail_url computation needed — external rows pass through directly.
  return NextResponse.json(
    {
      success: true,
      data: {
        ...created,
        thumbnail_url: created.external_url,
      },
    },
    { status: 201 },
  )
}
