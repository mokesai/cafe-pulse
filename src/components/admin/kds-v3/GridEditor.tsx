'use client'

/**
 * MOK-152 / KDS v3 phase 2 — drag-resize grid editor.
 *
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T6 / T-A)
 *
 * Wraps react-grid-layout for the operator-facing layout editor:
 *   - Drag to move, corner-handle to resize. Snaps to grid cells.
 *   - Each box shows its position number prominently + a size badge.
 *   - Add Box places a 1x1 at the first free cell.
 *   - Delete removes the box without renumbering survivors (position
 *     stability is a hard invariant of phase 2).
 *
 * Layout sizing: the preview is locked to a 16:9 aspect ratio (matching the
 * target HD TV display). rowHeight is derived dynamically from the measured
 * container width, so any rows × cols configuration fills exactly one screen
 * worth of preview area. This means 24-row grids show the same total height
 * as 4-row grids — only the individual cells get shorter.
 *
 * Empty cells are visualized via a CSS-grid backdrop drawn underneath the
 * react-grid-layout container so the operator can see the full grid even
 * before placing any boxes.
 *
 * Box-content controls (menu_group / image_only) appear inline but the
 * selectors are disabled with a "configured in phase 3 / phase 4" hint.
 *
 * CSS Note: react-grid-layout's CSS is imported in src/app/globals.css
 * (not here). Component-level CSS imports of third-party styles broke
 * webpack dev-mode chunk resolution in this project.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
// react-grid-layout@2.x ships a hook-based API at the package root; the
// HOC-based API (GridLayout) lives at /legacy. We import GridLayout from
// legacy and provide `width` explicitly (via our own ResizeObserver) so we
// can derive rowHeight from the same width measurement — keeping the
// preview locked to a 16:9 aspect ratio.
//
// Note: in v2 legacy types, `Layout` is the array type (readonly LayoutItem[]);
// the individual item type is `LayoutItem`. v1's @types/react-grid-layout
// shipped Layout-as-item, hence the explicit LayoutItem usage below.
import GridLayout, { type LayoutItem } from 'react-grid-layout/legacy'
import {
  nextAvailablePosition,
  firstFreeCell,
  type GridBox,
  type DivisionMode,
} from '@/lib/kds/grid-validation'

// Phase 6 (MOK-158) — string-literal enums for the 5 new per-slot controls.
export type LayoutMode =
  | 'simple_list'
  | 'variation_column_header'
  | 'flavor_list'
  | 'compact_list'
  | 'featured_list'
export type PriceDisplayMode = 'none' | 'lowest' | 'range' | 'base'
export type Density = 'compact' | 'normal' | 'loose'
export type TitleSize = 'small' | 'medium' | 'large'
export type TitleAlign = 'left' | 'center' | 'right'

// Phase 6 addendum — per-box visual chrome (single set, wraps both slots).
export type BoxBorder = 'none' | 'thin' | 'thick'
export type BoxRadius = 'none' | 'sm' | 'lg'
export type BoxBackground = 'none' | 'white' | 'accent' | 'warm' | 'cool'

export interface EditableBox extends GridBox {
  box_type: 'menu_group' | 'image_only'
  header_override?: string | null
  // Phase 3 (MOK-155) — slot-A menu-group binding + (future) image binding.
  square_menu_group_id?: string | null
  aesthetic_image_id?: string | null
  // Phase 2.5 (MOK-154) — optional second-slot fields.
  division?: DivisionMode
  box_type_b?: 'menu_group' | 'image_only' | null
  header_override_b?: string | null
  square_menu_group_id_b?: string | null
  aesthetic_image_id_b?: string | null
  // Phase 6 (MOK-158) — slot-A layout/price/whitespace controls.
  layout_mode?: LayoutMode
  price_display_mode?: PriceDisplayMode
  density?: Density
  title_size?: TitleSize
  title_align?: TitleAlign
  // Phase 6 — slot-B mirrors (null when undivided).
  layout_mode_b?: LayoutMode | null
  price_display_mode_b?: PriceDisplayMode | null
  density_b?: Density | null
  title_size_b?: TitleSize | null
  title_align_b?: TitleAlign | null
  // Phase 6 addendum — per-slot subtitle + per-box chrome.
  subtitle_override?: string | null
  subtitle_override_b?: string | null
  // Phase 6.5 (MOK-159) — variation emphasis (variation_column_header only).
  emphasized_variation_name?: string | null
  emphasized_variation_explicit_none?: boolean
  emphasized_variation_name_b?: string | null
  emphasized_variation_explicit_none_b?: boolean
  box_border?: BoxBorder
  box_radius?: BoxRadius
  box_background?: BoxBackground
}

const LAYOUT_MODE_DEFAULT: LayoutMode = 'simple_list'
const PRICE_DISPLAY_MODE_DEFAULT: PriceDisplayMode = 'lowest'
const DENSITY_DEFAULT: Density = 'normal'
const TITLE_SIZE_DEFAULT: TitleSize = 'medium'
const TITLE_ALIGN_DEFAULT: TitleAlign = 'left'
const BOX_BORDER_DEFAULT: BoxBorder = 'none'
const BOX_RADIUS_DEFAULT: BoxRadius = 'none'
const BOX_BACKGROUND_DEFAULT: BoxBackground = 'none'

// Layouts where the price-display dropdown's "lowest / range / base" values
// all collapse to the same rendering (because the layout has its own
// inherent price presentation — column matrix or group-level range). Only
// `none` is meaningfully distinct for these — it suppresses prices entirely.
// We surface a hint in the dropdown's tooltip but keep it enabled so the
// operator can still pick `none` to hide prices.
const LAYOUTS_WITH_INHERENT_PRICING = new Set<LayoutMode>([
  'variation_column_header',
  'compact_list',
])

/**
 * MOK-155 — shape returned by GET /api/admin/kds-v3/menu-groups, fetched once
 * on editor mount and used to populate the menu-group picker.
 */
