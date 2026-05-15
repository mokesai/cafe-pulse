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
} from '@/lib/kds/grid-validation'

export interface EditableBox extends GridBox {
  box_type: 'menu_group' | 'image_only'
  header_override?: string | null
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

export function GridEditor({ grid_rows, grid_cols, boxes, onChange }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

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
    onChange(boxes.map((b) => (b.position === position ? { ...b, box_type } : b)))
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="text-sm">
            <span className="font-semibold text-gray-800">Box {selectedBox.position}</span>
            <span className="ml-2 text-gray-500">
              row {selectedBox.row_start}, col {selectedBox.col_start} · {selectedBox.row_span}×
              {selectedBox.col_span}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Type</label>
            <select
              value={selectedBox.box_type}
              onChange={(e) =>
                updateBoxType(selectedBox.position, e.target.value as 'menu_group' | 'image_only')
              }
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
            >
              <option value="menu_group">menu_group</option>
              <option value="image_only">image_only</option>
            </select>
            <button
              type="button"
              onClick={() => removeBox(selectedBox.position)}
              className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Delete box
            </button>
          </div>
        </div>
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
