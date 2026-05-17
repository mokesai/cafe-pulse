/**
 * MOK-157 / KDS v3 phase 5 — shared upsert + delete logic for the
 * display-overrides PUT/DELETE routes. Items and variations share the
 * same shape; only the target_kind value and the mirror table consulted
 * for existence validation differ.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

const ALT_DISPLAY_NAME_MAX = 120

export interface UpsertOverrideBody {
  alt_display_name?: string | null
  alt_image_aesthetic_image_id?: string | null
  hidden_from_kds?: boolean
}

export interface UpsertContext {
  tenantId: string
  targetKind: 'item' | 'variation'
  targetId: string
}

/**
 * Validate + upsert (or auto-delete-on-defaults) a display override row.
 *
 * Returns a Next.js response. On success: 200 with the upserted row (or
 * `{ deleted: true }` if all override fields were at defaults).
 */
export async function upsertDisplayOverride(
  ctx: UpsertContext,
  body: UpsertOverrideBody,
): Promise<Response> {
  const errors: string[] = []

  const altName =
    body.alt_display_name === undefined || body.alt_display_name === null
      ? null
      : body.alt_display_name.toString().trim() || null
  if (altName !== null && altName.length > ALT_DISPLAY_NAME_MAX) {
    errors.push(`alt_display_name must be <= ${ALT_DISPLAY_NAME_MAX} chars`)
  }

  const altImageId =
    body.alt_image_aesthetic_image_id === undefined || body.alt_image_aesthetic_image_id === null
      ? null
      : body.alt_image_aesthetic_image_id

  const hidden = body.hidden_from_kds === true

  if (errors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: errors.join('; '),
        code: 'KDS_DISPLAY_OVERRIDE_BAD_REQUEST',
        validation_errors: errors,
      },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()

  // Validate target exists for current tenant.
  const mirrorTable =
    ctx.targetKind === 'item' ? 'square_menu_items' : 'square_menu_item_variations'
  const { data: target, error: targetErr } = await supabase
    .from(mirrorTable)
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', ctx.targetId)
    .maybeSingle()
  if (targetErr) {
    return NextResponse.json(
      { success: false, error: targetErr.message, code: 'KDS_DISPLAY_OVERRIDE_LOOKUP_FAILED' },
      { status: 500 },
    )
  }
  if (!target) {
    return NextResponse.json(
      {
        success: false,
        error: `${ctx.targetKind} "${ctx.targetId}" does not exist for this tenant`,
        code: 'KDS_DISPLAY_OVERRIDE_TARGET_NOT_FOUND',
      },
      { status: 422 },
    )
  }

  // Validate alt_image_aesthetic_image_id (if set) exists for current tenant.
  if (altImageId !== null) {
    const { data: img, error: imgErr } = await supabase
      .from('kds_aesthetic_images')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', altImageId)
      .maybeSingle()
    if (imgErr) {
      return NextResponse.json(
        { success: false, error: imgErr.message, code: 'KDS_DISPLAY_OVERRIDE_LOOKUP_FAILED' },
        { status: 500 },
      )
    }
    if (!img) {
      return NextResponse.json(
        {
          success: false,
          error: `aesthetic_image_id "${altImageId}" does not exist for this tenant`,
          code: 'KDS_DISPLAY_OVERRIDE_IMAGE_NOT_FOUND',
        },
        { status: 422 },
      )
    }
  }

  // Auto-delete-on-defaults — if the resulting state would be "no overrides",
  // delete instead of upsert. Idempotent.
  const isAllDefaults = altName === null && altImageId === null && hidden === false
  if (isAllDefaults) {
    const { error: delErr } = await supabase
      .from('kds_display_overrides')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('target_kind', ctx.targetKind)
      .eq('target_id', ctx.targetId)
    if (delErr) {
      return NextResponse.json(
        { success: false, error: delErr.message, code: 'KDS_DISPLAY_OVERRIDE_DELETE_FAILED' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true, deleted: true })
  }

  // Upsert. Use onConflict to handle the UNIQUE (tenant_id, target_kind, target_id).
  const { data: upserted, error: upsertErr } = await supabase
    .from('kds_display_overrides')
    .upsert(
      {
        tenant_id: ctx.tenantId,
        target_kind: ctx.targetKind,
        target_id: ctx.targetId,
        alt_display_name: altName,
        alt_image_aesthetic_image_id: altImageId,
        hidden_from_kds: hidden,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,target_kind,target_id' },
    )
    .select('*')
    .single()

  if (upsertErr) {
    return NextResponse.json(
      {
        success: false,
        error: upsertErr.message,
        code: 'KDS_DISPLAY_OVERRIDE_UPSERT_FAILED',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data: upserted })
}

export async function deleteDisplayOverride(ctx: UpsertContext): Promise<Response> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('kds_display_overrides')
    .delete()
    .eq('tenant_id', ctx.tenantId)
    .eq('target_kind', ctx.targetKind)
    .eq('target_id', ctx.targetId)
  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'KDS_DISPLAY_OVERRIDE_DELETE_FAILED' },
      { status: 500 },
    )
  }
  // Idempotent: returns 200 even if nothing was deleted.
  return NextResponse.json({ success: true })
}
