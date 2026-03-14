'use client'

import { useState, useCallback, useTransition } from 'react'
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  DragEndEvent,
} from '@dnd-kit/core'
import { useRouter } from 'next/navigation'
import { saveDraft, publishLayout, resetToDefault } from './editor-actions'
import type { KDSLayout, KDSLayoutSection, KDSCategorySection, KDSLayoutOverlay } from '@/lib/kds/layout-types'
import type { KDSCategoryWithItems } from '@/lib/kds/types'
import {
  Save, Upload, RotateCcw, Eye, Monitor, Grid, ArrowLeft,
  Plus, ImageIcon, AlertCircle, CheckCircle, Loader2, Trash2,
} from 'lucide-react'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KDSEditorClientProps {
  tenantId: string
  screen: 'drinks' | 'food'
  initialLayout: KDSLayout
  layoutId: string | null
  updatedAt: string | null
  hasDraft: boolean
  categories: KDSCategoryWithItems[]
}

type SelectedItem =
  | { type: 'section'; id: string }
  | { type: 'overlay'; id: string }
  | null

// ---------------------------------------------------------------------------
// Canvas scale — fit 1920x1080 into ~70% of viewport
// ---------------------------------------------------------------------------
const CANVAS_W = 1920
const CANVAS_H = 1080
const CANVAS_SCALE = 0.35 // renders at 35% for editor

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  return `sec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function nextAvailablePosition(layout: KDSLayout): { col: number; row: number } | null {
  const { columns, rows } = layout.grid
  const occupied = new Set(
    layout.sections.map(s => `${s.position.col},${s.position.row}`)
  )
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      if (!occupied.has(`${c},${r}`)) return { col: c, row: r }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Section block (draggable)
// ---------------------------------------------------------------------------

function SectionBlock({
  section,
  isSelected,
  onClick,
  categories,
  cellW,
  cellH,
}: {
  section: KDSLayoutSection
  isSelected: boolean
  onClick: () => void
  categories: KDSCategoryWithItems[]
  cellW: number
  cellH: number
}) {
  const label =
    section.type === 'category'
      ? categories.find(c => c.slug === section.category_slug)?.name ?? section.category_slug
      : '🖼 Image'

  const w = section.span.cols * cellW
  const h = section.span.rows * cellH
  const x = section.position.col * cellW
  const y = section.position.row * cellH

  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        boxSizing: 'border-box',
        border: isSelected ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.2)',
        background: isSelected ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12 * CANVAS_SCALE * (1 / CANVAS_SCALE),
        color: isSelected ? '#93c5fd' : '#9ca3af',
        fontWeight: 600,
        userSelect: 'none',
        transition: 'border-color 0.15s, background 0.15s',
        overflow: 'hidden',
        padding: 4,
        textAlign: 'center',
      }}
    >
      {label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export default function KDSEditorClient({
  tenantId,
  screen,
  initialLayout,
  layoutId: _layoutId,
  updatedAt: initialUpdatedAt,
  hasDraft: initialHasDraft,
  categories,
}: KDSEditorClientProps) {
  const router = useRouter()
  const [layout, setLayout] = useState<KDSLayout>(initialLayout)
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [hasDraft, setHasDraft] = useState(initialHasDraft)
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warn'; text: string } | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [activeScreen, setActiveScreen] = useState<'drinks' | 'food'>(screen)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const cellW = (CANVAS_W * CANVAS_SCALE) / layout.grid.columns
  const cellH = (CANVAS_H * CANVAS_SCALE) / layout.grid.rows

  // ---------------------------------------------------------------------------
  // Layout mutations
  // ---------------------------------------------------------------------------

  const updateLayout = useCallback((updater: (l: KDSLayout) => KDSLayout) => {
    setLayout(prev => updater(prev))
    setIsDirty(true)
  }, [])

  function addSection() {
    const pos = nextAvailablePosition(layout)
    if (!pos) { setMessage({ type: 'warn', text: 'Grid is full. Remove a section first.' }); return }
    const firstCat = categories[0]
    const newSection: KDSCategorySection = {
      id: generateId(),
      type: 'category',
      category_slug: firstCat?.slug ?? 'uncategorized',
      position: pos,
      span: { cols: 1, rows: 1 },
    }
    updateLayout(l => ({ ...l, sections: [...l.sections, newSection] }))
    setSelectedItem({ type: 'section', id: newSection.id })
  }

  function addImageSection() {
    const pos = nextAvailablePosition(layout)
    if (!pos) { setMessage({ type: 'warn', text: 'Grid is full. Remove a section first.' }); return }
    const newSection = {
      id: generateId(),
      type: 'image' as const,
      image_url: '',
      position: pos,
      span: { cols: 1, rows: 1 },
      fit: 'cover' as const,
    }
    updateLayout(l => ({ ...l, sections: [...l.sections, newSection] }))
    setSelectedItem({ type: 'section', id: newSection.id })
  }

  function removeSelected() {
    if (!selectedItem) return
    if (selectedItem.type === 'section') {
      updateLayout(l => ({ ...l, sections: l.sections.filter(s => s.id !== selectedItem.id) }))
    } else {
      updateLayout(l => ({ ...l, overlays: (l.overlays ?? []).filter(o => o.id !== selectedItem.id) }))
    }
    setSelectedItem(null)
  }

  function updateSelectedSection(updates: Partial<KDSCategorySection>) {
    if (!selectedItem || selectedItem.type !== 'section') return
    updateLayout(l => ({
      ...l,
      sections: l.sections.map(s =>
        s.id === selectedItem.id ? { ...s, ...updates } as KDSLayoutSection : s
      ),
    }))
  }

  function updateSelectedOverlay(updates: Partial<KDSLayoutOverlay>) {
    if (!selectedItem || selectedItem.type !== 'overlay') return
    updateLayout(l => ({
      ...l,
      overlays: (l.overlays ?? []).map(o =>
        o.id === selectedItem.id ? { ...o, ...updates } : o
      ),
    }))
  }

  // Drag end — snap section to grid position
  function handleDragEnd(event: DragEndEvent) {
    const { active, delta } = event
    if (!delta || (delta.x === 0 && delta.y === 0)) return

    updateLayout(l => {
      const section = l.sections.find(s => s.id === active.id)
      if (!section) return l

      const newCol = Math.max(0, Math.min(
        l.grid.columns - section.span.cols,
        section.position.col + Math.round(delta.x / cellW)
      ))
      const newRow = Math.max(0, Math.min(
        l.grid.rows - section.span.rows,
        section.position.row + Math.round(delta.y / cellH)
      ))

      return {
        ...l,
        sections: l.sections.map(s =>
          s.id === active.id
            ? { ...s, position: { col: newCol, row: newRow } }
            : s
        ),
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Save / Publish / Reset actions
  // ---------------------------------------------------------------------------

  function handleSave() {
    startTransition(async () => {
      const result = await saveDraft(tenantId, screen, layout, updatedAt)
      if (result.success) {
        setIsDirty(false)
        setHasDraft(true)
        setUpdatedAt(result.updatedAt)
        setMessage({ type: 'success', text: 'Draft saved.' })
      } else if (result.error === 'CONCURRENT_EDIT') {
        setMessage({ type: 'warn', text: 'Layout was modified elsewhere. Reload to see changes, or save to overwrite.' })
      } else {
        setMessage({ type: 'error', text: result.error })
      }
    })
  }

  function handlePublish() {
    startTransition(async () => {
      const result = await publishLayout(tenantId, screen, layout)
      if (result.success) {
        setIsDirty(false)
        setMessage({ type: 'success', text: 'Published. Live KDS screens will update on next refresh.' })
      } else {
        setMessage({ type: 'error', text: result.error })
      }
    })
  }

  function handleReset() {
    startTransition(async () => {
      const result = await resetToDefault(tenantId, screen)
      if (result.success) {
        setShowResetConfirm(false)
        setMessage({ type: 'success', text: 'Reset to default. Custom layout removed.' })
        router.refresh()
      } else {
        setMessage({ type: 'error', text: result.error ?? 'Reset failed' })
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const selectedSection = selectedItem?.type === 'section'
    ? layout.sections.find(s => s.id === selectedItem.id) ?? null
    : null
  const selectedOverlay = selectedItem?.type === 'overlay'
    ? (layout.overlays ?? []).find(o => o.id === selectedItem.id) ?? null
    : null

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-screen bg-gray-900 overflow-hidden">
      {/* ── Top Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <Link href="/admin/kds-config" className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <span className="text-white font-semibold text-sm">KDS Layout Editor</span>

        {/* Screen toggle */}
        <div className="flex rounded-lg overflow-hidden border border-gray-600 ml-2">
          {(['drinks', 'food'] as const).map(s => (
            <Link key={s} href={`/admin/kds-config/editor/${s}`}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${activeScreen === s ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              onClick={() => setActiveScreen(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </div>

        <div className="flex-1" />

        {/* Status */}
        {isDirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
        {hasDraft && !isDirty && <span className="text-xs text-blue-400">Draft saved</span>}

        {/* Actions */}
        <button onClick={addSection} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg">
          <Plus className="w-3.5 h-3.5" />Add Section
        </button>
        <button onClick={addImageSection} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg">
          <ImageIcon className="w-3.5 h-3.5" />Add Image
        </button>

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

        <button onClick={() => setShowResetConfirm(true)} disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-red-900 text-gray-300 text-xs rounded-lg">
          <RotateCcw className="w-3.5 h-3.5" />Reset
        </button>
      </div>

      {/* ── Message Banner ── */}
      {message && (
        <div className={`px-4 py-2 text-xs flex items-center gap-2 flex-shrink-0 ${
          message.type === 'success' ? 'bg-green-900/50 text-green-300'
          : message.type === 'warn' ? 'bg-amber-900/50 text-amber-300'
          : 'bg-red-900/50 text-red-300'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Reset Confirm ── */}
      {showResetConfirm && (
        <div className="px-4 py-2 bg-red-900/40 border-b border-red-800 flex items-center gap-3 text-xs flex-shrink-0">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-300">This deletes your custom layout (draft + published). KDS reverts to defaults.</span>
          <button onClick={handleReset} disabled={isPending}
            className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white rounded disabled:opacity-50">
            {isPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Yes, reset'}
          </button>
          <button onClick={() => setShowResetConfirm(false)} className="px-3 py-1 bg-gray-700 text-gray-300 rounded">Cancel</button>
        </div>
      )}

      {/* ── Main Editor Area ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Canvas (70%) */}
        <div className="flex-1 overflow-auto p-6 flex items-start justify-center bg-gray-950">
          <div>
            <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
              <Monitor className="w-3.5 h-3.5" />
              <span>1920×1080 — {Math.round(CANVAS_SCALE * 100)}% scale</span>
              <Grid className="w-3.5 h-3.5 ml-2" />
              <span>{layout.grid.columns}×{layout.grid.rows} grid</span>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <div
                style={{
                  width: CANVAS_W * CANVAS_SCALE,
                  height: CANVAS_H * CANVAS_SCALE,
                  position: 'relative',
                  background: '#111',
                  border: '1px solid #374151',
                  overflow: 'hidden',
                }}
                onClick={(e) => { if (e.target === e.currentTarget) setSelectedItem(null) }}
              >
                {/* Grid lines */}
                {Array.from({ length: layout.grid.columns + 1 }).map((_, i) => (
                  <div key={`vl-${i}`} style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: i * cellW, width: 1,
                    background: 'rgba(255,255,255,0.06)',
                  }} />
                ))}
                {Array.from({ length: layout.grid.rows + 1 }).map((_, i) => (
                  <div key={`hl-${i}`} style={{
                    position: 'absolute', left: 0, right: 0,
                    top: i * cellH, height: 1,
                    background: 'rgba(255,255,255,0.06)',
                  }} />
                ))}

                {/* Sections */}
                {layout.sections.map(section => (
                  <SectionBlock
                    key={section.id}
                    section={section}
                    isSelected={selectedItem?.type === 'section' && selectedItem.id === section.id}
                    onClick={() => setSelectedItem({ type: 'section', id: section.id })}
                    categories={categories}
                    cellW={cellW}
                    cellH={cellH}
                  />
                ))}

                {/* Overlays */}
                {(layout.overlays ?? []).map(overlay => (
                  <div
                    key={overlay.id}
                    onClick={() => setSelectedItem({ type: 'overlay', id: overlay.id })}
                    style={{
                      position: 'absolute',
                      left: overlay.position.x,
                      top: overlay.position.y,
                      width: overlay.size.width,
                      height: overlay.size.height,
                      border: selectedItem?.type === 'overlay' && selectedItem.id === overlay.id
                        ? '2px solid #f59e0b' : '1px dashed rgba(255,255,255,0.3)',
                      cursor: 'pointer',
                      zIndex: 10,
                      background: 'rgba(245,158,11,0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      color: '#fbbf24',
                    }}
                  >
                    {overlay.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={overlay.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <ImageIcon className="w-4 h-4" />
                    )}
                  </div>
                ))}
              </div>
            </DndContext>
          </div>
        </div>

        {/* Right: Properties Panel (30%) */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto flex-shrink-0">
          <div className="p-4">
            {selectedSection ? (
              /* Section properties */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Section</h3>
                  <button onClick={removeSelected} className="p-1 text-gray-400 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {selectedSection.type === 'category' && (
                  <>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Category</label>
                      <select
                        value={selectedSection.category_slug}
                        onChange={e => updateSelectedSection({ category_slug: e.target.value })}
                        className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                      >
                        {categories.map(c => (
                          <option key={c.slug} value={c.slug}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Display type</label>
                      <select
                        value={selectedSection.display_type ?? ''}
                        onChange={e => updateSelectedSection({ display_type: e.target.value as typeof selectedSection.display_type || undefined })}
                        className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                      >
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

                {selectedSection.type === 'image' && (
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Image URL</label>
                    <input
                      type="text"
                      value={selectedSection.image_url}
                      onChange={e => updateSelectedSection({ image_url: e.target.value } as Partial<typeof selectedSection>)}
                      placeholder="/images/kds/..."
                      className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Span cols</label>
                    <input type="number" min={1} max={layout.grid.columns}
                      value={selectedSection.span.cols}
                      onChange={e => updateSelectedSection({ span: { ...selectedSection.span, cols: parseInt(e.target.value) || 1 } })}
                      className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Span rows</label>
                    <input type="number" min={1} max={layout.grid.rows}
                      value={selectedSection.span.rows}
                      onChange={e => updateSelectedSection({ span: { ...selectedSection.span, rows: parseInt(e.target.value) || 1 } })}
                      className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Col (0-indexed)</label>
                    <input type="number" min={0} max={layout.grid.columns - 1}
                      value={selectedSection.position.col}
                      onChange={e => updateSelectedSection({ position: { ...selectedSection.position, col: parseInt(e.target.value) || 0 } })}
                      className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Row (0-indexed)</label>
                    <input type="number" min={0} max={layout.grid.rows - 1}
                      value={selectedSection.position.row}
                      onChange={e => updateSelectedSection({ position: { ...selectedSection.position, row: parseInt(e.target.value) || 0 } })}
                      className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    />
                  </div>
                </div>
              </div>
            ) : selectedOverlay ? (
              /* Overlay properties */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Image Overlay</h3>
                  <button onClick={removeSelected} className="p-1 text-gray-400 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Image URL</label>
                  <input type="text" value={selectedOverlay.image_url}
                    onChange={e => updateSelectedOverlay({ image_url: e.target.value })}
                    placeholder="/images/kds/..."
                    className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">X position</label>
                    <input type="text" value={selectedOverlay.position.x}
                      onChange={e => updateSelectedOverlay({ position: { ...selectedOverlay.position, x: e.target.value } })}
                      placeholder="85%"
                      className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Y position</label>
                    <input type="text" value={selectedOverlay.position.y}
                      onChange={e => updateSelectedOverlay({ position: { ...selectedOverlay.position, y: e.target.value } })}
                      placeholder="5%"
                      className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Width</label>
                    <input type="text" value={selectedOverlay.size.width}
                      onChange={e => updateSelectedOverlay({ size: { ...selectedOverlay.size, width: e.target.value } })}
                      placeholder="120px"
                      className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Height</label>
                    <input type="text" value={selectedOverlay.size.height}
                      onChange={e => updateSelectedOverlay({ size: { ...selectedOverlay.size, height: e.target.value } })}
                      placeholder="auto"
                      className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* Screen-level settings */
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-white">Screen Settings</h3>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Grid columns</label>
                  <input type="number" min={1} max={6} value={layout.grid.columns}
                    onChange={e => updateLayout(l => ({ ...l, grid: { ...l.grid, columns: parseInt(e.target.value) || 2 } }))}
                    className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Grid rows</label>
                  <input type="number" min={1} max={6} value={layout.grid.rows}
                    onChange={e => updateLayout(l => ({ ...l, grid: { ...l.grid, rows: parseInt(e.target.value) || 3 } }))}
                    className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Theme</label>
                  <select value={layout.theme ?? 'warm'}
                    onChange={e => updateLayout(l => ({ ...l, theme: e.target.value as 'warm' | 'dark' | 'wps' }))}
                    className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                  >
                    <option value="warm">Warm</option>
                    <option value="dark">Dark</option>
                    <option value="wps">WPS</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="header-visible"
                    checked={layout.header?.visible !== false}
                    onChange={e => updateLayout(l => ({ ...l, header: { ...l.header, visible: e.target.checked } }))}
                    className="w-4 h-4"
                  />
                  <label htmlFor="header-visible" className="text-xs text-gray-300">Show header</label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="footer-visible"
                    checked={layout.footer?.visible !== false}
                    onChange={e => updateLayout(l => ({ ...l, footer: { ...l.footer, visible: e.target.checked } }))}
                    className="w-4 h-4"
                  />
                  <label htmlFor="footer-visible" className="text-xs text-gray-300">Show footer</label>
                </div>

                <div className="pt-2 border-t border-gray-700">
                  <p className="text-xs text-gray-500">Click a section or overlay to edit its properties.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
