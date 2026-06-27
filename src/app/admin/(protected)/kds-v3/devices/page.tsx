'use client'

/**
 * MOK-162 / KDS Pi Deployment phase 6 — devices admin page.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-162
 * Plan: .planning/kds-v3-pi/PHASE-6-PLAN.md (T4)
 *
 * Inlined client component (same convention as
 * src/app/admin/(protected)/kds-v3/screens/page.tsx — plain HTML + Tailwind
 * sidesteps the webpack dev-mode chunk issues we hit earlier).
 *
 * Sections (top → bottom):
 *   1. Header + cap indicator
 *   2. Add-device inline form (hidden when cap reached)
 *   3. Setup-code reveal panel (only after a fresh create or for pending rows)
 *   4. Devices table — status dot, inline rename, screen-binding selects,
 *      revoke button
 *   5. Empty state
 */
import { useCallback, useEffect, useState } from 'react'

interface ScreenSummary {
  id: string
  name: string
}

interface DeviceRow {
  id: string
  name: string
  status: string
  computed_status: 'online' | 'stale' | 'offline' | 'pending'
  setup_code: string | null
  setup_code_expires_at: string | null
  last_heartbeat_at: string | null
  ip_address: string | null
  registered_at: string | null
  created_at: string
  screen_1_id: string | null
  screen_2_id: string | null
  screen_1_name: string | null
  screen_2_name: string | null
}

interface ListResponse {
  success: boolean
  data: DeviceRow[]
  cap: { current: number; max: number; reached: boolean }
  error?: string
}

interface CreateResponse {
  success: boolean
  data?: DeviceRow
  error?: string
  code?: string
}

interface ScreensListResponse {
  success: boolean
  data: ScreenSummary[]
  error?: string
}

const REFRESH_INTERVAL_MS = 30_000

function statusColor(s: DeviceRow['computed_status']): string {
  switch (s) {
    case 'online':
      return 'bg-green-500'
    case 'stale':
      return 'bg-amber-500'
    case 'pending':
      return 'bg-blue-500'
    case 'offline':
    default:
      return 'bg-gray-400'
  }
}