export interface MenuGroupOption {
  id: string
  name: string
  ordinal: number
  item_count: number
  is_deleted: boolean
  parent_menu_id: string | null
  parent_menu_name: string | null
}

/**
 * MOK-156 — shape returned by GET /api/admin/kds-v3/aesthetic-images,
 * fetched once on editor mount and used to populate the image picker
 * for `image_only` slots.
 */
export interface AestheticImageOption {
  id: string
  name: string
  source_kind: 'uploaded' | 'external'
  is_deleted: boolean
  thumbnail_url: string | null
}

interface Props {
  grid_rows: number
  grid_cols: number
  boxes: EditableBox[]
  onChange: (boxes: EditableBox[]) => void
}

function sizeBadge(box: GridBox): { label: string; cls: string } {
  const cells = box.row_span * box.col_span
  if (cells <= 2) return { label: 'small', cls: 'bg-slate-100 text-slate-700' }
  if (cells <= 6) return { label: 'medium', cls: 'bg-blue-100 text-blue-700' }
  return { label: 'large', cls: 'bg-amber-100 text-amber-700' }
}

const GRID_MARGIN: [number, number] = [6, 6]
const ASPECT_RATIO = 16 / 9
const MIN_ROW_HEIGHT_PX = 8

/**
 * MOK-155 — render the per-slot controls in the selected-box panel.
 * Slot A is always shown; slot B only when the box is divided. Each slot
 * picks a type (menu_group | image_only) and — for menu_group slots —
 * an optional menu-group binding plus a header override.
 *
 * Defined at module scope (not nested inside GridEditor) so renders are
 * cheap; it's a presentation helper, not a stateful component.
 */
interface SlotControlsProps {
  label: string
  boxType: 'menu_group' | 'image_only'
  onBoxTypeChange: (t: 'menu_group' | 'image_only') => void
  squareMenuGroupId: string | null
  onMenuGroupChange: (id: string | null) => void
  // MOK-156 — slot image binding (used when boxType === 'image_only').
  aestheticImageId: string | null
  onImageChange: (id: string | null) => void
  headerOverride: string
  onHeaderOverrideChange: (text: string) => void
  menuGroups: MenuGroupOption[]
  aestheticImages: AestheticImageOption[]
  // Phase 6 (MOK-158) — per-slot layout / price-display / whitespace controls.
  // Surface only when boxType === 'menu_group'; image_only slots don't use
  // these.
  layoutMode: LayoutMode
  onLayoutModeChange: (m: LayoutMode) => void
  priceDisplayMode: PriceDisplayMode
  onPriceDisplayModeChange: (m: PriceDisplayMode) => void
  density: Density
  onDensityChange: (d: Density) => void
  titleSize: TitleSize
  onTitleSizeChange: (s: TitleSize) => void
  titleAlign: TitleAlign
  onTitleAlignChange: (a: TitleAlign) => void
  // Phase 6 addendum — per-slot subtitle (used by featured_list).
  subtitleOverride: string
  onSubtitleOverrideChange: (text: string) => void
  // Phase 6.5 (MOK-159) — variation emphasis (used by variation_column_header).
  emphasizedVariationName: string
  onEmphasizedVariationNameChange: (text: string) => void
  emphasizedVariationExplicitNone: boolean
  onEmphasizedVariationExplicitNoneChange: (value: boolean) => void
}

