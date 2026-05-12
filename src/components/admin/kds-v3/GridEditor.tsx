'use client'

/**
 * MOK-152 / KDS v3 phase 2 — drag-resize grid editor.
 *
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T6)
 *
 * Wraps react-grid-layout for the operator-facing layout editor:
 *   - Drag to move, corner-handle to resize. Snaps to grid cells.
 *   - Each box shows its position number prominently + a size badge.
 *   - Add Box places a 1x1 at the first free cell.
 *   - Delete removes the box without renumbering survivors (position
 *     stability is a hard invariant of phase 2).
 *
 * Box-content controls (menu_group / image_only) appear inline but the
 * selectors are disabled with a "configured in phase 3 / phase 4" hint.
 */
import { useMemo, useState } from 'react'
import GridLayout, { type Layout, WidthProvider } from 'react-grid-layout'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'
import {
  nextAvailablePosition,
  firstFreeCell,
  type GridBox,
} from '@/lib/kds/grid-validation'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

const ResponsiveGridLayout = WidthProvider(GridLayout)

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

const ROW_HEIGHT_PX = 64
const GRID_MARGIN: [number, number] = [8, 8]

export function GridEditor({ grid_rows, grid_cols, boxes, onChange }: Props) {
  const [selected, setSelected] = useState<number | null>(null)

  const layout: Layout[] = useMemo(
    () =>
      boxes.map((b) => ({
        i: String(b.position),
        x: b.col_start - 1, // react-grid-layout uses 0-based; our model is 1-based
        y: b.row_start - 1,
        w: b.col_span,
        h: b.row_span,
        // Bound to grid; collision avoidance handled by react-grid-layout
        // when `preventCollision` is true.
      })),
    [boxes],
  )

  const handleLayoutChange = (newLayout: Layout[]) => {
    // Map each layout item back to its source EditableBox by stable position.
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">
          Grid layout — {boxes.length} {boxes.length === 1 ? 'box' : 'boxes'}
        </p>
        <Button size="sm" variant="secondary" onClick={addBox}>
          <Plus className="h-4 w-4 mr-1.5" /> Add Box
        </Button>
      </div>

      <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
        {boxes.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No boxes yet. Click <strong>Add Box</strong> to place a 1×1 box on the grid.
          </div>
        ) : (
          <ResponsiveGridLayout
            className="layout"
            layout={layout}
            cols={grid_cols}
            rowHeight={ROW_HEIGHT_PX}
            maxRows={grid_rows}
            margin={GRID_MARGIN}
            compactType={null}
            preventCollision
            isBounded
            onLayoutChange={handleLayoutChange}
            onDragStart={(_l, item) => setSelected(Number(item.i))}
            onResizeStart={(_l, item) => setSelected(Number(item.i))}
          >
            {boxes.map((box) => {
              const isSelected = selected === box.position
              const sb = sizeBadge(box)
              return (
                <div
                  key={String(box.position)}
                  className={`rounded-md border bg-white shadow-sm transition-colors ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'
                  }`}
                  onClick={() => setSelected(box.position)}
                >
                  <div className="flex h-full flex-col p-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-gray-700">Box {box.position}</span>
                      <span className={`rounded-full px-1.5 py-0.5 ${sb.cls}`}>{sb.label}</span>
                    </div>
                    <div className="mt-1 flex-1 text-[11px] text-gray-500">
                      {box.box_type === 'menu_group' ? 'Menu group' : 'Image-only'} ·{' '}
                      {box.row_span}×{box.col_span}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <select
                        value={box.box_type}
                        onChange={(e) =>
                          updateBoxType(box.position, e.target.value as 'menu_group' | 'image_only')
                        }
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="rounded border border-gray-200 px-1 py-0.5 text-[11px] text-gray-700"
                      >
                        <option value="menu_group">menu_group</option>
                        <option value="image_only">image_only</option>
                      </select>
                      <button
                        type="button"
                        className="rounded p-1 text-red-500 hover:bg-red-50"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeBox(box.position)
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        title="Delete this box"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </ResponsiveGridLayout>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Drag a box to move it. Use the bottom-right handle to resize. Content selectors
        (which menu group, which image) are configured in later phases.
      </p>
    </div>
  )
}
