/**
 * MOK-158 / KDS v3 phase 6 — single-batched render-fetch helper.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T4)
 *
 * Loads everything the renderer needs for a given screen + tenant in
 * batched, in-parallel-where-possible queries. Returns a fully-resolved
 * shape with override precedence applied, signed URLs attached, and
 * hidden-from-KDS items / variations filtered out.
 *
 * Server-side only (uses createServiceClient under the hood via the caller).
 * Tenant-scoped — passing the wrong tenant_id for a screen returns null,
 * matching the 404 the public route surfaces.
 *
 * Round-trip budget:
 *   1. parallel: kds_screens + kds_grid_boxes
 *   2. parallel: square_menu_categories + square_menu_item_categories
 *      (depends on box bindings from step 1)
 *   3. parallel: square_menu_items + square_menu_item_variations
 *      (depends on item_ids from step 2)
 *   4. kds_display_overrides (depends on item_ids + variation_ids)
 *   5. kds_aesthetic_images (union of box-level + override-level image refs)
 *   6. batched signed-URL request for uploaded images
 *
 * Override precedence (frozen in phase 5): variation override > item override
 * > Square default. Item-level overrides do NOT propagate to variations.
 * Hidden-from-KDS filtering is applied here so the renderer never sees
 * hidden rows.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveDisplayForItem,
  resolveDisplayForVariation,
  type DisplayOverride,
  type LayoutMode,
  type PriceDisplayMode,
} from './v3-render-helpers'

const SIGNED_URL_TTL_SECONDS = 60 * 60
const AESTHETIC_IMAGES_BUCKET = 'kds-v3-aesthetic-images'

// ─────────────────────────────────────────────────────────────────────────────
// Output shape
// ─────────────────────────────────────────────────────────────────────────────

export type Density = 'compact' | 'normal' | 'loose'
export type TitleSize = 'small' | 'medium' | 'large'
export type TitleAlign = 'left' | 'center' | 'right'
export type DivisionMode = 'none' | 'horizontal' | 'vertical'
export type BoxBorder = 'none' | 'thin' | 'thick'
export type BoxRadius = 'none' | 'sm' | 'lg'
export type BoxBackground = 'none' | 'white' | 'accent' | 'warm' | 'cool'

export interface SlotFormatting {
  layout_mode: LayoutMode
  price_display_mode: PriceDisplayMode
  density: Density
  title_size: TitleSize
  title_align: TitleAlign
  header_override: string | null
  /** Phase 6 addendum — optional second-line subtitle. Operator controls
   *  the content; the renderer styles it as muted secondary text. */
  subtitle_override: string | null
  /** Phase 6.5 (MOK-159) — variation emphasis for variation_column_header.
   *  - explicit_none = true  → no column emphasis at all
   *  - name set, explicit_none = false → emphasize column whose canonical
   *    name matches (case-insensitive)
   *  - name null, explicit_none = false → "Auto" — falls back to the
   *    phase 6 regex heuristic (/^(grande|medium|m)$/i) */
  emphasized_variation_name: string | null
  emphasized_variation_explicit_none: boolean
}

/**
 * Phase 6 addendum — per-box visual chrome (wraps the whole box, including
 * any divided halves). Operator-controlled; values map to Tailwind classes
 * at the renderer.
 */
export interface BoxChrome {
  border: BoxBorder
  radius: BoxRadius
  background: BoxBackground
}

export interface ResolvedImage {
  id: string
  name: string
  source_kind: 'uploaded' | 'external'
  url: string | null
  alt_text: string | null
}

export interface ResolvedVariation {
  id: string
  display_name: string
  price_cents: number | null
  alt_image: ResolvedImage | null
}

export interface ResolvedItem {
  id: string
  display_name: string
  alt_image: ResolvedImage | null
  variations: ResolvedVariation[]
}

export interface ResolvedGroup {
  id: string
  name: string
  items: ResolvedItem[]
}

export type ResolvedSlotContent =
  | { kind: 'menu_group'; group: ResolvedGroup; formatting: SlotFormatting }
  | { kind: 'image_only'; image: ResolvedImage | null; header_override: string | null }
  | { kind: 'unbound' }