function renderSlotControls(props: SlotControlsProps) {
  const {
    label,
    boxType,
    onBoxTypeChange,
    squareMenuGroupId,
    onMenuGroupChange,
    aestheticImageId,
    onImageChange,
    headerOverride,
    onHeaderOverrideChange,
    menuGroups,
    aestheticImages,
    layoutMode,
    onLayoutModeChange,
    priceDisplayMode,
    onPriceDisplayModeChange,
    density,
    onDensityChange,
    titleSize,
    onTitleSizeChange,
    titleAlign,
    onTitleAlignChange,
    subtitleOverride,
    onSubtitleOverrideChange,
    emphasizedVariationName,
    onEmphasizedVariationNameChange,
    emphasizedVariationExplicitNone,
    onEmphasizedVariationExplicitNoneChange,
  } = props
  const inherentPricing = LAYOUTS_WITH_INHERENT_PRICING.has(layoutMode)
  const subtitleVisible = layoutMode === 'featured_list'
  const emphasisVisible = layoutMode === 'variation_column_header'

  // If the box is bound to a group that's not in the fetched list (sync
  // hasn't caught up yet, or the id was fabricated and is about to fail
  // server-side validation), inject a synthetic option so the operator
  // sees the stale value rather than a silently-empty dropdown.
  const knownGroupIds = new Set(menuGroups.map((g) => g.id))
  const hasUnknownGroup =
    squareMenuGroupId != null && squareMenuGroupId !== '' && !knownGroupIds.has(squareMenuGroupId)

  const knownImageIds = new Set(aestheticImages.map((i) => i.id))
  const hasUnknownImage =
    aestheticImageId != null && aestheticImageId !== '' && !knownImageIds.has(aestheticImageId)
  const selectedImage = aestheticImageId
    ? aestheticImages.find((i) => i.id === aestheticImageId) ?? null
    : null

  return (
    <div className="space-y-1.5 rounded border border-gray-200 bg-white p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-600">Type</label>
        <select
          value={boxType}
          onChange={(e) => onBoxTypeChange(e.target.value as 'menu_group' | 'image_only')}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
        >
          <option value="menu_group">menu_group</option>
          <option value="image_only">image_only</option>
        </select>
      </div>

      {boxType === 'menu_group' ? (
        <>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Menu group</label>
            <select
              value={squareMenuGroupId ?? ''}
              onChange={(e) => onMenuGroupChange(e.target.value === '' ? null : e.target.value)}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
            >
              <option value="">— Unbound —</option>
              {hasUnknownGroup && (
                <option value={squareMenuGroupId ?? ''}>
                  ⚠ unknown ({squareMenuGroupId})
                </option>
              )}
              {menuGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.is_deleted ? '⚠ (deleted) ' : ''}
                  {g.name}
                  {typeof g.item_count === 'number' ? ` · ${g.item_count} items` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Header</label>
            <input
              type="text"
              maxLength={60}
              value={headerOverride}
              onChange={(e) => onHeaderOverrideChange(e.target.value)}
              placeholder="(use group name)"
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
            />
          </div>
          {subtitleVisible && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600">Feature title</label>
              <input
                type="text"
                maxLength={120}
                value={subtitleOverride}
                onChange={(e) => onSubtitleOverrideChange(e.target.value)}
                placeholder="e.g. Most Popular"
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
              />
            </div>
          )}

          {/* Phase 6.5 (MOK-159) — variation emphasis (variation_column_header only) */}
          {emphasisVisible && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-600">Emphasize size</label>
                <input
                  type="text"
                  maxLength={120}
                  value={emphasizedVariationName}
                  disabled={emphasizedVariationExplicitNone}
                  onChange={(e) => onEmphasizedVariationNameChange(e.target.value)}
                  placeholder="e.g. Grande (blank = Auto)"
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>
              <label className="ml-[6rem] inline-flex items-center gap-1.5 text-[11px] text-gray-600">
                <input
                  type="checkbox"
                  checked={emphasizedVariationExplicitNone}
                  onChange={(e) => onEmphasizedVariationExplicitNoneChange(e.target.checked)}
                  className="rounded"
                />
                No emphasis (overrides Auto)
              </label>
              <p className="ml-[6rem] text-[10px] text-gray-500">
                Blank = Auto (matches Grande/Medium/M). Name must match a Square variation in
                this group, case-insensitive.
              </p>
            </div>
          )}

          {/* Phase 6 (MOK-158) — layout / price / whitespace controls */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Layout</label>
            <div className="inline-flex flex-wrap overflow-hidden rounded border border-gray-300">
              {(
                [
                  ['simple_list', 'Simple'],
                  ['variation_column_header', 'Columns'],
                  ['flavor_list', 'Flavors'],
                  ['compact_list', 'Compact'],
                  ['featured_list', 'Featured'],
                ] as Array<[LayoutMode, string]>
              ).map(([mode, label]) => {
                const active = layoutMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onLayoutModeChange(mode)}
                    className={`px-2 py-1 text-[11px] ${
                      active ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Price display</label>
            <select
              value={priceDisplayMode}
              title={
                inherentPricing
                  ? 'This layout has its own price presentation. Pick "none" to hide prices; other modes all show the layout\'s default pricing.'
                  : undefined
              }
              onChange={(e) => onPriceDisplayModeChange(e.target.value as PriceDisplayMode)}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
            >
              <option value="none">none</option>
              <option value="lowest">lowest (&quot;from $5.95&quot;)</option>
              <option value="range">range (&quot;$5.95 – $7.15&quot;)</option>
              <option value="base">base ($5.95)</option>
            </select>
          </div>
          {inherentPricing && (
            <p className="ml-[5.5rem] text-[10px] text-gray-500">
              This layout has its own price presentation. Pick &quot;none&quot; to hide prices.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Density
              </label>
              <select
                value={density}
                onChange={(e) => onDensityChange(e.target.value as Density)}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-700"
              >
                <option value="compact">compact</option>
                <option value="normal">normal</option>
                <option value="loose">loose</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Title size
              </label>
              <select
                value={titleSize}
                onChange={(e) => onTitleSizeChange(e.target.value as TitleSize)}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-700"
              >
                <option value="small">small</option>
                <option value="medium">medium</option>
                <option value="large">large</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Title align
              </label>
              <div className="inline-flex overflow-hidden rounded border border-gray-300">
                {(['left', 'center', 'right'] as TitleAlign[]).map((a) => {
                  const active = titleAlign === a
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => onTitleAlignChange(a)}
                      className={`flex-1 px-1.5 py-1 text-[11px] ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {a[0].toUpperCase()}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Image</label>
            <select
              value={aestheticImageId ?? ''}
              onChange={(e) => onImageChange(e.target.value === '' ? null : e.target.value)}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
            >
              <option value="">— Unbound —</option>
              {hasUnknownImage && (
                <option value={aestheticImageId ?? ''}>⚠ unknown ({aestheticImageId})</option>
              )}
              {aestheticImages.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.is_deleted ? '⚠ (deleted) ' : ''}
                  {i.name} · {i.source_kind}
                </option>
              ))}
            </select>
          </div>
          {selectedImage?.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedImage.thumbnail_url}
              alt={selectedImage.name}
              className="h-16 w-full rounded border border-gray-200 object-cover"
            />
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Header</label>
            <input
              type="text"
              maxLength={60}
              value={headerOverride}
              onChange={(e) => onHeaderOverrideChange(e.target.value)}
              placeholder="(no caption)"
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
            />
          </div>
        </>
      )}
    </div>
  )
}

