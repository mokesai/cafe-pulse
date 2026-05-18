'use client'

/**
 * MOK-152 / KDS v3 phase 2 — screens list page (admin).
 *
 * Inlined version (no separate ScreensList component, no @/components/ui
 * Button, no lucide-react icons). The dynamic-import + barrel-export
 * structure caused webpack dev-mode chunk-resolution errors that survived
 * cache resets. Plain HTML + Tailwind is reliable.
 *
 * If we want to factor this out again later, do it after T8 verification
 * passes and confirm webpack handles the chunked structure consistently.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

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

export default function KdsV3ScreensPage() {
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">KDS Screens (v3)</h1>
        <p className="mt-1 text-sm text-gray-600">
          Configure up to 2 KDS screens for this location. Each screen has its own grid
          layout. Box content (menu groups, aesthetic images) is wired up in later phases.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading screens…</div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              {cap.current} of {cap.max} screens configured
              {cap.reached && ' (limit reached)'}
            </p>
            {cap.reached ? (
              <button
                disabled
                className="rounded-md bg-gray-300 px-3 py-1.5 text-sm font-medium text-gray-500 cursor-not-allowed"
                title={`At the limit of ${cap.max} screens. Delete one to add another.`}
              >
                + Add Screen
              </button>
            ) : (
              <Link
                href="/admin/kds-v3/screens/new"
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                + Add Screen
              </Link>
            )}
          </div>

          {screens.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
              <h3 className="text-sm font-medium text-gray-900">No screens yet</h3>
              <p className="mt-1 text-sm text-gray-500">
                Add your first screen to get started.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
              {screens.map((screen) => (
                <li key={screen.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{screen.name}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Grid {screen.grid_rows}×{screen.grid_cols} · Theme {screen.theme} ·{' '}
                      {screen.box_count} {screen.box_count === 1 ? 'box' : 'boxes'}
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    <Link
                      href={`/admin/kds-v3/screens/${screen.id}/preview`}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50"
                    >
                      Preview
                    </Link>
                    <Link
                      href={`/admin/kds-v3/screens/${screen.id}/edit`}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => void onDelete(screen)}
                      disabled={deletingId === screen.id}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