function statusLabel(s: DeviceRow['computed_status']): string {
  switch (s) {
    case 'online':
      return 'Online'
    case 'stale':
      return 'Stale'
    case 'pending':
      return 'Pending registration'
    case 'offline':
    default:
      return 'Offline'
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return 'just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function KdsV3DevicesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [cap, setCap] = useState<ListResponse['cap']>({ current: 0, max: 1, reached: false })
  const [screens, setScreens] = useState<ScreenSummary[]>([])

  const [newDeviceName, setNewDeviceName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  const [sdBundleDeviceId, setSdBundleDeviceId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [devicesRes, screensRes] = await Promise.all([
        fetch('/api/admin/kds-v3/devices'),
        fetch('/api/admin/kds-v3/screens'),
      ])
      const devicesBody = (await devicesRes.json()) as ListResponse
      if (!devicesRes.ok || !devicesBody.success) {
        setError(devicesBody.error ?? `Failed to load devices (HTTP ${devicesRes.status})`)
        return
      }
      setDevices(devicesBody.data)
      setCap(devicesBody.cap)

      const screensBody = (await screensRes.json()) as ScreensListResponse
      if (screensRes.ok && screensBody.success) {
        setScreens(screensBody.data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      void load()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  const onCreate = async () => {
    const name = newDeviceName.trim()
    if (!name) {
      setCreateError('Name is required')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/admin/kds-v3/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = (await res.json()) as CreateResponse
      if (!res.ok || !body.success) {
        setCreateError(body.error ?? `Failed (HTTP ${res.status})`)
        return
      }
      setNewDeviceName('')
      await load()
    } finally {
      setCreating(false)
    }
  }

  const startRename = (d: DeviceRow) => {
    setRenamingId(d.id)
    setRenameValue(d.name)
    setRowError(null)
  }

  const saveRename = async (id: string) => {
    const name = renameValue.trim()
    if (!name) {
      setRowError({ id, message: 'Name cannot be empty' })
      return
    }
    const res = await fetch(`/api/admin/kds-v3/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await res.json().catch(() => ({ success: false, error: 'Bad response' }))
    if (!res.ok || !body.success) {
      setRowError({ id, message: body.error ?? `Failed (HTTP ${res.status})` })
      return
    }
    setRenamingId(null)
    setRowError(null)
    await load()
  }

  const onScreenChange = async (
    id: string,
    slot: 'screen_1_id' | 'screen_2_id',
    value: string,
  ) => {
    const payload: Record<string, string | null> = { [slot]: value === '' ? null : value }
    const res = await fetch(`/api/admin/kds-v3/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({ success: false, error: 'Bad response' }))
    if (!res.ok || !body.success) {
      setRowError({ id, message: body.error ?? `Failed (HTTP ${res.status})` })
      return
    }
    setRowError(null)
    await load()
  }

  const onRevoke = async (d: DeviceRow) => {
    if (
      !confirm(
        `Revoke device "${d.name}"? The Pi will stop working on its next heartbeat. ` +
          `You'll need to re-flash the SD card to add it back.`,
      )
    ) {
      return
    }
    setRevokingId(d.id)
    try {
      const res = await fetch(`/api/admin/kds-v3/devices/${d.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({ success: false, error: 'Bad response' }))
      if (!res.ok || !body.success) {
        setRowError({ id: d.id, message: body.error ?? `Failed (HTTP ${res.status})` })
        return
      }
      await load()
    } finally {
      setRevokingId(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Devices</h1>
        <p className="mt-4 text-gray-500">Loading…</p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Devices</h1>
        <span className="text-sm text-gray-500">
          {cap.current} of {cap.max} {cap.max === 1 ? 'device' : 'devices'}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Manage the Raspberry Pi devices running KDS displays for this location.
      </p>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!cap.reached && (
        <div className="mt-6 rounded-md border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-medium text-gray-900">Add a device</h2>
          <p className="mt-1 text-xs text-gray-500">
            Creates a pending device with a one-time setup code. Flash an SD card with the code to
            register the Pi.
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-start">
            <input
              type="text"
              value={newDeviceName}
              onChange={(e) => setNewDeviceName(e.target.value)}
              placeholder="Device name (e.g. Kitchen Pi)"
              maxLength={80}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              disabled={creating}
            />
            <button
              type="button"
              onClick={onCreate}
              disabled={creating || !newDeviceName.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? 'Adding…' : 'Add device'}
            </button>
          </div>
          {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}
        </div>
      )}

      {devices.length === 0 ? (
        <div className="mt-8 rounded-md border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">No devices yet. Add one above to get started.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Device
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Status
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Screen 1
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Screen 2
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {devices.map((d) => {
                const showSetup =
                  (d.computed_status === 'pending' && d.setup_code) ||
                  sdBundleDeviceId === d.id
                return (
                  <tr key={d.id} className="align-top">
                    <td className="px-4 py-3 text-sm">
                      {renamingId === d.id ? (
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            maxLength={80}
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => saveRename(d.id)}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(null)
                              setRowError(null)
                            }}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{d.name}</span>
                          <button
                            type="button"
                            onClick={() => startRename(d)}
                            className="text-xs text-gray-500 hover:text-blue-600"
                            aria-label={`Rename ${d.name}`}
                          >
                            ✎
                          </button>
                        </div>
                      )}
                      {showSetup && d.setup_code && (
                        <div className="mt-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900">
                          <div>
                            Setup code:{' '}
                            <code className="font-mono text-sm font-semibold">{d.setup_code}</code>
                          </div>
                          <p className="mt-1 text-blue-700">
                            Run on the Pi:{' '}
                            <code className="font-mono">
                              curl -sL {`{site}`}/api/kds/setup/{d.setup_code} | bash
                            </code>
                          </p>
                        </div>
                      )}
                      {rowError?.id === d.id && (
                        <p className="mt-1 text-xs text-red-600">{rowError.message}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${statusColor(d.computed_status)}`}
                          aria-hidden="true"
                        />
                        <span className="text-gray-700">{statusLabel(d.computed_status)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Last seen {relativeTime(d.last_heartbeat_at)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <select
                        value={d.screen_1_id ?? ''}
                        onChange={(e) => onScreenChange(d.id, 'screen_1_id', e.target.value)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      >
                        <option value="">— Unassigned —</option>
                        {screens.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {!d.screen_1_id && (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <select
                        value={d.screen_2_id ?? ''}
                        onChange={(e) => onScreenChange(d.id, 'screen_2_id', e.target.value)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      >
                        <option value="">— Unassigned —</option>
                        {screens.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {!d.screen_2_id && (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      <div className="flex justify-end gap-3">
                        {d.computed_status === 'pending' && (
                          <button
                            type="button"
                            onClick={() =>
                              setSdBundleDeviceId(sdBundleDeviceId === d.id ? null : d.id)
                            }
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            {sdBundleDeviceId === d.id ? 'Hide setup' : 'Show setup'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRevoke(d)}
                          disabled={revokingId === d.id}
                          className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {revokingId === d.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
