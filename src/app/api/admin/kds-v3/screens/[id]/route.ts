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
  type BoxDivisionFields,
  type DivisionMode,
} from '@/lib/kds/grid-validation'

const VALID_THEMES = new Set(['warm', 'dark', 'wps'])
const VALID_BOX_TYPES = new Set(['menu_group', 'image_only'])
const VALID_DIVISIONS = new Set<DivisionMode>(['none', 'horizontal', 'vertical'])

// Phase 6 (MOK-158) — per-slot layout + formatting enums. Slot A required;
// slot B nullable but cross-checked with box_type_b in the cross-slot-B
// formatting invariant CHECK in the DB. The route validator below enforces
// the same shape so we don't depend on the DB error message for UX.
const VALID_LAYOUT_MODES = new Set([
  'simple_list',
  'variation_column_header',
  'flavor_list',
  'compact_list',
])
const VALID_PRICE_DISPLAY_MODES = new Set(['none', 'lowest', 'range', 'base'])
const VALID_DENSITIES = new Set(['compact', 'normal', 'loose'])
const VALID_TITLE_SIZES = new Set(['small', 'medium', 'large'])
const VALID_TITLE_ALIGNS = new Set(['left', 'center', 'right'])

const LAYOUT_MODE_DEFAULT = 'simple_list'
const PRICE_DISPLAY_MODE_DEFAULT = 'lowest'
const DENSITY_DEFAULT = 'normal'
const TITLE_SIZE_DEFAULT = 'medium'
const TITLE_ALIGN_DEFAULT = 'left'

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
  // Phase 2.5 (MOK-154) — optional second-slot fields. Default to undivided.
  division?: string
  box_type_b?: string | null
  header_override_b?: string | null
  square_menu_group_id_b?: string | null
  aesthetic_image_id_b?: string | null
  // Phase 6 (MOK-158) — slot-A layout/price/whitespace controls.
  layout_mode?: string
  price_display_mode?: string
  density?: string
  title_size?: string
  title_align?: string
  // Phase 6 — slot-B mirrors (nullable; must all be set ↔ box_type_b set).
  layout_mode_b?: string | null
  price_display_mode_b?: string | null
  density_b?: string | null
  title_size_b?: string | null
  title_align_b?: string | null
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
  const validatedBoxes: Array<
    GridBox &
      BoxDivisionFields & {
        box_type: string
        header_override: string | null
        square_menu_group_id: string | null
        aesthetic_image_id: string | null
        // Phase 6 — slot-A required with defaults
        layout_mode: string
        price_display_mode: string
        density: string
        title_size: string
        title_align: string
        // Phase 6 — slot-B mirrors (null when undivided)
        layout_mode_b: string | null
        price_display_mode_b: string | null
        density_b: string | null
        title_size_b: string | null
        title_align_b: string | null
      }
  > = []
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
      const division = (b.division ?? 'none') as DivisionMode

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
      // Phase 2.5: per-field shape checks for the new slot-B columns. The
      // cross-column invariant + min-span guard run inside validateBoxLayout
      // below (which calls validateBoxDivision per box).
      if (!VALID_DIVISIONS.has(division)) {
        fieldErrors.push(`box[${i}]: division must be 'none', 'horizontal', or 'vertical'`)
        continue
      }
      if (b.box_type_b != null && !VALID_BOX_TYPES.has(b.box_type_b)) {
        fieldErrors.push(`box[${i}]: box_type_b must be 'menu_group' or 'image_only' when set`)
        continue
      }
      // Phase 3: image_only-with-group rejection. A box_type_b='image_only' slot
      // must leave square_menu_group_id_b NULL — menu-group binding is a
      // menu_group-only concept. Same for slot A. Defense-in-depth against
      // tampered requests; the editor hides the picker for image_only slots.
      if (box_type === 'image_only' && b.square_menu_group_id != null) {
        fieldErrors.push(
          `box[${i}]: square_menu_group_id must be null when box_type='image_only'`,
        )
        continue
      }
      if (b.box_type_b === 'image_only' && b.square_menu_group_id_b != null) {
        fieldErrors.push(
          `box[${i}]: square_menu_group_id_b must be null when box_type_b='image_only'`,
        )
        continue
      }
      // Phase 4 (MOK-156): symmetric menu_group-with-image rejection.
      // image-binding is image_only-only. Defense-in-depth; editor hides
      // the image picker for menu_group slots.
      if (box_type === 'menu_group' && b.aesthetic_image_id != null) {
        fieldErrors.push(
          `box[${i}]: aesthetic_image_id must be null when box_type='menu_group'`,
        )
        continue
      }
      if (b.box_type_b === 'menu_group' && b.aesthetic_image_id_b != null) {
        fieldErrors.push(
          `box[${i}]: aesthetic_image_id_b must be null when box_type_b='menu_group'`,
        )
        continue
      }

      // Phase 6 (MOK-158): slot-A layout/price/whitespace fields. Required
      // shape — invalid enum values are rejected here so the operator gets
      // a structured error rather than the DB CHECK message. Defaults are
      // applied for any omitted slot-A field so phase 2 → 6 round-trips work.
      const layout_mode = b.layout_mode ?? LAYOUT_MODE_DEFAULT
      const price_display_mode = b.price_display_mode ?? PRICE_DISPLAY_MODE_DEFAULT
      const density = b.density ?? DENSITY_DEFAULT
      const title_size = b.title_size ?? TITLE_SIZE_DEFAULT
      const title_align = b.title_align ?? TITLE_ALIGN_DEFAULT
      if (!VALID_LAYOUT_MODES.has(layout_mode)) {
        fieldErrors.push(
          `box[${i}]: layout_mode must be one of: ${[...VALID_LAYOUT_MODES].join(', ')}`,
        )
        continue
      }
      if (!VALID_PRICE_DISPLAY_MODES.has(price_display_mode)) {
        fieldErrors.push(
          `box[${i}]: price_display_mode must be one of: ${[...VALID_PRICE_DISPLAY_MODES].join(', ')}`,
        )
        continue
      }
      if (!VALID_DENSITIES.has(density)) {
        fieldErrors.push(
          `box[${i}]: density must be one of: ${[...VALID_DENSITIES].join(', ')}`,
        )
        continue
      }
      if (!VALID_TITLE_SIZES.has(title_size)) {
        fieldErrors.push(
          `box[${i}]: title_size must be one of: ${[...VALID_TITLE_SIZES].join(', ')}`,
        )
        continue
      }
      if (!VALID_TITLE_ALIGNS.has(title_align)) {
        fieldErrors.push(
          `box[${i}]: title_align must be one of: ${[...VALID_TITLE_ALIGNS].join(', ')}`,
        )
        continue
      }

      // Phase 6 slot-B: mirror invariant — every slot-B formatting column
      // must be set when box_type_b is set, and NULL when box_type_b is NULL.
      // Apply defaults for any missing-but-required slot-B field, then enum-
      // validate. For undivided boxes, drop any incoming slot-B formatting
      // values to NULL so the cross-slot-B invariant CHECK holds.
      const dividedB = b.box_type_b != null
      const layout_mode_b = dividedB ? b.layout_mode_b ?? LAYOUT_MODE_DEFAULT : null
      const price_display_mode_b = dividedB
        ? b.price_display_mode_b ?? PRICE_DISPLAY_MODE_DEFAULT
        : null
      const density_b = dividedB ? b.density_b ?? DENSITY_DEFAULT : null
      const title_size_b = dividedB ? b.title_size_b ?? TITLE_SIZE_DEFAULT : null
      const title_align_b = dividedB ? b.title_align_b ?? TITLE_ALIGN_DEFAULT : null

      if (layout_mode_b != null && !VALID_LAYOUT_MODES.has(layout_mode_b)) {
        fieldErrors.push(
          `box[${i}]: layout_mode_b must be one of: ${[...VALID_LAYOUT_MODES].join(', ')}`,
        )
        continue
      }
      if (
        price_display_mode_b != null &&
        !VALID_PRICE_DISPLAY_MODES.has(price_display_mode_b)
      ) {
        fieldErrors.push(
          `box[${i}]: price_display_mode_b must be one of: ${[...VALID_PRICE_DISPLAY_MODES].join(', ')}`,
        )
        continue
      }
      if (density_b != null && !VALID_DENSITIES.has(density_b)) {
        fieldErrors.push(
          `box[${i}]: density_b must be one of: ${[...VALID_DENSITIES].join(', ')}`,
        )
        continue
      }
      if (title_size_b != null && !VALID_TITLE_SIZES.has(title_size_b)) {
        fieldErrors.push(
          `box[${i}]: title_size_b must be one of: ${[...VALID_TITLE_SIZES].join(', ')}`,
        )
        continue
      }
      if (title_align_b != null && !VALID_TITLE_ALIGNS.has(title_align_b)) {
        fieldErrors.push(
          `box[${i}]: title_align_b must be one of: ${[...VALID_TITLE_ALIGNS].join(', ')}`,
        )
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
        division,
        box_type_b: b.box_type_b ?? null,
        header_override_b: b.header_override_b ?? null,
        square_menu_group_id_b: b.square_menu_group_id_b ?? null,
        aesthetic_image_id_b: b.aesthetic_image_id_b ?? null,
        layout_mode,
        price_display_mode,
        density,
        title_size,
        title_align,
        layout_mode_b,
        price_display_mode_b,
        density_b,
        title_size_b,
        title_align_b,
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

    // Phase 3 cross-row check: every non-null square_menu_group_id (slot A + B)
    // must reference an existing row in square_menu_categories for the CURRENT
    // tenant. Cross-tenant references are the load-bearing security boundary
    // here — without this check, a tampered request could bind tenant A's box
    // to tenant B's menu group, leaking content into phase 6's renderer.
    //
    // Single batched query (not N+1) — collect the unique referenced IDs and
    // run one `IN (...)` lookup, then diff against the requested set.
    const referencedGroupIds = Array.from(
      new Set(
        validatedBoxes
          .flatMap((b) => [b.square_menu_group_id, b.square_menu_group_id_b])
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    )
    if (referencedGroupIds.length > 0) {
      const { data: foundGroups, error: lookupError } = await supabase
        .from('square_menu_categories')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('id', referencedGroupIds)
      if (lookupError) {
        return NextResponse.json(
          { success: false, error: lookupError.message, code: 'KDS_SCREEN_UPDATE_FAILED' },
          { status: 500 },
        )
      }
      const foundSet = new Set(
        ((foundGroups ?? []) as Array<{ id: string }>).map((r) => r.id),
      )
      const missing = referencedGroupIds.filter((id) => !foundSet.has(id))
      if (missing.length > 0) {
        const errs = missing.map(
          (id) =>
            `square_menu_group_id "${id}" does not exist for this tenant ` +
            `(may be cross-tenant or never synced)`,
        )
        return NextResponse.json(
          {
            success: false,
            error: errs.join('; '),
            code: 'KDS_SCREEN_LAYOUT_INVALID',
            validation_errors: errs,
          },
          { status: 422 },
        )
      }
    }

    // Phase 4 (MOK-156) cross-row check: every non-null aesthetic_image_id
    // (slot A + B) must reference an existing row in kds_aesthetic_images for
    // the CURRENT tenant. Same load-bearing security boundary as the
    // menu-group check above — without this, tenant A could bind to tenant
    // B's image and leak content into phase 6's renderer.
    const referencedImageIds = Array.from(
      new Set(
        validatedBoxes
          .flatMap((b) => [b.aesthetic_image_id, b.aesthetic_image_id_b])
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    )
    if (referencedImageIds.length > 0) {
      const { data: foundImages, error: imageLookupError } = await supabase
        .from('kds_aesthetic_images')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('id', referencedImageIds)
      if (imageLookupError) {
        return NextResponse.json(
          { success: false, error: imageLookupError.message, code: 'KDS_SCREEN_UPDATE_FAILED' },
          { status: 500 },
        )
      }
      const foundImageSet = new Set(
        ((foundImages ?? []) as Array<{ id: string }>).map((r) => r.id),
      )
      const missingImages = referencedImageIds.filter((id) => !foundImageSet.has(id))
      if (missingImages.length > 0) {
        const errs = missingImages.map(
          (id) =>
            `aesthetic_image_id "${id}" does not exist for this tenant ` +
            `(may be cross-tenant or never created)`,
        )
        return NextResponse.json(
          {
            success: false,
            error: errs.join('; '),
            code: 'KDS_SCREEN_LAYOUT_INVALID',
            validation_errors: errs,
          },
          { status: 422 },
        )
      }
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
        // Phase 2.5 fields. PUT is replace-all, so undivided boxes write
        // explicit nulls/none — matching the DB CHECK invariant.
        division: b.division,
        box_type_b: b.box_type_b,
        header_override_b: b.header_override_b,
        square_menu_group_id_b: b.square_menu_group_id_b,
        aesthetic_image_id_b: b.aesthetic_image_id_b,
        // Phase 6 (MOK-158) — layout/price/whitespace formatting controls.
        layout_mode: b.layout_mode,
        price_display_mode: b.price_display_mode,
        density: b.density,
        title_size: b.title_size,
        title_align: b.title_align,
        layout_mode_b: b.layout_mode_b,
        price_display_mode_b: b.price_display_mode_b,
        density_b: b.density_b,
        title_size_b: b.title_size_b,
        title_align_b: b.title_align_b,
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
