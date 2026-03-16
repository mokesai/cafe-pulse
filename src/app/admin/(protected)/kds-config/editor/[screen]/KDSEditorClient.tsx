'use client'

import { useState, useCallback, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { saveDraft, publishLayout, resetToDefault } from './editor-actions'
import type {
  KDSLayout, KDSRow, KDSDivision, KDSCellContent, KDSLayoutOverlay,
} from '@/lib/kds/layout-types'
import {
  createDefaultLayout, layoutId, redistributeEqual, redistributeProportional,
  LAYOUT_CONSTRAINTS,
} from '@/lib/kds/layout-types'
import type { KDSCategoryWithItems } from '@/lib/kds/types'
import {
  Save, Upload, RotateCcw, Eye, ArrowLeft, Plus, Minus,
  AlertCircle, CheckCircle, Loader2, Trash2, SplitSquareHorizontal,
  Merge, ChevronRight, ChevronLeft, Monitor,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Canvas dimensions
// ---------------------------------------------------------------------------
const CANVAS_W = 1920
const CANVAS_H = 1080
const CANVAS_SCALE = 0.35

const inputCls = 'w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600 focus:border-blue-500 focus:outline-none'
const selectCls = 'w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600 focus:border-blue-500 focus:outline-none'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SelectionPath =
  | { type: 'column'; colIndex: number }
  | { type: 'row'; colIndex: number; rowIndex: number }
  | { type: 'division'; colIndex: number; rowIndex: number; divIndex: 0 | 1 }
  | { type: 'overlay'; id: string }
  | null

interface Props {
  tenantId: string
  screen: 'drinks' | 'food'
  initialLayout: KDSLayout
  layoutId: string | null
  updatedAt: string | null
  hasDraft: boolean
  categories: KDSCategoryWithItems[]
}

// ---------------------------------------------------------------------------
// Cell content label
// ---------------------------------------------------------------------------
function contentLabel(content: KDSCellContent | undefined, categories: KDSCategoryWithItems[]): string {
  if (!content || content.type === 'empty') return '(empty)'
  if (content.type === 'image') return content.image_url ? '🖼 Image' : '🖼 (no URL)'
  const cat = categories.find(c => c.slug === content.category_slug)
  return cat?.name ?? content.category_slug ?? '(unknown)'
}

// ---------------------------------------------------------------------------
// Canvas cell block
// ---------------------------------------------------------------------------
function CellBlock({
  content, categories, isSelected, onClick, style,
}: {
  content: KDSCellContent | undefined
  categories: KDSCategoryWithItems[]
  isSelected: boolean
  onClick: () => void
  style?: React.CSSProperties
}) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        width: '100%', height: '100%',
        border: isSelected ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.15)',
        background: isSelected ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.04)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', userSelect: 'none', overflow: 'hidden',
        fontSize: 11, color: isSelected ? '#93c5fd' : '#9ca3af', fontWeight: 600,
        transition: 'border-color 0.1s, background 0.1s',
        ...style,
      }}
    >
      {contentLabel(content, categories)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drag handle (vertical between columns, horizontal between rows/divisions)
// ---------------------------------------------------------------------------
function DragHandle({
  direction, onDrag,
}: {
  direction: 'vertical' | 'horizontal'
  onDrag: (delta: number) => void
}) {
  const startRef = useRef<number>(0)

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    startRef.current = direction === 'vertical' ? e.clientX : e.clientY

    function onMove(ev: MouseEvent) {
      const pos = direction === 'vertical' ? ev.clientX : ev.clientY
      const delta = (pos - startRef.current) / CANVAS_SCALE
      startRef.current = pos
      onDrag(delta)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return direction === 'vertical' ? (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute', top: 0, bottom: 0, width: 6,
        cursor: 'col-resize', zIndex: 10,
        background: 'rgba(59,130,246,0)',
        transition: 'background 0.1s',
      }}
      className="hover:bg-blue-500/40"
    />
  ) : (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute', left: 0, right: 0, height: 6,
        cursor: 'row-resize', zIndex: 10,
        background: 'rgba(59,130,246,0)',
        transition: 'background 0.1s',
      }}
      className="hover:bg-blue-500/40"
    />
  )
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------
export default function KDSEditorClient({
  tenantId, screen, initialLayout, layoutId: _layoutId,
  updatedAt: initialUpdatedAt, hasDraft: initialHasDraft, categories,
}: Props) {
  const router = useRouter()
  const [layout, setLayout] = useState<KDSLayout>(() =>
    initialLayout.version === 2 && 'columns' in initialLayout ? initialLayout : createDefaultLayout()
  )
  const [selection, setSelection] = useState<SelectionPath>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [hasDraft, setHasDraft] = useState(initialHasDraft)
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'warn'; text: string } | null>(null)
  const [showReset, setShowReset] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)

  const update = useCallback((fn: (l: KDSLayout) => KDSLayout) => {
    setLayout(prev => fn(prev))
    setIsDirty(true)
  }, [])

  // ---------------------------------------------------------------------------
  // Column operations
  // ---------------------------------------------------------------------------

  function addColumn() {
    if (layout.columns.length >= LAYOUT_CONSTRAINTS.MAX_COLUMNS) {
      setMsg({ type: 'warn', text: `Maximum ${LAYOUT_CONSTRAINTS.MAX_COLUMNS} columns.` })
      return
    }
    update(l => {
      const newCount = l.columns.length + 1
      const widths = redistributeEqual(newCount)
      return {
        ...l,
        columns: [
          ...l.columns.map((col, i) => ({ ...col, width: widths[i] })),
          { id: layoutId('col'), width: widths[newCount - 1], rows: [{ id: layoutId('r'), height: 100, content: { type: 'empty' as const } }] },
        ],
      }
    })
  }

  function removeColumn(colIndex: number) {
    if (layout.columns.length <= 1) { setMsg({ type: 'warn', text: 'Need at least 1 column.' }); return }
    update(l => {
      const remaining = l.columns.filter((_, i) => i !== colIndex)
      const widths = redistributeProportional(l.columns.map(c => c.width), colIndex)
      return { ...l, columns: remaining.map((col, i) => ({ ...col, width: widths[i] })) }
    })
    setSelection(null)
  }

  function dragColumnHandle(colIndex: number, deltaX: number) {
    update(l => {
      const cols = [...l.columns]
      const left = cols[colIndex]
      const right = cols[colIndex + 1]
      if (!left || !right) return l
      const totalW = left.width + right.width
      const deltaP = (deltaX / CANVAS_W) * 100
      const newLeft = Math.max(LAYOUT_CONSTRAINTS.MIN_COLUMN_WIDTH, Math.min(totalW - LAYOUT_CONSTRAINTS.MIN_COLUMN_WIDTH, left.width + deltaP))
      const newRight = totalW - newLeft
      cols[colIndex] = { ...left, width: newLeft }
      cols[colIndex + 1] = { ...right, width: newRight }
      return { ...l, columns: cols }
    })
  }

  // ---------------------------------------------------------------------------
  // Row operations
  // ---------------------------------------------------------------------------

  function addRow(colIndex: number) {
    update(l => {
      const col = l.columns[colIndex]
      if (col.rows.length >= LAYOUT_CONSTRAINTS.MAX_ROWS_PER_COLUMN) return l
      const newCount = col.rows.length + 1
      const heights = redistributeEqual(newCount)
      const newRows = [
        ...col.rows.map((r, i) => ({ ...r, height: heights[i] })),
        { id: layoutId('r'), height: heights[newCount - 1], content: { type: 'empty' as const } },
      ]
      return { ...l, columns: l.columns.map((c, i) => i === colIndex ? { ...c, rows: newRows } : c) }
    })
  }

  function removeRow(colIndex: number, rowIndex: number) {
    update(l => {
      const col = l.columns[colIndex]
      if (col.rows.length <= 1) return l
      const heights = redistributeProportional(col.rows.map(r => r.height), rowIndex)
      const newRows = col.rows.filter((_, i) => i !== rowIndex).map((r, i) => ({ ...r, height: heights[i] }))
      return { ...l, columns: l.columns.map((c, i) => i === colIndex ? { ...c, rows: newRows } : c) }
    })
    setSelection(null)
  }

  function dragRowHandle(colIndex: number, rowIndex: number, deltaY: number) {
    update(l => {
      const col = l.columns[colIndex]
      const rows = [...col.rows]
      const top = rows[rowIndex]
      const bot = rows[rowIndex + 1]
      if (!top || !bot) return l
      const totalH = top.height + bot.height
      const deltaP = (deltaY / CANVAS_H) * 100
      const newTop = Math.max(LAYOUT_CONSTRAINTS.MIN_ROW_HEIGHT, Math.min(totalH - LAYOUT_CONSTRAINTS.MIN_ROW_HEIGHT, top.height + deltaP))
      const newBot = totalH - newTop
      rows[rowIndex] = { ...top, height: newTop }
      rows[rowIndex + 1] = { ...bot, height: newBot }
      return { ...l, columns: l.columns.map((c, i) => i === colIndex ? { ...c, rows } : c) }
    })
  }

  // ---------------------------------------------------------------------------
  // Split / Merge
  // ---------------------------------------------------------------------------

  function splitRow(colIndex: number, rowIndex: number) {
    update(l => {
      const row = l.columns[colIndex].rows[rowIndex]
      const newRow: KDSRow = {
        ...row,
        content: undefined,
        divisions: [
          { id: layoutId('d'), width: 50, content: row.content ?? { type: 'empty' } },
          { id: layoutId('d'), width: 50, content: { type: 'empty' } },
        ],
      }
      return {
        ...l,
        columns: l.columns.map((c, ci) => ci !== colIndex ? c : {
          ...c,
          rows: c.rows.map((r, ri) => ri === rowIndex ? newRow : r),
        }),
      }
    })
  }

  function mergeDivisions(colIndex: number, rowIndex: number) {
    update(l => {
      const row = l.columns[colIndex].rows[rowIndex]
      if (!row.divisions) return l
      const newRow: KDSRow = { ...row, divisions: undefined, content: row.divisions[0].content }
      return {
        ...l,
        columns: l.columns.map((c, ci) => ci !== colIndex ? c : {
          ...c,
          rows: c.rows.map((r, ri) => ri === rowIndex ? newRow : r),
        }),
      }
    })
  }

  function dragDivisionHandle(colIndex: number, rowIndex: number, deltaX: number) {
    update(l => {
      const row = l.columns[colIndex].rows[rowIndex]
      if (!row.divisions) return l
      const [left, right] = row.divisions
      const total = left.width + right.width
      const deltaP = (deltaX / CANVAS_W * 100) / (l.columns[colIndex].width / 100)
      const newLeft = Math.max(LAYOUT_CONSTRAINTS.MIN_DIVISION_WIDTH, Math.min(total - LAYOUT_CONSTRAINTS.MIN_DIVISION_WIDTH, left.width + deltaP))
      const newRight = total - newLeft
      const newDivisions: [KDSDivision, KDSDivision] = [{ ...left, width: newLeft }, { ...right, width: newRight }]
      const newRow = { ...row, divisions: newDivisions }
      return {
        ...l,
        columns: l.columns.map((c, ci) => ci !== colIndex ? c : {
          ...c,
          rows: c.rows.map((r, ri) => ri === rowIndex ? newRow : r),
        }),
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Content update helpers
  // ---------------------------------------------------------------------------

  function updateContent(path: SelectionPath, fn: (c: KDSCellContent) => KDSCellContent) {
    if (!path) return
    update(l => {
      const cols = l.columns.map((col, ci) => {
        if (path.type === 'column' || ci !== (path as { colIndex: number }).colIndex) return col
        return {
          ...col,
          rows: col.rows.map((row, ri) => {
            if (path.type === 'row' && ri === path.rowIndex) {
              return { ...row, content: fn(row.content ?? { type: 'empty' }) }
            }
            if (path.type === 'division' && ri === path.rowIndex && row.divisions) {
              const divs = [...row.divisions] as [KDSDivision, KDSDivision]
              divs[path.divIndex] = { ...divs[path.divIndex], content: fn(divs[path.divIndex].content) }
              return { ...row, divisions: divs }
            }
            return row
          }),
        }
      })
      return { ...l, columns: cols }
    })
  }

  function updateOverlay(id: string, fn: (o: KDSLayoutOverlay) => KDSLayoutOverlay) {
    update(l => ({ ...l, overlays: (l.overlays ?? []).map(o => o.id === id ? fn(o) : o) }))
  }

  function removeOverlay(id: string) {
    update(l => ({ ...l, overlays: (l.overlays ?? []).filter(o => o.id !== id) }))
    setSelection(null)
  }

  // ---------------------------------------------------------------------------
  // Save / Publish / Reset
  // ---------------------------------------------------------------------------

  function handleSave() {
    startTransition(async () => {
      const res = await saveDraft(tenantId, screen, layout, updatedAt)
      if (res.success) {
        setIsDirty(false); setHasDraft(true); setUpdatedAt(res.updatedAt)
        setMsg({ type: 'success', text: 'Draft saved.' })
      } else if (res.error === 'CONCURRENT_EDIT') {
        setMsg({ type: 'warn', text: 'Layout modified elsewhere. Save again to overwrite.' })
      } else {
        setMsg({ type: 'error', text: res.error })
      }
    })
  }

  function handlePublish() {
    startTransition(async () => {
      const res = await publishLayout(tenantId, screen, layout)
      if (res.success) {
        setIsDirty(false)
        setMsg({ type: 'success', text: 'Published. Live KDS screens update on next refresh.' })
      } else {
        setMsg({ type: 'error', text: res.error })
      }
    })
  }

  function handleReset() {
    startTransition(async () => {
      const res = await resetToDefault(tenantId, screen)
      if (res.success) {
        setShowReset(false)
        setLayout(createDefaultLayout())
        setIsDirty(false)
        setMsg({ type: 'success', text: 'Reset to default.' })
        router.refresh()
      } else {
        setMsg({ type: 'error', text: res.error ?? 'Reset failed' })
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Derived selection content
  // ---------------------------------------------------------------------------

  const selectedContent: KDSCellContent | undefined = (() => {
    if (!selection) return undefined
    if (selection.type === 'row') return layout.columns[selection.colIndex]?.rows[selection.rowIndex]?.content
    if (selection.type === 'division') {
      const row = layout.columns[selection.colIndex]?.rows[selection.rowIndex]
      return row?.divisions?.[selection.divIndex]?.content
    }
    return undefined
  })()

  const selectedRow = selection?.type === 'row' || selection?.type === 'division'
    ? layout.columns[selection.colIndex]?.rows[selection.rowIndex]
    : undefined

  const selectedOverlay = selection?.type === 'overlay'
    ? (layout.overlays ?? []).find(o => o.id === selection.id)
    : undefined

  const canvasW = CANVAS_W * CANVAS_SCALE
  const canvasH = CANVAS_H * CANVAS_SCALE

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-screen bg-gray-900 overflow-hidden">

      {/* ── Top Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0 flex-wrap">
        <Link href="/admin/kds-config" className="text-gray-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <span className="text-white font-semibold text-sm">KDS Layout Editor</span>

        {/* Screen toggle */}
        <div className="flex rounded-lg overflow-hidden border border-gray-600 ml-1">
          {(['drinks', 'food'] as const).map(s => (
            <Link key={s} href={`/admin/kds-config/editor/${s}`}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${screen === s ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </div>

        <div className="flex-1" />
        {isDirty && <span className="text-xs text-amber-400">Unsaved</span>}
        {hasDraft && !isDirty && <span className="text-xs text-blue-400">Draft saved</span>}

        <Link href={`/admin/kds-config/preview/${screen}`} target="_blank"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg">
          <Eye className="w-3.5 h-3.5" />Preview
        </Link>
        <button onClick={handleSave} disabled={isPending || !isDirty}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg disabled:opacity-50">
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Draft
        </button>
        <button onClick={handlePublish} disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded-lg disabled:opacity-50">
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Publish
        </button>
        <button onClick={() => setShowReset(true)} disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-red-900 text-gray-300 text-xs rounded-lg">
          <RotateCcw className="w-3.5 h-3.5" />Reset
        </button>
      </div>

      {/* ── Message Banner ── */}
      {msg && (
        <div className={`px-4 py-1.5 text-xs flex items-center gap-2 flex-shrink-0 ${msg.type === 'success' ? 'bg-green-900/50 text-green-300' : msg.type === 'warn' ? 'bg-amber-900/50 text-amber-300' : 'bg-red-900/50 text-red-300'}`}>
          {msg.type === 'success' ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Reset Confirm ── */}
      {showReset && (
        <div className="px-4 py-2 bg-red-900/40 border-b border-red-800 flex items-center gap-3 text-xs flex-shrink-0">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-300">Deletes your custom layout (draft + published). KDS reverts to defaults.</span>
          <button onClick={handleReset} disabled={isPending}
            className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white rounded disabled:opacity-50">
            {isPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Yes, reset'}
          </button>
          <button onClick={() => setShowReset(false)} className="px-3 py-1 bg-gray-700 text-gray-300 rounded">Cancel</button>
        </div>
      )}

      {/* ── Main Editor Area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Canvas */}
        <div className="flex-1 overflow-auto p-6 flex flex-col items-center bg-gray-950">
          {/* Column count controls */}
          <div className="flex items-center gap-3 mb-3 text-xs text-gray-500">
            <Monitor className="w-3.5 h-3.5" />
            <span>{CANVAS_W}×{CANVAS_H} — {Math.round(CANVAS_SCALE * 100)}% scale</span>
            <span className="ml-2">Columns: {layout.columns.length}</span>
            <button onClick={addColumn} title="Add column"
              className="p-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300">
              <Plus className="w-3 h-3" />
            </button>
            <button onClick={() => selection?.type === 'column' ? removeColumn(selection.colIndex) : removeColumn(layout.columns.length - 1)}
              title="Remove last column"
              className="p-1 bg-gray-700 hover:bg-red-800 rounded text-gray-300">
              <Minus className="w-3 h-3" />
            </button>
          </div>

          {/* Canvas */}
          <div
            style={{ width: canvasW, height: canvasH, position: 'relative', background: '#111', border: '1px solid #374151', overflow: 'hidden', flexShrink: 0 }}
            onClick={() => setSelection(null)}
          >
            {/* Columns */}
            <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%' }}>
              {layout.columns.map((col, ci) => {
                const colW = (col.width / 100) * canvasW
                return (
                  <div key={col.id} style={{ width: colW, height: '100%', position: 'relative', flexShrink: 0, borderRight: ci < layout.columns.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
                    {/* Column header */}
                    <div
                      onClick={e => { e.stopPropagation(); setSelection({ type: 'column', colIndex: ci }) }}
                      style={{
                        position: 'absolute', top: 2, left: 2, right: 2, height: 14, zIndex: 5,
                        background: selection?.type === 'column' && selection.colIndex === ci ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.05)',
                        borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', fontSize: 9, color: '#6b7280',
                      }}>
                      {Math.round(col.width)}% · {col.rows.length} row{col.rows.length !== 1 ? 's' : ''}
                    </div>

                    {/* Rows */}
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', paddingTop: 18 }}>
                      {col.rows.map((row, ri) => {
                        const rowH = (row.height / 100) * (canvasH - 18)
                        const isSel = selection?.type === 'row' && selection.colIndex === ci && selection.rowIndex === ri
                        return (
                          <div key={row.id} style={{ height: rowH, position: 'relative', flexShrink: 0, borderBottom: ri < col.rows.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                            {row.divisions ? (
                              /* Split row */
                              <div style={{ display: 'flex', width: '100%', height: '100%' }}>
                                {row.divisions.map((div, di) => {
                                  const isDivSel = selection?.type === 'division' && selection.colIndex === ci && selection.rowIndex === ri && selection.divIndex === di
                                  return (
                                    <div key={div.id} style={{ width: `${div.width}%`, height: '100%', position: 'relative', borderRight: di === 0 ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
                                      <CellBlock
                                        content={div.content}
                                        categories={categories}
                                        isSelected={isDivSel}
                                        onClick={() => setSelection({ type: 'division', colIndex: ci, rowIndex: ri, divIndex: di as 0 | 1 })}
                                      />
                                      {/* Division handle */}
                                      {di === 0 && (
                                        <div style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 6, zIndex: 8 }}>
                                          <DragHandle direction="vertical" onDrag={d => dragDivisionHandle(ci, ri, d)} />
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                                {/* Merge button */}
                                <button
                                  onClick={e => { e.stopPropagation(); mergeDivisions(ci, ri) }}
                                  title="Merge divisions"
                                  style={{ position: 'absolute', top: 2, right: 2, zIndex: 6, padding: '1px 3px', fontSize: 8, background: 'rgba(0,0,0,0.5)', color: '#9ca3af', borderRadius: 2, border: '1px solid rgba(255,255,255,0.1)' }}>
                                  <Merge className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            ) : (
                              /* Single cell */
                              <CellBlock
                                content={row.content}
                                categories={categories}
                                isSelected={isSel}
                                onClick={() => setSelection({ type: 'row', colIndex: ci, rowIndex: ri })}
                              />
                            )}

                            {/* Row affordances (visible on cell hover) */}
                            <div style={{ position: 'absolute', top: 2, left: 2, zIndex: 6, display: 'flex', gap: 2 }}>
                              {!row.divisions && (
                                <button
                                  onClick={e => { e.stopPropagation(); splitRow(ci, ri) }}
                                  title="Split row"
                                  style={{ padding: '1px 3px', fontSize: 8, background: 'rgba(0,0,0,0.5)', color: '#9ca3af', borderRadius: 2, border: '1px solid rgba(255,255,255,0.1)' }}>
                                  <SplitSquareHorizontal className="w-2.5 h-2.5" />
                                </button>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); removeRow(ci, ri) }}
                                title="Remove row"
                                style={{ padding: '1px 3px', fontSize: 8, background: 'rgba(0,0,0,0.5)', color: '#ef4444', borderRadius: 2, border: '1px solid rgba(255,255,255,0.1)' }}>
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            </div>

                            {/* Row resize handle */}
                            {ri < col.rows.length - 1 && (
                              <div style={{ position: 'absolute', bottom: -3, left: 0, right: 0, height: 6, zIndex: 7 }}>
                                <DragHandle direction="horizontal" onDrag={d => dragRowHandle(ci, ri, d)} />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Add row button */}
                    <button
                      onClick={e => { e.stopPropagation(); addRow(ci) }}
                      title="Add row"
                      style={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', zIndex: 6, padding: '1px 6px', fontSize: 8, background: 'rgba(59,130,246,0.3)', color: '#93c5fd', borderRadius: 2, border: '1px solid rgba(59,130,246,0.3)' }}>
                      <Plus className="w-2.5 h-2.5" />
                    </button>

                    {/* Column resize handle */}
                    {ci < layout.columns.length - 1 && (
                      <div style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 6, zIndex: 9 }}>
                        <DragHandle direction="vertical" onDrag={d => dragColumnHandle(ci, d)} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Overlays */}
            {(layout.overlays ?? []).map(ov => (
              <div key={ov.id}
                onClick={e => { e.stopPropagation(); setSelection({ type: 'overlay', id: ov.id }) }}
                style={{
                  position: 'absolute', left: ov.position.x, top: ov.position.y,
                  width: ov.size.width, height: ov.size.height, zIndex: 20,
                  border: selection?.type === 'overlay' && selection.id === ov.id ? '2px solid #f59e0b' : '1px dashed rgba(255,255,255,0.3)',
                  cursor: 'pointer', background: 'rgba(245,158,11,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {ov.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={ov.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontSize: 8, color: '#fbbf24' }}>overlay</span>}
              </div>
            ))}
          </div>
        </div>

        {/* ── Properties Panel ── */}
        <div className={`bg-gray-800 border-l border-gray-700 flex-shrink-0 transition-all duration-200 overflow-y-auto ${panelOpen ? 'w-72' : 'w-8'}`}>
          {/* Collapse toggle */}
          <button onClick={() => setPanelOpen(v => !v)}
            className="w-full flex items-center justify-center h-8 text-gray-400 hover:text-white border-b border-gray-700">
            {panelOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {panelOpen && (
            <div className="p-4 space-y-4">
              {selectedContent !== undefined && (selection?.type === 'row' || selection?.type === 'division') ? (
                /* Content properties */
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">
                      {selection?.type === 'division' ? 'Division' : 'Row'} Content
                    </h3>
                    <button onClick={() => selection?.type === 'row' ? removeRow((selection as {colIndex:number;rowIndex:number}).colIndex, (selection as {rowIndex:number}).rowIndex) : removeOverlay('')}
                      className="p-1 text-gray-400 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Content type</label>
                    <select value={selectedContent.type} onChange={e => updateContent(selection, c => ({ ...c, type: e.target.value as 'category'|'image'|'empty' }))} className={selectCls}>
                      <option value="empty">Empty</option>
                      <option value="category">Category</option>
                      <option value="image">Image</option>
                    </select>
                  </div>

                  {selectedContent.type === 'category' && (
                    <>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Category</label>
                        <select value={selectedContent.category_slug ?? ''} onChange={e => updateContent(selection, c => ({ ...c, category_slug: e.target.value }))} className={selectCls}>
                          <option value="">— select —</option>
                          {categories.map(cat => <option key={cat.slug} value={cat.slug}>{cat.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Display type</label>
                        <select value={selectedContent.display_type ?? ''} onChange={e => updateContent(selection, c => ({ ...c, display_type: e.target.value as typeof c.display_type || undefined }))} className={selectCls}>
                          <option value="">Default</option>
                          <option value="price-grid">Price grid</option>
                          <option value="featured">Featured</option>
                          <option value="simple-list">Simple list</option>
                          <option value="single-price">Single price</option>
                          <option value="flavor-options">Flavor options</option>
                        </select>
                      </div>
                    </>
                  )}

                  {selectedContent.type === 'image' && (
                    <>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Image URL</label>
                        <input type="text" value={selectedContent.image_url ?? ''} onChange={e => updateContent(selection, c => ({ ...c, image_url: e.target.value }))} className={inputCls} placeholder="/images/kds/..." />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Image fit</label>
                        <select value={selectedContent.image_fit ?? 'cover'} onChange={e => updateContent(selection, c => ({ ...c, image_fit: e.target.value as 'cover'|'contain'|'fill' }))} className={selectCls}>
                          <option value="cover">Cover</option>
                          <option value="contain">Contain</option>
                          <option value="fill">Fill</option>
                        </select>
                      </div>
                    </>
                  )}

                  {/* Row-level controls */}
                  {selection?.type === 'row' && selectedRow && (
                    <>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Row height %</label>
                        <input type="number" min={LAYOUT_CONSTRAINTS.MIN_ROW_HEIGHT} max={100}
                          value={Math.round(selectedRow.height)}
                          onChange={e => update(l => {
                            const h = Math.max(LAYOUT_CONSTRAINTS.MIN_ROW_HEIGHT, parseInt(e.target.value) || LAYOUT_CONSTRAINTS.MIN_ROW_HEIGHT)
                            return { ...l, columns: l.columns.map((col, ci) => ci !== (selection as {colIndex:number}).colIndex ? col : {
                              ...col, rows: col.rows.map((r, ri) => ri !== selection.rowIndex ? r : { ...r, height: h }),
                            }) }
                          })}
                          className={inputCls} />
                      </div>
                      {!selectedRow.divisions && (
                        <button onClick={() => splitRow((selection as {colIndex:number}).colIndex, selection.rowIndex)}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg">
                          <SplitSquareHorizontal className="w-3.5 h-3.5" />Split Row
                        </button>
                      )}
                      {selectedRow.divisions && (
                        <button onClick={() => mergeDivisions((selection as {colIndex:number}).colIndex, selection.rowIndex)}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg">
                          <Merge className="w-3.5 h-3.5" />Merge Divisions
                        </button>
                      )}
                    </>
                  )}

                  {/* Division-level controls */}
                  {selection?.type === 'division' && selectedRow?.divisions && (
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Division width %</label>
                      <input type="number" min={LAYOUT_CONSTRAINTS.MIN_DIVISION_WIDTH} max={100}
                        value={Math.round(selectedRow.divisions[selection.divIndex].width)}
                        onChange={e => {
                          const w = Math.max(LAYOUT_CONSTRAINTS.MIN_DIVISION_WIDTH, parseInt(e.target.value) || LAYOUT_CONSTRAINTS.MIN_DIVISION_WIDTH)
                          update(l => ({
                            ...l, columns: l.columns.map((col, ci) => ci !== selection.colIndex ? col : {
                              ...col, rows: col.rows.map((row, ri) => ri !== selection.rowIndex || !row.divisions ? row : {
                                ...row, divisions: [
                                  { ...row.divisions[0], width: selection.divIndex === 0 ? w : 100 - w },
                                  { ...row.divisions[1], width: selection.divIndex === 1 ? w : 100 - w },
                                ] as [KDSDivision, KDSDivision],
                              }),
                            }),
                          }))
                        }}
                        className={inputCls} />
                    </div>
                  )}
                </>
              ) : selection?.type === 'column' ? (
                /* Column properties */
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Column</h3>
                    <button onClick={() => removeColumn(selection.colIndex)} className="p-1 text-gray-400 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Width %</label>
                    <input type="number" min={LAYOUT_CONSTRAINTS.MIN_COLUMN_WIDTH} max={100}
                      value={Math.round(layout.columns[selection.colIndex]?.width ?? 0)}
                      onChange={e => {
                        const w = Math.max(LAYOUT_CONSTRAINTS.MIN_COLUMN_WIDTH, parseInt(e.target.value) || LAYOUT_CONSTRAINTS.MIN_COLUMN_WIDTH)
                        update(l => ({ ...l, columns: l.columns.map((c, i) => i === selection.colIndex ? { ...c, width: w } : c) }))
                      }}
                      className={inputCls} />
                  </div>
                  <p className="text-xs text-gray-500">{layout.columns[selection.colIndex]?.rows.length ?? 0} rows</p>
                </div>
              ) : selectedOverlay ? (
                /* Overlay properties */
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Overlay</h3>
                    <button onClick={() => removeOverlay(selectedOverlay.id)} className="p-1 text-gray-400 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Image URL</label>
                    <input type="text" value={selectedOverlay.image_url} onChange={e => updateOverlay(selectedOverlay.id, o => ({ ...o, image_url: e.target.value }))} className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">X</label>
                      <input type="text" value={selectedOverlay.position.x} onChange={e => updateOverlay(selectedOverlay.id, o => ({ ...o, position: { ...o.position, x: e.target.value } }))} className={inputCls} placeholder="85%" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Y</label>
                      <input type="text" value={selectedOverlay.position.y} onChange={e => updateOverlay(selectedOverlay.id, o => ({ ...o, position: { ...o.position, y: e.target.value } }))} className={inputCls} placeholder="5%" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Width</label>
                      <input type="text" value={selectedOverlay.size.width} onChange={e => updateOverlay(selectedOverlay.id, o => ({ ...o, size: { ...o.size, width: e.target.value } }))} className={inputCls} placeholder="120px" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Height</label>
                      <input type="text" value={selectedOverlay.size.height} onChange={e => updateOverlay(selectedOverlay.id, o => ({ ...o, size: { ...o.size, height: e.target.value } }))} className={inputCls} placeholder="auto" />
                    </div>
                  </div>
                </div>
              ) : (
                /* Screen settings */
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">Screen Settings</h3>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Columns</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => removeColumn(layout.columns.length - 1)} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"><Minus className="w-3.5 h-3.5" /></button>
                      <span className="text-white text-sm flex-1 text-center">{layout.columns.length}</span>
                      <button onClick={addColumn} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"><Plus className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Theme</label>
                    <select value={layout.theme ?? 'warm'} onChange={e => update(l => ({ ...l, theme: e.target.value as 'warm'|'dark'|'wps' }))} className={selectCls}>
                      <option value="warm">Warm</option>
                      <option value="dark">Dark</option>
                      <option value="wps">WPS</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="show-header" checked={layout.header?.visible !== false}
                      onChange={e => update(l => ({ ...l, header: { ...l.header, visible: e.target.checked } }))} className="w-4 h-4" />
                    <label htmlFor="show-header" className="text-xs text-gray-300">Show header</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="show-footer" checked={layout.footer?.visible !== false}
                      onChange={e => update(l => ({ ...l, footer: { ...l.footer, visible: e.target.checked } }))} className="w-4 h-4" />
                    <label htmlFor="show-footer" className="text-xs text-gray-300">Show footer</label>
                  </div>
                  <p className="text-xs text-gray-500 pt-2">Click a cell, column header, or overlay to edit properties.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
