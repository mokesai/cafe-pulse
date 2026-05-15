/**
 * MOK-152 / KDS v3 phase 2 — per-screen admin routes.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-152
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T4)
 *
 *   GET    /api/admin/kds-v3/screens/[id]  — screen + boxes
 *   PUT    /api/admin/kds-v3/screens/[id]  — atomic update of screen + boxes
 *   DELETE /api/admin/kds-v3/screens/[id]  — cascade delete via FK
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import {
  validateBoxLayout,
  nextAvailablePosition,
  type GridBox,
} from '@/lib/kds/grid-validation'

const VALID_THEMES = new Set(['warm', 'dark', 'wps'])
const VALID_BOX_TYPES = new Set(['menu_group', 'image_only'])

interface RouteContext {
  params: Promise<{ id: string }>
}

interface PutBoxInput {
  position?: number
  row_start?: number
  col_start?: number
  row_span?: number
  col_span?: number
  box_type?: string
  header_override?: string | null
  square_menu_group_id?: string | null
  aesthetic_image_id?: string | null
}

interface PutBody {
  name?: string
  grid_rows?: number
  grid_cols?: number
  theme?: string
  boxes?: PutBoxInput[]
}

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id } = await context.params
  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data: screen, error: screenError } = await supabase
    .from('kds_screens')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (screenError) {
    return NextResponse.json(
      { success: false, error: screenError.message, code: 'KDS_SCREEN_FETCH_FAILED' },
      { status: 500 },
    )
  }
  if (!screen) {
    return NextResponse.json(
      { success: false, error: 'Screen not found.', code: 'KDS_SCREEN_NOT_FOUND' },
      { status: 404 },
    )
  }

  const { data: boxes, error: boxesError } = await supabase
    .from('kds_grid_boxes')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('screen_id', id)
    .order('position', { ascending: true })

  if (boxesError) {
    return NextResponse.json(
      { success: false, error: boxesError.message, code: 'KDS_SCREEN_FETCH_FAILED' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, data: { ...screen, boxes: boxes ?? [] } })
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT — atomic update of screen + boxes
// ─────────────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id } = await context.params
  let body: PutBody = {}
  try {
    body = (await request.json()) as PutBody
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body must be valid JSON.', code: 'KDS_SCREEN_BAD_REQUEST' },
      { status: 400 },
    )
  }

  // Field validation
  const errors: string[] = []
  const name = body.name?.trim()
  if (name !== undefined && name.length === 0) errors.push('name cannot be empty')
  const grid_rows = body.grid_rows
  if (grid_rows !== undefined && (!Number.isInteger(grid_rows) || grid_rows < 1 || grid_rows > 24)) {
    errors.push('grid_rows must be an integer between 1 and 24')
  }
  const grid_cols = body.grid_cols
  if (grid_cols !== undefined && (!Number.isInteger(grid_cols) || grid_cols < 1 || grid_cols > 24)) {
    errors.push('grid_cols must be an integer between 1 and 24')
  }
  const theme = body.theme
  if (theme !== undefined && !VALID_THEMES.has(theme)) {
    errors.push(`theme must be one of: ${[...VALID_THEMES].join(', ')}`)
  }
  if (errors.length > 0) {
    return NextResponse.json(
      { success: false, error: errors.join('; '), code: 'KDS_SCREEN_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // Load current screen + boxes to resolve effective grid dims + assign new positions
  const { data: current } = await supabase
    .from('kds_screens')
    .select('grid_rows, grid_cols')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!current) {
    return NextResponse.json(
      { success: false, error: 'Screen not found.', code: 'KDS_SCREEN_NOT_FOUND' },
      { status: 404 },
    )
  }

  const effectiveGrid = {
    rows: grid_rows ?? current.grid_rows,
    cols: grid_cols ?? current.grid_cols,
  }

  // Pre-validate boxes if provided
  const validatedBoxes: Array<GridBox & { box_type: string; header_override: string | null; square_menu_group_id: string | null; aesthetic_image_id: string | null }> = []
  if (body.boxes !== undefined) {
    const inputBoxes = body.boxes
    // Assign positions to new boxes (those without position) in order, starting
    // from max(existing positions) + 1. Existing positions are preserved.
    const provided = inputBoxes.filter((b) => typeof b.position === 'number') as Array<PutBoxInput & { position: number }>
    let nextPos = nextAvailablePosition(provided.map((b) => ({
      position: b.position,
      row_start: b.row_start ?? 1,
      col_start: b.col_start ?? 1,
      row_span: b.row_span ?? 1,
      col_span: b.col_span ?? 1,
    })))

    const fieldErrors: string[] = []
    for (let i = 0; i < inputBoxes.length; i++) {
      const b = inputBoxes[i]
      const position = b.position ?? nextPos++
      const row_start = b.row_start
      const col_start = b.col_start
      const row_span = b.row_span ?? 1
      const col_span = b.col_span ?? 1
      const box_type = b.box_type ?? 'menu_group'

      if (!Number.isInteger(row_start) || !Number.isInteger(col_start)) {
        fieldErrors.push(`box[${i}]: row_start and col_start are required integers`)
        continue
      }
      if (row_span < 1 || col_span < 1) {
        fieldErrors.push(`box[${i}]: row_span and col_span must be >= 1`)
        continue
      }
      if (!VALID_BOX_TYPES.has(box_type)) {
        fieldErrors.push(`box[${i}]: box_type must be 'menu_group' or 'image_only'`)
        continue
      }

      validatedBoxes.push({
        position,
        row_start: row_start as number,
        col_start: col_start as number,
        row_span,
        col_span,
        box_type,
        header_override: b.header_override ?? null,
        square_menu_group_id: b.square_menu_group_id ?? null,
        aesthetic_image_id: b.aesthetic_image_id ?? null,
      })
    }
    if (fieldErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: fieldErrors.join('; '),
          code: 'KDS_SCREEN_BAD_REQUEST',
          validation_errors: fieldErrors,
        },
        { status: 400 },
      )
    }

    const layout = validateBoxLayout(validatedBoxes, effectiveGrid)
    if (!layout.ok) {
      return NextResponse.json(
        {
          success: false,
          error: layout.errors.join('; '),
          code: 'KDS_SCREEN_LAYOUT_INVALID',
          validation_errors: layout.errors,
        },
        { status: 422 },
      )
    }
  }

  // ── Apply: update screen, then replace boxes ──────────────────────────────
  // Best-effort transactionality: delete-then-insert in sequence; failure of
  // the insert step is logged but the screen update has already landed. For a
  // future hardening pass we'd move this to an RPC function for true atomicity.
  const screenUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) screenUpdate.name = name
  if (grid_rows !== undefined) screenUpdate.grid_rows = grid_rows
  if (grid_cols !== undefined) screenUpdate.grid_cols = grid_cols
  if (theme !== undefined) screenUpdate.theme = theme

  const { data: updatedScreen, error: updateError } = await supabase
    .from('kds_screens')
    .update(screenUpdate)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .maybeSingle()

  if (updateError) {
    if (updateError.code === '23505') {
      return NextResponse.json(
        {
          success: false,
          error: `A screen with that name already exists for this tenant.`,
          code: 'KDS_SCREEN_NAME_TAKEN',
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { success: false, error: updateError.message, code: 'KDS_SCREEN_UPDATE_FAILED' },
      { status: 500 },
    )
  }
  if (!updatedScreen) {
    return NextResponse.json(
      { success: false, error: 'Screen not found.', code: 'KDS_SCREEN_NOT_FOUND' },
      { status: 404 },
    )
  }

  let resultBoxes: unknown[] = []
  if (body.boxes !== undefined) {
    // Delete all existing boxes for this screen
    const { error: deleteError } = await supabase
      .from('kds_grid_boxes')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('screen_id', id)
    if (deleteError) {
      return NextResponse.json(
        { success: false, error: deleteError.message, code: 'KDS_SCREEN_UPDATE_FAILED' },
        { status: 500 },
      )
    }

    // Insert the new set
    if (validatedBoxes.length > 0) {
      const rows = validatedBoxes.map((b) => ({
        tenant_id: tenantId,
        screen_id: id,
        position: b.position,
        row_start: b.row_start,
        col_start: b.col_start,
        row_span: b.row_span,
        col_span: b.col_span,
        box_type: b.box_type,
        header_override: b.header_override,
        square_menu_group_id: b.square_menu_group_id,
        aesthetic_image_id: b.aesthetic_image_id,
      }))
      const { data: inserted, error: insertError } = await supabase
        .from('kds_grid_boxes')
        .insert(rows)
        .select('*')
      if (insertError) {
        return NextResponse.json(
          { success: false, error: insertError.message, code: 'KDS_SCREEN_UPDATE_FAILED' },
          { status: 500 },
        )
      }
      resultBoxes = inserted ?? []
    }
  } else {
    // No boxes in body — fetch current so the response is complete.
    const { data } = await supabase
      .from('kds_grid_boxes')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('screen_id', id)
      .order('position', { ascending: true })
    resultBoxes = data ?? []
  }

  return NextResponse.json({
    success: true,
    data: { ...updatedScreen, boxes: resultBoxes },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — FK CASCADE handles the boxes
// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id } = await context.params
  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data: deleted, error } = await supabase
    .from('kds_screens')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'KDS_SCREEN_DELETE_FAILED' },
      { status: 500 },
    )
  }
  if (!deleted) {
    return NextResponse.json(
      { success: false, error: 'Screen not found.', code: 'KDS_SCREEN_NOT_FOUND' },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true, data: { id: deleted.id } })
}