export interface ResolvedBox {
  id: string
  position: number
  row_start: number
  col_start: number
  row_span: number
  col_span: number
  division: DivisionMode
  /** Phase 6 addendum — visual chrome wrapping the whole box. */
  chrome: BoxChrome
  slotA: ResolvedSlotContent
  slotB: ResolvedSlotContent | null
}

export interface ResolvedScreen {
  screen: {
    id: string
    tenant_id: string
    name: string
    grid_rows: number
    grid_cols: number
    theme: string
  }
  boxes: ResolvedBox[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw row shapes (read-only views of the relevant DB columns)
// ─────────────────────────────────────────────────────────────────────────────

interface BoxRow {
  id: string
  position: number
  row_start: number
  col_start: number
  row_span: number
  col_span: number
  box_type: 'menu_group' | 'image_only'
  header_override: string | null
  square_menu_group_id: string | null
  aesthetic_image_id: string | null
  division: DivisionMode
  box_type_b: 'menu_group' | 'image_only' | null
  header_override_b: string | null
  square_menu_group_id_b: string | null
  aesthetic_image_id_b: string | null
  layout_mode: LayoutMode
  price_display_mode: PriceDisplayMode
  density: Density
  title_size: TitleSize
  title_align: TitleAlign
  layout_mode_b: LayoutMode | null
  price_display_mode_b: PriceDisplayMode | null
  density_b: Density | null
  title_size_b: TitleSize | null
  title_align_b: TitleAlign | null
  // Phase 6 addendum — featured_list + box chrome + per-slot subtitle.
  subtitle_override: string | null
  subtitle_override_b: string | null
  box_border: BoxBorder
  box_radius: BoxRadius
  box_background: BoxBackground
  // Phase 6.5 (MOK-159) — variation emphasis (per slot).
  emphasized_variation_name: string | null
  emphasized_variation_explicit_none: boolean
  emphasized_variation_name_b: string | null
  emphasized_variation_explicit_none_b: boolean
}

interface CategoryRow {
  id: string
  name: string
}

interface ItemRow {
  id: string
  name: string
  is_deleted: boolean
}

interface VariationRow {
  id: string
  item_id: string
  name: string
  price_cents: number | null
  ordinal: number
  is_deleted: boolean
}

interface ImageRow {
  id: string
  name: string
  source_kind: 'uploaded' | 'external'
  storage_path: string | null
  external_url: string | null
  alt_text: string | null
  is_deleted: boolean
}

interface OverrideRow {
  target_kind: 'item' | 'variation'
  target_id: string
  alt_display_name: string | null
  alt_image_aesthetic_image_id: string | null
  hidden_from_kds: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 6.5 (MOK-159) — controls which set of tables the screen + boxes are
 * pulled from:
 *   - 'published' (default) → snapshot tables (kds_published_screens +
 *     kds_published_grid_boxes). Used by the Pi-facing route.
 *   - 'draft' → live draft tables (kds_screens + kds_grid_boxes). Used by
 *     the admin preview tab + the standalone admin preview page so the
 *     operator sees their unsaved-but-saved iteration immediately.
 *
 * Override + image + menu-group resolution is unchanged across sources —
 * only the screen-composition layer is snapshotted. Square data, display
 * overrides, and aesthetic images are always live.
 */
export type RenderSource = 'published' | 'draft'

interface ResolveOptions {
  source?: RenderSource
}

export async function resolveScreenForRender(
  supabase: SupabaseClient,
  tenantId: string,
  screenId: string,
  opts: ResolveOptions = {},
): Promise<ResolvedScreen | null> {
  const source: RenderSource = opts.source ?? 'published'
  const screensTable = source === 'published' ? 'kds_published_screens' : 'kds_screens'
  const boxesTable = source === 'published' ? 'kds_published_grid_boxes' : 'kds_grid_boxes'

  // Step 1: screen + boxes in parallel.
  const [screenRes, boxesRes] = await Promise.all([
    supabase
      .from(screensTable)
      .select('id, tenant_id, name, grid_rows, grid_cols, theme')
      .eq('id', screenId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from(boxesTable)
      .select(
        'id, position, row_start, col_start, row_span, col_span, ' +
          'box_type, header_override, square_menu_group_id, aesthetic_image_id, ' +
          'division, box_type_b, header_override_b, square_menu_group_id_b, aesthetic_image_id_b, ' +
          'layout_mode, price_display_mode, density, title_size, title_align, ' +
          'layout_mode_b, price_display_mode_b, density_b, title_size_b, title_align_b, ' +
          'subtitle_override, subtitle_override_b, box_border, box_radius, box_background, ' +
          'emphasized_variation_name, emphasized_variation_explicit_none, ' +
          'emphasized_variation_name_b, emphasized_variation_explicit_none_b',
      )
      .eq('tenant_id', tenantId)
      .eq('screen_id', screenId)
      .order('position', { ascending: true }),
  ])

  if (screenRes.error) throw new Error(`${screensTable} fetch: ${screenRes.error.message}`)
  if (!screenRes.data) return null
  if (boxesRes.error) throw new Error(`${boxesTable} fetch: ${boxesRes.error.message}`)

  const screen = screenRes.data as ResolvedScreen['screen']
  const boxRows = (boxesRes.data ?? []) as BoxRow[]

  // Collect referenced IDs across both slots.
  const groupIds = uniqueNonNull(
    boxRows.flatMap((b) => [b.square_menu_group_id, b.square_menu_group_id_b]),
  )
  const boxImageIds = uniqueNonNull(
    boxRows.flatMap((b) => [b.aesthetic_image_id, b.aesthetic_image_id_b]),
  )

  // Step 2: menu_categories + item_category memberships in parallel.
  const [categoriesRes, membershipsRes] = await Promise.all([
    groupIds.length > 0
      ? supabase
          .from('square_menu_categories')
          .select('id, name')
          .eq('tenant_id', tenantId)
          .in('id', groupIds)
      : Promise.resolve({ data: [] as CategoryRow[], error: null }),
    groupIds.length > 0
      ? supabase
          .from('square_menu_item_categories')
          .select('item_id, category_id, ordinal')
          .eq('tenant_id', tenantId)
          .in('category_id', groupIds)
      : Promise.resolve({
          data: [] as Array<{ item_id: string; category_id: string; ordinal: number }>,
          error: null,
        }),
  ])
  if (categoriesRes.error) throw new Error(`square_menu_categories fetch: ${categoriesRes.error.message}`)
  if (membershipsRes.error)
    throw new Error(`square_menu_item_categories fetch: ${membershipsRes.error.message}`)

  const categories = (categoriesRes.data ?? []) as CategoryRow[]
  const memberships = (membershipsRes.data ?? []) as Array<{
    item_id: string
    category_id: string
    ordinal: number
  }>

  // Items belonging to bound groups; preserve membership ordinal for in-group
  // sort order.
  const itemIds = uniqueNonNull(memberships.map((m) => m.item_id))
  const membershipByItem = new Map<string, { category_id: string; ordinal: number }>()
  for (const m of memberships) {
    // If an item happens to belong to multiple bound groups (rare),
    // first-seen wins. Per-group filtering below uses the full memberships
    // list, not this map.
    if (!membershipByItem.has(m.item_id)) {
      membershipByItem.set(m.item_id, { category_id: m.category_id, ordinal: m.ordinal })
    }
  }

  // Step 3: items + variations in parallel.
  const [itemsRes, variationsRes] = await Promise.all([
    itemIds.length > 0
      ? supabase
          .from('square_menu_items')
          .select('id, name, is_deleted')
          .eq('tenant_id', tenantId)
          .in('id', itemIds)
      : Promise.resolve({ data: [] as ItemRow[], error: null }),
    itemIds.length > 0
      ? supabase
          .from('square_menu_item_variations')
          .select('id, item_id, name, price_cents, ordinal, is_deleted')
          .eq('tenant_id', tenantId)
          .in('item_id', itemIds)
      : Promise.resolve({ data: [] as VariationRow[], error: null }),
  ])
  if (itemsRes.error) throw new Error(`square_menu_items fetch: ${itemsRes.error.message}`)
  if (variationsRes.error)
    throw new Error(`square_menu_item_variations fetch: ${variationsRes.error.message}`)

  const items = (itemsRes.data ?? []) as ItemRow[]
  const variations = (variationsRes.data ?? []) as VariationRow[]

  // Step 4: overrides for the discovered item + variation set.
  const variationIds = variations.map((v) => v.id)
  const overrideTargetIds = uniqueNonNull([...itemIds, ...variationIds])
  const overridesRes = overrideTargetIds.length > 0
    ? await supabase
        .from('kds_display_overrides')
        .select(
          'target_kind, target_id, alt_display_name, alt_image_aesthetic_image_id, hidden_from_kds',
        )
        .eq('tenant_id', tenantId)
        .in('target_id', overrideTargetIds)
    : { data: [] as OverrideRow[], error: null }
  if (overridesRes.error) throw new Error(`kds_display_overrides fetch: ${overridesRes.error.message}`)
  const overrides = (overridesRes.data ?? []) as OverrideRow[]

  // Step 5: all aesthetic images referenced by either box-level bindings or
  // override alt_image refs.
  const overrideImageIds = uniqueNonNull(
    overrides.map((o) => o.alt_image_aesthetic_image_id),
  )
  const allImageIds = uniqueNonNull([...boxImageIds, ...overrideImageIds])
  const imagesRes = allImageIds.length > 0
    ? await supabase
        .from('kds_aesthetic_images')
        .select('id, name, source_kind, storage_path, external_url, alt_text, is_deleted')
        .eq('tenant_id', tenantId)
        .in('id', allImageIds)
    : { data: [] as ImageRow[], error: null }
  if (imagesRes.error) throw new Error(`kds_aesthetic_images fetch: ${imagesRes.error.message}`)
  const imageRows = (imagesRes.data ?? []) as ImageRow[]

  // Step 6: batched signed URLs for uploaded images.
  const uploadedPaths = imageRows
    .filter((r) => r.source_kind === 'uploaded' && r.storage_path != null)
    .map((r) => r.storage_path as string)
  const signedUrlByPath = new Map<string, string>()
  if (uploadedPaths.length > 0) {
    const { data: signed, error: signErr } = await supabase.storage
      .from(AESTHETIC_IMAGES_BUCKET)
      .createSignedUrls(uploadedPaths, SIGNED_URL_TTL_SECONDS)
    if (signErr) throw new Error(`createSignedUrls: ${signErr.message}`)
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) {
        signedUrlByPath.set(entry.path, entry.signedUrl)
      }
    }
  }

  // ── Indexes for O(1) lookup during assembly ───────────────────────────────
  const categoryById = new Map<string, CategoryRow>()
  for (const c of categories) categoryById.set(c.id, c)

  const itemById = new Map<string, ItemRow>()
  for (const it of items) itemById.set(it.id, it)

  const variationsByItem = new Map<string, VariationRow[]>()
  for (const v of variations) {
    const arr = variationsByItem.get(v.item_id) ?? []
    arr.push(v)
    variationsByItem.set(v.item_id, arr)
  }
  // Sort each item's variations by ordinal (then id for stability).
  for (const [, arr] of variationsByItem) {
    arr.sort((a, b) => (a.ordinal - b.ordinal) || a.id.localeCompare(b.id))
  }

  const itemsByCategory = new Map<string, ItemRow[]>()
  for (const m of memberships) {
    const item = itemById.get(m.item_id)
    if (!item || item.is_deleted) continue
    const arr = itemsByCategory.get(m.category_id) ?? []
    arr.push(item)
    itemsByCategory.set(m.category_id, arr)
  }
  // Items within a category sort by their per-category ordinal. Build an
  // ordinal map first so the sort is fast.
  const ordinalByItemInCategory = new Map<string, Map<string, number>>()
  for (const m of memberships) {
    let inner = ordinalByItemInCategory.get(m.category_id)
    if (!inner) {
      inner = new Map()
      ordinalByItemInCategory.set(m.category_id, inner)
    }
    inner.set(m.item_id, m.ordinal)
  }
  for (const [catId, arr] of itemsByCategory) {
    const inner = ordinalByItemInCategory.get(catId) ?? new Map()
    arr.sort((a, b) => (inner.get(a.id) ?? 0) - (inner.get(b.id) ?? 0))
  }

  const overrideByTargetId = new Map<string, DisplayOverride>()
  for (const o of overrides) overrideByTargetId.set(o.target_id, o)

  const imageById = new Map<string, ResolvedImage>()
  for (const r of imageRows) {
    imageById.set(r.id, {
      id: r.id,
      name: r.name,
      source_kind: r.source_kind,
      url:
        r.source_kind === 'uploaded'
          ? signedUrlByPath.get(r.storage_path ?? '') ?? null
          : r.external_url,
      alt_text: r.alt_text,
    })
  }

  // ── Assemble per-slot content + filter hidden items / variations ──────────

  function resolveImage(id: string | null): ResolvedImage | null {
    if (!id) return null
    return imageById.get(id) ?? null
  }

  function resolveGroup(categoryId: string): ResolvedGroup | null {
    const cat = categoryById.get(categoryId)
    if (!cat) return null

    const groupItems = (itemsByCategory.get(categoryId) ?? []).map((raw): ResolvedItem | null => {
      const override = overrideByTargetId.get(raw.id) ?? null
      const itemDisplay = resolveDisplayForItem(raw, override)
      if (itemDisplay.hidden) return null

      const itemVariations = (variationsByItem.get(raw.id) ?? [])
        .filter((v) => !v.is_deleted)
        .map((v): ResolvedVariation | null => {
          const vOverride = overrideByTargetId.get(v.id) ?? null
          const vDisplay = resolveDisplayForVariation(v, vOverride)
          if (vDisplay.hidden) return null
          return {
            id: v.id,
            display_name: vDisplay.display_name,
            price_cents: v.price_cents,
            alt_image: resolveImage(vDisplay.alt_image_id),
          }
        })
        .filter((v): v is ResolvedVariation => v !== null)

      return {
        id: raw.id,
        display_name: itemDisplay.display_name,
        alt_image: resolveImage(itemDisplay.alt_image_id),
        variations: itemVariations,
      }
    })
    return {
      id: cat.id,
      name: cat.name,
      items: groupItems.filter((it): it is ResolvedItem => it !== null),
    }
  }

  function buildSlot(
    box_type: 'menu_group' | 'image_only' | null,
    group_id: string | null,
    image_id: string | null,
    header_override: string | null,
    formatting: SlotFormatting | null,
  ): ResolvedSlotContent {
    if (box_type === 'menu_group') {
      if (!group_id || !formatting) return { kind: 'unbound' }
      const group = resolveGroup(group_id)
      if (!group) return { kind: 'unbound' }
      return { kind: 'menu_group', group, formatting: { ...formatting, header_override } }
    }
    if (box_type === 'image_only') {
      return { kind: 'image_only', image: resolveImage(image_id), header_override }
    }
    return { kind: 'unbound' }
  }

  const resolvedBoxes: ResolvedBox[] = boxRows.map((b) => {
    const slotAFormatting: SlotFormatting = {
      layout_mode: b.layout_mode,
      price_display_mode: b.price_display_mode,
      density: b.density,
      title_size: b.title_size,
      title_align: b.title_align,
      header_override: b.header_override,
      subtitle_override: b.subtitle_override,
      emphasized_variation_name: b.emphasized_variation_name,
      emphasized_variation_explicit_none: b.emphasized_variation_explicit_none,
    }
    const slotA = buildSlot(
      b.box_type,
      b.square_menu_group_id,
      b.aesthetic_image_id,
      b.header_override,
      slotAFormatting,
    )

    let slotB: ResolvedSlotContent | null = null
    if (b.box_type_b != null && b.layout_mode_b && b.price_display_mode_b && b.density_b && b.title_size_b && b.title_align_b) {
      const slotBFormatting: SlotFormatting = {
        layout_mode: b.layout_mode_b,
        price_display_mode: b.price_display_mode_b,
        density: b.density_b,
        title_size: b.title_size_b,
        title_align: b.title_align_b,
        header_override: b.header_override_b,
        subtitle_override: b.subtitle_override_b,
        emphasized_variation_name: b.emphasized_variation_name_b,
        emphasized_variation_explicit_none: b.emphasized_variation_explicit_none_b,
      }
      slotB = buildSlot(
        b.box_type_b,
        b.square_menu_group_id_b,
        b.aesthetic_image_id_b,
        b.header_override_b,
        slotBFormatting,
      )
    }

    return {
      id: b.id,
      position: b.position,
      row_start: b.row_start,
      col_start: b.col_start,
      row_span: b.row_span,
      col_span: b.col_span,
      division: b.division,
      chrome: {
        border: b.box_border,
        radius: b.box_radius,
        background: b.box_background,
      },
      slotA,
      slotB,
    }
  })

  return { screen, boxes: resolvedBoxes }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function uniqueNonNull(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>()
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) set.add(v)
  }
  return [...set]
}
