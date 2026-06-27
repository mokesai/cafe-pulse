'use client'

/**
 * MOK-152 / KDS v3 phase 2 — screens list client component.
 *
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T5)
 *
 * - Fetches GET /api/admin/kds-v3/screens on mount + after mutations.
 * - "Add Screen" disabled at the cap with a tooltip.
 * - Delete with confirm.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Trash2, Monitor } from 'lucide-react'
import { Button } from '@/components/ui'

interface ScreenSummary {
  id: string
  name: string
  grid_rows: number
  grid_cols: number
  theme: string
  box_count: number
  created_at: string
}

interface ListResponse {
  success: boolean
  data: ScreenSummary[]
  cap: { current: number; max: number; reached: boolean }
  error?: string
}

export function ScreensList() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [screens, setScreens] = useState<ScreenSummary[]>([])
  const [cap, setCap] = useState<ListResponse['cap']>({ current: 0, max: 2, reached: false })
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/kds-v3/screens')
      const body = (await res.json()) as ListResponse
      if (!res.ok || !body.success) {
        setError(body.error ?? `Failed to load (HTTP ${res.status})`)
        return
      }
      setScreens(body.data)
      setCap(body.cap)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onDelete = async (screen: ScreenSummary) => {
    if (!confirm(`Delete screen "${screen.name}"? This removes all of its grid boxes.`)) return
    setDeletingId(screen.id)
    try {
      const res = await fetch(`/api/admin/kds-v3/screens/${screen.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.success) {
        setError(body.error ?? `Failed to delete (HTTP ${res.status})`)
        return
      }
      await load()
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Loading screens…</div>
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {cap.current} of {cap.max} screens configured
          {cap.reached && ' (limit reached)'}
        </p>
        <span title={cap.reached ? `At the limit of ${cap.max} screens. Delete one to add another.` : ''}>
          {cap.reached ? (
            <Button disabled size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> Add Screen
            </Button>
          ) : (
            <Link href="/admin/kds-v3/screens/new">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1.5" /> Add Screen
              </Button>
            </Link>
          )}
        </span>
      </div>

      {screens.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <Monitor className="mx-auto h-10 w-10 text-gray-400" />
          <h3 className="mt-3 text-sm font-medium text-gray-900">No screens yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Add your first screen to get started — usually one per physical KDS display.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {screens.map((screen) => (
            <li
              key={screen.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{screen.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Grid {screen.grid_rows}×{screen.grid_cols} · Theme {screen.theme} ·{' '}
                  {screen.box_count} {screen.box_count === 1 ? 'box' : 'boxes'}
                </p>
              </div>
              <div className="ml-4 flex items-center gap-2">
                <Link href={`/admin/kds-v3/screens/${screen.id}/edit`}>
                  <Button size="sm" variant="secondary">
                    <Pencil className="h-4 w-4 mr-1.5" /> Edit
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void onDelete(screen)}
                  disabled={deletingId === screen.id}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Delete</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
