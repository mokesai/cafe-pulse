'use client'

/**
 * MOK-152 / KDS v3 phase 2 — grid editor (form-based fallback).
 *
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T6)
 *
 * Originally planned with react-grid-layout for drag-resize, but the library
 * caused persistent webpack dev-mode chunk-resolution failures in this
 * project (every change to /admin/kds-v3 pages produced 'Cannot read
 * properties of undefined (reading call)' errors that survived cache
 * resets). We fell back to "option a" from the original design brainstorm:
 * form-based editor with numeric placement controls + a live CSS grid
 * preview. Drag-resize ("option b") and freeform canvas ("option c") are
 * tracked as follow-ups.
 *
 * Position numbers are stable: adding/deleting boxes doesn't renumber the
 * survivors. The save path still uses validateBoxLayout from T3.
 */
import { useState } from 'react'
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

const BOX_COLORS = [
  'bg-blue-200 border-blue-400 text-blue-900',
  'bg-emerald-200 border-emerald-400 text-emerald-900',
  'bg-amber-200 border-amber-400 text-amber-900',
  'bg-rose-200 border-rose-400 text-rose-900',
  'bg-violet-200 border-violet-400 text-violet-900',
  'bg-cyan-200 border-cyan-400 text-cyan-900',
]

function colorForBox(position: number): string {
  return BOX_COLORS[(position - 1) % BOX_COLORS.length]
}

export function GridEditor({ grid_rows, grid_cols, boxes, onChange }: Props) {
  const [selectedPosition, setSelectedPosition] = useState<number | null>(
    boxes[0]?.position ?? null,
  )

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
    setSelectedPosition(position)
  }

  const removeBox = (position: number) => {
    onChange(boxes.filter((b) => b.position !== position))
    if (selectedPosition === position) {
      setSelectedPosition(null)
    }
  }

  const updateBox = (position: number, patch: Partial<EditableBox>) => {
    onChange(boxes.map((b) => (b.position === position ? { ...b, ...patch } : b)))
  }

  const clampNum = (val: number, min: number, max: number) =>
    Math.max(min, Math.min(max, isFinite(val) ? val : min))

  return (
    <div className="space-y-4">
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

      {/* Visual preview — CSS grid with box rectangles */}
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
        <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Preview</p>
        <div
          className="grid gap-1.5 bg-white p-2 rounded"
          style={{
            gridTemplateColumns: `repeat(${grid_cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid_rows}, 56px)`,
          }}
        >
          {/* Empty cell skeleton — renders the grid bg */}
          {Array.from({ length: grid_rows * grid_cols }).map((_, i) => (
            <div
              key={`cell-${i}`}
              className="rounded border border-dashed border-gray-200 bg-gray-50"
            />
          ))}

          {/* Boxes overlay */}
          {boxes.map((box) => {
            const isSelected = selectedPosition === box.position
            const sb = sizeBadge(box)
            return (
              <button
                type="button"
                key={`box-${box.position}`}
                onClick={() => setSelectedPosition(box.position)}
                className={`rounded border-2 ${colorForBox(box.position)} p-2 text-left transition-all ${
                  isSelected ? 'ring-2 ring-offset-1 ring-blue-500 z-10' : ''
                }`}
                style={{
                  gridRow: `${box.row_start} / span ${box.row_span}`,
                  gridColumn: `${box.col_start} / span ${box.col_span}`,
                }}
                title={`Box ${box.position} — ${box.box_type}`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">Box {box.position}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${sb.cls}`}>
                    {sb.label}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] opacity-75">
                  {box.box_type === 'menu_group' ? 'menu group' : 'image'}
                </div>
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Click a box in the preview to edit its placement below. Content selectors
          (menu group, aesthetic image) are configured in later phases.
        </p>
      </div>

      {/* Per-box edit panels */}
      {boxes.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          No boxes yet. Click <strong>+ Add Box</strong> to place a 1×1 box.
        </div>
      ) : (
        <div className="space-y-2">
          {boxes
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((box) => {
              const isSelected = selectedPosition === box.position
              return (
                <div
                  key={`edit-${box.position}`}
                  className={`rounded-md border p-3 transition-colors ${
                    isSelected ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-3 w-3 rounded-full border ${colorForBox(box.position).split(' ')[0]}`}
                      />
                      <span className="text-sm font-semibold text-gray-900">
                        Box {box.position}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={box.box_type}
                        onChange={(e) =>
                          updateBox(box.position, {
                            box_type: e.target.value as EditableBox['box_type'],
                          })
                        }
                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="menu_group">menu_group</option>
                        <option value="image_only">image_only</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeBox(box.position)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {([
                      ['row_start', 'Row', 1, grid_rows],
                      ['col_start', 'Col', 1, grid_cols],
                      ['row_span', 'Rows', 1, grid_rows],
                      ['col_span', 'Cols', 1, grid_cols],
                    ] as const).map(([field, label, min, max]) => (
                      <label key={field} className="block">
                        <span className="block text-[11px] uppercase tracking-wide text-gray-500">
                          {label}
                        </span>
                        <input
                          type="number"
                          min={min}
                          max={max}
                          value={box[field]}
                          onFocus={() => setSelectedPosition(box.position)}
                          onChange={(e) =>
                            updateBox(box.position, {
                              [field]: clampNum(Number(e.target.value), min, max),
                            })
                          }
                          className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