export function GridEditor({ grid_rows, grid_cols, boxes, onChange }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // MOK-155 — fetch the tenant's menu groups once on mount to populate the
  // selected-box panel's picker. One round-trip per editor session; the
  // dropdown handles deleted groups by rendering them with a warning rather
  // than re-fetching on every selection change.
  const [menuGroups, setMenuGroups] = useState<MenuGroupOption[]>([])
  // MOK-156 — same shape for the aesthetic image library.
  const [aestheticImages, setAestheticImages] = useState<AestheticImageOption[]>([])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [groupsRes, imagesRes] = await Promise.all([
          fetch('/api/admin/kds-v3/menu-groups'),
          fetch('/api/admin/kds-v3/aesthetic-images'),
        ])
        const groupsBody = await groupsRes.json()
        const imagesBody = await imagesRes.json()
        if (cancelled) return
        if (groupsRes.ok && groupsBody.success && Array.isArray(groupsBody.data)) {
          setMenuGroups(groupsBody.data as MenuGroupOption[])
        }
        if (imagesRes.ok && imagesBody.success && Array.isArray(imagesBody.data)) {
          setAestheticImages(imagesBody.data as AestheticImageOption[])
        }
      } catch {
        // Non-fatal: editor still works without pickers; bindings stay
        // unchanged because the dropdowns just list what's available.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setWidth(w)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // 16:9 preview lock. Compute rowHeight so all rows fit in the 9/16-of-width
  // height, less the inter-row margins. (react-grid-layout adds marginY between
  // rows and at top/bottom, totaling (rows + 1) * marginY of vertical margin.)
  const [marginX, marginY] = GRID_MARGIN
  const previewHeight = width * (1 / ASPECT_RATIO)
  const rowHeight = Math.max(
    MIN_ROW_HEIGHT_PX,
    (previewHeight - (grid_rows + 1) * marginY) / grid_rows,
  )
  const colWidth = (width - (grid_cols + 1) * marginX) / grid_cols

  const backdropCells = useMemo(() => {
    if (width === 0) return []
    const cells: Array<{ left: number; top: number; width: number; height: number; key: string }> = []
    for (let r = 0; r < grid_rows; r++) {
      for (let c = 0; c < grid_cols; c++) {
        cells.push({
          key: `${r}-${c}`,
          left: marginX + c * (colWidth + marginX),
          top: marginY + r * (rowHeight + marginY),
          width: colWidth,
          height: rowHeight,
        })
      }
    }
    return cells
  }, [width, grid_rows, grid_cols, colWidth, rowHeight, marginX, marginY])

  const layout: LayoutItem[] = useMemo(
    () =>
      boxes.map((b) => ({
        i: String(b.position),
        x: b.col_start - 1, // react-grid-layout is 0-based; our model is 1-based
        y: b.row_start - 1,
        w: b.col_span,
        h: b.row_span,
      })),
    [boxes],
  )

  const handleLayoutChange = (newLayout: readonly LayoutItem[]) => {
    const next: EditableBox[] = boxes.map((b) => {
      const li = newLayout.find((l) => l.i === String(b.position))
      if (!li) return b
      return {
        ...b,
        col_start: li.x + 1,
        row_start: li.y + 1,
        col_span: li.w,
        row_span: li.h,
      }
    })
    onChange(next)
  }

  const addBox = () => {
    const free = firstFreeCell(boxes, { rows: grid_rows, cols: grid_cols })
    if (!free) {
      alert('Grid is fully occupied — resize an existing box or expand the grid first.')
      return
    }
    const position = nextAvailablePosition(boxes)
    onChange([
      ...boxes,
      {
        position,
        row_start: free.row,
        col_start: free.col,
        row_span: 1,
        col_span: 1,
        box_type: 'menu_group',
      },
    ])
    setSelected(position)
  }

  const removeBox = (position: number) => {
    onChange(boxes.filter((b) => b.position !== position))
    if (selected === position) setSelected(null)
  }

  const updateBoxType = (position: number, box_type: 'menu_group' | 'image_only') => {
    // MOK-155/156 defense: when the operator flips a slot's type, clear the
    // cross-type binding so the next save doesn't get rejected by the
    // server-side invariants (image_only-with-group / menu_group-with-image).
    onChange(
      boxes.map((b) =>
        b.position === position
          ? {
              ...b,
              box_type,
              square_menu_group_id: box_type === 'menu_group' ? b.square_menu_group_id ?? null : null,
              aesthetic_image_id: box_type === 'image_only' ? b.aesthetic_image_id ?? null : null,
            }
          : b,
      ),
    )
  }

  // Phase 2.5 — toggle division on a box. Going to 'none' clears slot-B
  // fields atomically (single state update, no React batching surprises).
  // Going from 'none' to a divided mode initializes box_type_b='menu_group'
  // so the DB CHECK invariant holds the moment we save.
  //
  // Phase 6 (MOK-158): also clear / initialize the slot-B formatting columns
  // (layout_mode_b through title_align_b) so the cross-slot-B formatting
  // invariant CHECK passes — all slot-B formatting columns must be NULL
  // when box_type_b is NULL, and all NOT NULL when box_type_b is set.
  const setBoxDivision = (position: number, division: DivisionMode) => {
    onChange(
      boxes.map((b) => {
        if (b.position !== position) return b
        if (division === 'none') {
          return {
            ...b,
            division: 'none',
            box_type_b: null,
            header_override_b: null,
            square_menu_group_id_b: null,
            aesthetic_image_id_b: null,
            layout_mode_b: null,
            price_display_mode_b: null,
            density_b: null,
            title_size_b: null,
            title_align_b: null,
            subtitle_override_b: null,
            emphasized_variation_name_b: null,
            emphasized_variation_explicit_none_b: false,
          }
        }
        return {
          ...b,
          division,
          box_type_b: b.box_type_b ?? 'menu_group',
          layout_mode_b: b.layout_mode_b ?? LAYOUT_MODE_DEFAULT,
          price_display_mode_b: b.price_display_mode_b ?? PRICE_DISPLAY_MODE_DEFAULT,
          density_b: b.density_b ?? DENSITY_DEFAULT,
          title_size_b: b.title_size_b ?? TITLE_SIZE_DEFAULT,
          title_align_b: b.title_align_b ?? TITLE_ALIGN_DEFAULT,
        }
      }),
    )
  }

  const updateBoxTypeB = (position: number, box_type_b: 'menu_group' | 'image_only') => {
    onChange(
      boxes.map((b) =>
        b.position === position
          ? {
              ...b,
              box_type_b,
              square_menu_group_id_b:
                box_type_b === 'menu_group' ? b.square_menu_group_id_b ?? null : null,
              aesthetic_image_id_b:
                box_type_b === 'image_only' ? b.aesthetic_image_id_b ?? null : null,
            }
          : b,
      ),
    )
  }

  // Phase 3 helpers — update the menu-group binding or header override on
  // either slot. `null` clears the field. Both helpers preserve every other
  // field on the box.
  const updateMenuGroup = (
    position: number,
    slot: 'a' | 'b',
    square_menu_group_id: string | null,
  ) => {
    const key = slot === 'a' ? 'square_menu_group_id' : 'square_menu_group_id_b'
    onChange(
      boxes.map((b) => (b.position === position ? { ...b, [key]: square_menu_group_id } : b)),
    )
  }

  // Phase 4 — same shape for the aesthetic image binding.
  const updateImageBinding = (
    position: number,
    slot: 'a' | 'b',
    aesthetic_image_id: string | null,
  ) => {
    const key = slot === 'a' ? 'aesthetic_image_id' : 'aesthetic_image_id_b'
    onChange(
      boxes.map((b) => (b.position === position ? { ...b, [key]: aesthetic_image_id } : b)),
    )
  }

  const updateHeaderOverride = (
    position: number,
    slot: 'a' | 'b',
    header_override: string | null,
  ) => {
    const key = slot === 'a' ? 'header_override' : 'header_override_b'
    onChange(
      boxes.map((b) => (b.position === position ? { ...b, [key]: header_override } : b)),
    )
  }

  // Phase 6 (MOK-158) helpers — write a single per-slot formatting field.
  const updateLayoutMode = (position: number, slot: 'a' | 'b', mode: LayoutMode) => {
    const key = slot === 'a' ? 'layout_mode' : 'layout_mode_b'
    onChange(boxes.map((b) => (b.position === position ? { ...b, [key]: mode } : b)))
  }
  const updatePriceDisplayMode = (
    position: number,
    slot: 'a' | 'b',
    mode: PriceDisplayMode,
  ) => {
    const key = slot === 'a' ? 'price_display_mode' : 'price_display_mode_b'
    onChange(boxes.map((b) => (b.position === position ? { ...b, [key]: mode } : b)))
  }
  const updateDensity = (position: number, slot: 'a' | 'b', d: Density) => {
    const key = slot === 'a' ? 'density' : 'density_b'
    onChange(boxes.map((b) => (b.position === position ? { ...b, [key]: d } : b)))
  }
  const updateTitleSize = (position: number, slot: 'a' | 'b', s: TitleSize) => {
    const key = slot === 'a' ? 'title_size' : 'title_size_b'
    onChange(boxes.map((b) => (b.position === position ? { ...b, [key]: s } : b)))
  }
  const updateTitleAlign = (position: number, slot: 'a' | 'b', a: TitleAlign) => {
    const key = slot === 'a' ? 'title_align' : 'title_align_b'
    onChange(boxes.map((b) => (b.position === position ? { ...b, [key]: a } : b)))
  }

  // Phase 6 addendum — per-slot subtitle (used by featured_list).
  const updateSubtitleOverride = (
    position: number,
    slot: 'a' | 'b',
    subtitle_override: string | null,
  ) => {
    const key = slot === 'a' ? 'subtitle_override' : 'subtitle_override_b'
    onChange(boxes.map((b) => (b.position === position ? { ...b, [key]: subtitle_override } : b)))
  }

  // Phase 6.5 (MOK-159) — emphasized-variation helpers.
  const updateEmphasizedVariationName = (
    position: number,
    slot: 'a' | 'b',
    name: string | null,
  ) => {
    const key = slot === 'a' ? 'emphasized_variation_name' : 'emphasized_variation_name_b'
    onChange(boxes.map((b) => (b.position === position ? { ...b, [key]: name } : b)))
  }
  const updateEmphasizedVariationExplicitNone = (
    position: number,
    slot: 'a' | 'b',
    value: boolean,
  ) => {
    const key =
      slot === 'a'
        ? 'emphasized_variation_explicit_none'
        : 'emphasized_variation_explicit_none_b'
    onChange(boxes.map((b) => (b.position === position ? { ...b, [key]: value } : b)))
  }

  // Phase 6 addendum — per-box chrome (single set, wraps both slots).
  const updateBoxBorder = (position: number, border: BoxBorder) => {
    onChange(boxes.map((b) => (b.position === position ? { ...b, box_border: border } : b)))
  }
  const updateBoxRadius = (position: number, radius: BoxRadius) => {
    onChange(boxes.map((b) => (b.position === position ? { ...b, box_radius: radius } : b)))
  }
  const updateBoxBackground = (position: number, background: BoxBackground) => {
    onChange(boxes.map((b) => (b.position === position ? { ...b, box_background: background } : b)))
  }

  const selectedBox = selected !== null ? boxes.find((b) => b.position === selected) ?? null : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">
          Grid layout — {boxes.length} {boxes.length === 1 ? 'box' : 'boxes'}
        </p>
        <button
          type="button"
          onClick={addBox}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          + Add Box
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-md border border-gray-300 bg-gray-100"
        style={{ aspectRatio: `${ASPECT_RATIO}` }}
      >
        {/* Empty-cell backdrop — visualizes the full grid so empty cells are
            visible behind the live editor. */}
        <div className="pointer-events-none absolute inset-0">
          {backdropCells.map((cell) => (
            <div
              key={cell.key}
              className="absolute rounded-sm bg-white/70 ring-1 ring-inset ring-gray-200"
              style={{
                left: cell.left,
                top: cell.top,
                width: cell.width,
                height: cell.height,
              }}
            />
          ))}
        </div>

        {/* Live editor — only rendered once we have a measured width so
            react-grid-layout can size items correctly on first paint. */}
        {width > 0 && (
          <GridLayout
            className="layout absolute inset-0"
            // Inline height: 100% is load-bearing. react-grid-layout's own
            // stylesheet forces .react-grid-layout { position: relative }, so
            // our `absolute inset-0` class loses the cascade and inset-based
            // sizing doesn't apply. With autoSize={false} the library leaves
            // inline `height` undefined, collapsing the div to 0px tall —
            // which makes react-draggable's offsetParent measurement clamp
            // drag offsets to nothing past the last placed item. Setting
            // height: 100% inline overrides via specificity and resolves
            // against the 16:9 parent's computed height.
            style={{ height: '100%' }}
            width={width}
            layout={layout}
            cols={grid_cols}
            rowHeight={rowHeight}
            maxRows={grid_rows}
            margin={GRID_MARGIN}
            compactType={null}
            // allowOverlap lets the operator drag a box freely across the grid
            // without getting blocked at every occupied cell in the path. With
            // preventCollision (and compactType=null), react-grid-layout
            // snap-backs on every intermediate collision — so you couldn't
            // drag a box past another in any direction. Overlap is permitted
            // visually during drag; ScreenForm's live validateBoxLayout
            // surfaces overlap errors above the editor and the server-side
            // validator rejects an overlapping save.
            allowOverlap
            // autoSize={false}: keep the layout container the size of the 16:9
            // parent regardless of how many rows the placed boxes occupy. With
            // autoSize=true (default) the container shrinks to fit only the
            // top-most boxes.
            autoSize={false}
            onLayoutChange={handleLayoutChange}
            onDragStart={(_l, item) => item && setSelected(Number(item.i))}
            onResizeStart={(_l, item) => item && setSelected(Number(item.i))}
          >
            {boxes.map((box) => {
              const isSelected = selected === box.position
              const sb = sizeBadge(box)
              const division = box.division ?? 'none'
              // Phase 2.5: divided boxes render two halves with a 1px divider.
              // Slot label suffix: `Na` (top/left) and `Nb` (bottom/right).
              if (division === 'horizontal' || division === 'vertical') {
                const isHorizontal = division === 'horizontal'
                return (
                  <div
                    key={String(box.position)}
                    className={`overflow-hidden rounded-md border bg-white shadow-sm transition-colors ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'
                    } ${isHorizontal ? 'flex flex-col' : 'flex flex-row'}`}
                    onClick={() => setSelected(box.position)}
                  >
                    <div className="flex flex-1 flex-col items-center justify-center text-center">
                      <span className="text-xs font-semibold text-gray-700">{box.position}a</span>
                      <span className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] ${sb.cls}`}>
                        {box.box_type === 'menu_group' ? 'menu' : 'image'}
                      </span>
                    </div>
                    <div
                      className={`bg-gray-400 ${isHorizontal ? 'h-px w-full' : 'h-full w-px'}`}
                      aria-hidden="true"
                    />
                    <div className="flex flex-1 flex-col items-center justify-center text-center">
                      <span className="text-xs font-semibold text-gray-700">{box.position}b</span>
                      <span className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] ${sb.cls}`}>
                        {(box.box_type_b ?? 'menu_group') === 'menu_group' ? 'menu' : 'image'}
                      </span>
                    </div>
                  </div>
                )
              }
              return (
                <div
                  key={String(box.position)}
                  className={`flex flex-col items-center justify-center overflow-hidden rounded-md border bg-white text-center shadow-sm transition-colors ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'
                  }`}
                  onClick={() => setSelected(box.position)}
                >
                  <span className="text-sm font-semibold text-gray-700">{box.position}</span>
                  <span className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] ${sb.cls}`}>
                    {sb.label}
                  </span>
                </div>
              )
            })}
          </GridLayout>
        )}
      </div>

      {selectedBox ? (
        (() => {
          const division: DivisionMode = selectedBox.division ?? 'none'
          const divided = division !== 'none'
          // Min-span guard mirrors the route + DB validation. The segmented
          // control disables modes whose span requirement isn't met by the
          // current box dimensions — operator must resize first.
          const canHorizontal = selectedBox.row_span >= 2
          const canVertical = selectedBox.col_span >= 2
          return (
            <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-semibold text-gray-800">Box {selectedBox.position}</span>
                  <span className="ml-2 text-gray-500">
                    row {selectedBox.row_start}, col {selectedBox.col_start} ·{' '}
                    {selectedBox.row_span}×{selectedBox.col_span}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeBox(selectedBox.position)}
                  className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Delete box
                </button>
              </div>

              {/* Phase 6 addendum — per-box chrome (single set, wraps the
                  whole box including any divided halves). */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">Border:</span>
                  <select
                    value={selectedBox.box_border ?? BOX_BORDER_DEFAULT}
                    onChange={(e) =>
                      updateBoxBorder(selectedBox.position, e.target.value as BoxBorder)
                    }
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700"
                  >
                    <option value="none">none</option>
                    <option value="thin">thin</option>
                    <option value="thick">thick</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">Radius:</span>
                  <select
                    value={selectedBox.box_radius ?? BOX_RADIUS_DEFAULT}
                    onChange={(e) =>
                      updateBoxRadius(selectedBox.position, e.target.value as BoxRadius)
                    }
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700"
                  >
                    <option value="none">none</option>
                    <option value="sm">sm</option>
                    <option value="lg">lg</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">Background:</span>
                  <select
                    value={selectedBox.box_background ?? BOX_BACKGROUND_DEFAULT}
                    onChange={(e) =>
                      updateBoxBackground(selectedBox.position, e.target.value as BoxBackground)
                    }
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700"
                  >
                    <option value="none">none (default)</option>
                    <option value="white">white</option>
                    <option value="accent">accent</option>
                    <option value="warm">warm</option>
                    <option value="cool">cool</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="font-medium">Divide:</span>
                <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                  {(['none', 'horizontal', 'vertical'] as DivisionMode[]).map((mode) => {
                    const label = mode === 'none' ? 'None' : mode === 'horizontal' ? 'Top/Bottom' : 'Left/Right'
                    const disabled =
                      (mode === 'horizontal' && !canHorizontal) ||
                      (mode === 'vertical' && !canVertical)
                    const active = division === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={disabled}
                        onClick={() => setBoxDivision(selectedBox.position, mode)}
                        title={
                          disabled
                            ? mode === 'horizontal'
                              ? 'Requires row_span ≥ 2'
                              : 'Requires col_span ≥ 2'
                            : undefined
                        }
                        className={`px-2.5 py-1 text-xs ${
                          active
                            ? 'bg-blue-600 text-white'
                            : disabled
                              ? 'bg-gray-100 text-gray-400'
                              : 'bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {renderSlotControls({
                  label: divided ? 'Slot A' : 'Slot',
                  boxType: selectedBox.box_type,
                  onBoxTypeChange: (t) => updateBoxType(selectedBox.position, t),
                  squareMenuGroupId: selectedBox.square_menu_group_id ?? null,
                  onMenuGroupChange: (id) => updateMenuGroup(selectedBox.position, 'a', id),
                  aestheticImageId: selectedBox.aesthetic_image_id ?? null,
                  onImageChange: (id) => updateImageBinding(selectedBox.position, 'a', id),
                  headerOverride: selectedBox.header_override ?? '',
                  onHeaderOverrideChange: (text) =>
                    updateHeaderOverride(selectedBox.position, 'a', text || null),
                  menuGroups,
                  aestheticImages,
                  layoutMode: selectedBox.layout_mode ?? LAYOUT_MODE_DEFAULT,
                  onLayoutModeChange: (m) => updateLayoutMode(selectedBox.position, 'a', m),
                  priceDisplayMode:
                    selectedBox.price_display_mode ?? PRICE_DISPLAY_MODE_DEFAULT,
                  onPriceDisplayModeChange: (m) =>
                    updatePriceDisplayMode(selectedBox.position, 'a', m),
                  density: selectedBox.density ?? DENSITY_DEFAULT,
                  onDensityChange: (d) => updateDensity(selectedBox.position, 'a', d),
                  titleSize: selectedBox.title_size ?? TITLE_SIZE_DEFAULT,
                  onTitleSizeChange: (s) => updateTitleSize(selectedBox.position, 'a', s),
                  titleAlign: selectedBox.title_align ?? TITLE_ALIGN_DEFAULT,
                  onTitleAlignChange: (a) => updateTitleAlign(selectedBox.position, 'a', a),
                  subtitleOverride: selectedBox.subtitle_override ?? '',
                  onSubtitleOverrideChange: (text) =>
                    updateSubtitleOverride(selectedBox.position, 'a', text || null),
                  emphasizedVariationName: selectedBox.emphasized_variation_name ?? '',
                  onEmphasizedVariationNameChange: (text) =>
                    updateEmphasizedVariationName(selectedBox.position, 'a', text || null),
                  emphasizedVariationExplicitNone:
                    selectedBox.emphasized_variation_explicit_none ?? false,
                  onEmphasizedVariationExplicitNoneChange: (value) =>
                    updateEmphasizedVariationExplicitNone(selectedBox.position, 'a', value),
                })}
                {divided &&
                  renderSlotControls({
                    label: 'Slot B',
                    boxType: selectedBox.box_type_b ?? 'menu_group',
                    onBoxTypeChange: (t) => updateBoxTypeB(selectedBox.position, t),
                    squareMenuGroupId: selectedBox.square_menu_group_id_b ?? null,
                    onMenuGroupChange: (id) => updateMenuGroup(selectedBox.position, 'b', id),
                    aestheticImageId: selectedBox.aesthetic_image_id_b ?? null,
                    onImageChange: (id) => updateImageBinding(selectedBox.position, 'b', id),
                    headerOverride: selectedBox.header_override_b ?? '',
                    onHeaderOverrideChange: (text) =>
                      updateHeaderOverride(selectedBox.position, 'b', text || null),
                    menuGroups,
                    aestheticImages,
                    layoutMode: selectedBox.layout_mode_b ?? LAYOUT_MODE_DEFAULT,
                    onLayoutModeChange: (m) => updateLayoutMode(selectedBox.position, 'b', m),
                    priceDisplayMode:
                      selectedBox.price_display_mode_b ?? PRICE_DISPLAY_MODE_DEFAULT,
                    onPriceDisplayModeChange: (m) =>
                      updatePriceDisplayMode(selectedBox.position, 'b', m),
                    density: selectedBox.density_b ?? DENSITY_DEFAULT,
                    onDensityChange: (d) => updateDensity(selectedBox.position, 'b', d),
                    titleSize: selectedBox.title_size_b ?? TITLE_SIZE_DEFAULT,
                    onTitleSizeChange: (s) => updateTitleSize(selectedBox.position, 'b', s),
                    titleAlign: selectedBox.title_align_b ?? TITLE_ALIGN_DEFAULT,
                    onTitleAlignChange: (a) => updateTitleAlign(selectedBox.position, 'b', a),
                    subtitleOverride: selectedBox.subtitle_override_b ?? '',
                    onSubtitleOverrideChange: (text) =>
                      updateSubtitleOverride(selectedBox.position, 'b', text || null),
                    emphasizedVariationName: selectedBox.emphasized_variation_name_b ?? '',
                    onEmphasizedVariationNameChange: (text) =>
                      updateEmphasizedVariationName(selectedBox.position, 'b', text || null),
                    emphasizedVariationExplicitNone:
                      selectedBox.emphasized_variation_explicit_none_b ?? false,
                    onEmphasizedVariationExplicitNoneChange: (value) =>
                      updateEmphasizedVariationExplicitNone(selectedBox.position, 'b', value),
                  })}
              </div>
            </div>
          )
        })()
      ) : (
        <p className="text-xs text-gray-500">
          Click a box to edit its type or delete it. Drag a box to move it; use the bottom-right
          handle to resize. Preview is locked to 16:9 (target HD TV aspect ratio). Content
          selectors are configured in later phases.
        </p>
      )}
    </div>
  )
}
