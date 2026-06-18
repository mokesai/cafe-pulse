'use client'

/**
 * MOK-152 / KDS v3 phase 2 — shared create/edit screen form.
 *
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T6)
 *
 * Hosts the screen metadata fields (name, dims, theme) and the GridEditor.
 * Used by both the new-screen page (no `initialScreen` prop) and the
 * edit-screen page (with `initialScreen` populated from the GET response).
 *
 * Save path:
 *   - new: POST /api/admin/kds-v3/screens (without boxes — initial create),
 *          then PUT /api/admin/kds-v3/screens/[id] (with boxes) if any are
 *          configured before save.
 *   - edit: PUT /api/admin/kds-v3/screens/[id] (atomic update of screen + boxes).
 *
 * Client-side validation via validateBoxLayout for fast UX feedback; server
 * is the source of truth (T4 route enforces the same rules).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GridEditor, type EditableBox } from './GridEditor'
import { validateBoxLayout } from '@/lib/kds/grid-validation'

const UNDO_CAPTURE_DEBOUNCE_MS = 400
const UNDO_HISTORY_LIMIT = 50

/** Snapshot of all editable form state — used by the in-form undo/redo. */
interface FormSnapshot {
  name: string
  rows: number
  cols: number
  theme: InitialScreen['theme']
  boxes: EditableBox[]
}

function snapshotsEqual(a: FormSnapshot, b: FormSnapshot): boolean {
  if (a.name !== b.name || a.rows !== b.rows || a.cols !== b.cols || a.theme !== b.theme) {
    return false
  }
  // Boxes change frequently — cheap shallow check first, JSON-equal fallback.
  if (a.boxes === b.boxes) return true
  if (a.boxes.length !== b.boxes.length) return false
  return JSON.stringify(a.boxes) === JSON.stringify(b.boxes)
}

export interface InitialScreen {
  id: string
  name: string
  grid_rows: number
  grid_cols: number
  theme: 'warm' | 'dark' | 'wps'
  boxes: EditableBox[]
}

interface Props {
  initialScreen?: InitialScreen
  /**
   * When true, the form omits its own back-link + heading block — the
   * parent renders them (used by the edit page's tabbed shell where the
   * page owns the heading + tab strip).
   */
  hideHeader?: boolean
  /**
   * Called after a successful save instead of the default navigation back
   * to /admin/kds-v3/screens. Lets the edit page stay in place so the
   * operator can toggle to the Preview tab without a transition.
   */
  onSaved?: () => void
}

const THEMES: Array<InitialScreen['theme']> = ['warm', 'dark', 'wps']

export function ScreenForm({ initialScreen, hideHeader = false, onSaved }: Props) {
  const router = useRouter()
  const editing = Boolean(initialScreen)

  const [name, setName] = useState(initialScreen?.name ?? '')
  const [rows, setRows] = useState(initialScreen?.grid_rows ?? 4)
  const [cols, setCols] = useState(initialScreen?.grid_cols ?? 6)
  const [theme, setTheme] = useState<InitialScreen['theme']>(initialScreen?.theme ?? 'warm')
  const [boxes, setBoxes] = useState<EditableBox[]>(initialScreen?.boxes ?? [])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  // History stack of pre-change snapshots. Debounce captures so a single
  // logical edit (typing a header, dragging a box through a path of cells)
  // becomes one undo step, not many. The form's `key` resets on save, so
  // history is naturally scoped to the current pre-save iteration.
  const initialSnapshot: FormSnapshot = {
    name: initialScreen?.name ?? '',
    rows: initialScreen?.grid_rows ?? 4,
    cols: initialScreen?.grid_cols ?? 6,
    theme: initialScreen?.theme ?? 'warm',
    boxes: initialScreen?.boxes ?? [],
  }
  const [history, setHistory] = useState<FormSnapshot[]>([])
  const [future, setFuture] = useState<FormSnapshot[]>([])
  const lastCapturedRef = useRef<FormSnapshot>(initialSnapshot)
  const restoringRef = useRef(false)
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const applySnapshot = useCallback((s: FormSnapshot) => {
    restoringRef.current = true
    setName(s.name)
    setRows(s.rows)
    setCols(s.cols)
    setTheme(s.theme)
    setBoxes(s.boxes)
    lastCapturedRef.current = s
    // Allow the effect to re-arm one tick later; the restoring-flag prevents
    // the next state-change effect from re-capturing the snapshot we just
    // applied.
    setTimeout(() => {
      restoringRef.current = false
    }, 0)
  }, [])

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setFuture((f) => [lastCapturedRef.current, ...f].slice(0, UNDO_HISTORY_LIMIT))
      applySnapshot(prev)
      return h.slice(0, -1)
    })
  }, [applySnapshot])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f
      const next = f[0]
      setHistory((h) => [...h, lastCapturedRef.current].slice(-UNDO_HISTORY_LIMIT))
      applySnapshot(next)
      return f.slice(1)
    })
  }, [applySnapshot])

  // Debounced capture: when state diverges from lastCaptured, after a quiet
  // period, push lastCaptured to history and update the ref.
  useEffect(() => {
    if (restoringRef.current) return
    const current: FormSnapshot = { name, rows, cols, theme, boxes }
    if (snapshotsEqual(current, lastCapturedRef.current)) return

    if (captureTimerRef.current) clearTimeout(captureTimerRef.current)
    captureTimerRef.current = setTimeout(() => {
      // Re-check inside the timer in case state changed back during the wait.
      if (snapshotsEqual(current, lastCapturedRef.current)) return
      setHistory((h) => [...h, lastCapturedRef.current].slice(-UNDO_HISTORY_LIMIT))
      setFuture([]) // forking history clears the redo branch
      lastCapturedRef.current = current
    }, UNDO_CAPTURE_DEBOUNCE_MS)

    return () => {
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current)
    }
  }, [name, rows, cols, theme, boxes])

  // Keyboard shortcuts: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Ctrl+Y = redo.
  // Bypass when focus is in a text input/textarea so the browser's native
  // text-undo (typing in a header field) still works as expected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const target = document.activeElement as HTMLElement | null
      const isInTextInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        if (isInTextInput) return
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
        if (isInTextInput) return
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // When the operator shrinks the grid, prevent invalid layouts by clamping
  // boxes that would now exceed the bounds. Conservative: flag rather than
  // auto-shrink — operator likely wants to know.
  useEffect(() => {
    const layout = validateBoxLayout(boxes, { rows, cols })
    setErrors(layout.ok ? [] : layout.errors)
  }, [boxes, rows, cols])

  const onSave = async () => {
    setErrors([])
    if (!name.trim()) {
      setErrors(['Name is required.'])
      return
    }
    const layout = validateBoxLayout(boxes, { rows, cols })
    if (!layout.ok) {
      setErrors(layout.errors)
      return
    }

    setSaving(true)
    try {
      let screenId = initialScreen?.id
      if (!screenId) {
        // Create the screen first (no boxes yet), then PUT to add them.
        const createRes = await fetch('/api/admin/kds-v3/screens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, grid_rows: rows, grid_cols: cols, theme }),
        })
        const createBody = await createRes.json()
        if (!createRes.ok || !createBody.success) {
          setErrors([createBody.error ?? `Create failed (HTTP ${createRes.status})`])
          return
        }
        screenId = createBody.data.id as string
      }

      // PUT to commit screen fields + boxes in one atomic update.
      const putRes = await fetch(`/api/admin/kds-v3/screens/${screenId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          grid_rows: rows,
          grid_cols: cols,
          theme,
          boxes,
        }),
      })
      const putBody = await putRes.json()
      if (!putRes.ok || !putBody.success) {
        const msgs = (putBody.validation_errors as string[] | undefined) ?? [
          putBody.error ?? `Save failed (HTTP ${putRes.status})`,
        ]
        setErrors(msgs)
        return
      }

      if (onSaved) {
        onSaved()
      } else {
        router.push('/admin/kds-v3/screens')
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div>
          <Link
            href="/admin/kds-v3/screens"
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to screens
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">
            {editing ? `Edit screen: ${initialScreen!.name}` : 'New screen'}
          </h1>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <ul className="list-inside list-disc space-y-1">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button
          type="button"
          onClick={undo}
          disabled={history.length === 0}
          title="Undo (⌘Z)"
          className="rounded-md border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={future.length === 0}
          title="Redo (⇧⌘Z)"
          className="rounded-md border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ↷ Redo
        </button>
        <span className="ml-1 text-gray-400">
          ⌘Z to undo · ⇧⌘Z to redo
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Drinks, Food"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Rows</label>
          <input
            type="number"
            min={1}
            max={24}
            value={rows}
            onChange={(e) => setRows(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Columns</label>
          <input
            type="number"
            min={1}
            max={24}
            value={cols}
            onChange={(e) => setCols(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Theme</label>
          <select
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={theme}
            onChange={(e) => setTheme(e.target.value as InitialScreen['theme'])}
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <GridEditor
        grid_rows={rows}
        grid_cols={cols}
        boxes={boxes}
        onChange={setBoxes}
      />

      <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
        <Link
          href="/admin/kds-v3/screens"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
