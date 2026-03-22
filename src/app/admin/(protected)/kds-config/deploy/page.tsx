'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTenant } from '@/providers/TenantProvider'
import { listDevices, revokeDevice, updateDevice, type KDSDevice } from './deploy-actions'
import {
  Tv, Plus, ArrowLeft, Trash2, Edit3, Loader2,
  AlertCircle, CheckCircle, Wifi, WifiOff,
} from 'lucide-react'
import Link from 'next/link'

function StatusDot({ device }: { device: KDSDevice }) {
  if (device.status === 'pending') {
    return <span title="Pending registration" className="inline-block w-2.5 h-2.5 rounded-full bg-gray-500" />
  }
  if (!device.last_heartbeat_at) {
    return <span title="Never connected" className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
  }
  const lastBeat = new Date(device.last_heartbeat_at).getTime()
  const isOnline = Date.now() - lastBeat < 3 * 60 * 1000 // 3 minutes
  return (
    <span
      title={isOnline ? 'Online' : 'Offline'}
      className={`inline-block w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}
    />
  )
}

function RelativeTime({ date }: { date: string | null }) {
  if (!date) return <span className="text-gray-500">Never</span>
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return <span className="text-green-400">Just now</span>
  if (mins < 60) return <span className="text-gray-400">{mins}m ago</span>
  const hours = Math.floor(mins / 60)
  if (hours < 24) return <span className="text-gray-400">{hours}h ago</span>
  const days = Math.floor(hours / 24)
  return <span className="text-gray-500">{days}d ago</span>
}

export default function DeployPage() {
  const tenant = useTenant()
  const [devices, setDevices] = useState<KDSDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!tenant?.id) return
    loadDevices()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id])

  // Refresh device list every 30 seconds for live status
  useEffect(() => {
    if (!tenant?.id) return
    const interval = setInterval(loadDevices, 30000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id])

  function loadDevices() {
    if (!tenant?.id) return
    listDevices(tenant.id).then(result => {
      if (result.success) setDevices(result.devices)
      setLoading(false)
    })
  }

  function handleRevoke(deviceId: string) {
    if (!tenant?.id) return
    startTransition(async () => {
      const result = await revokeDevice(deviceId, tenant.id)
      if (result.success) {
        setDevices(prev => prev.filter(d => d.id !== deviceId))
        setMsg({ type: 'success', text: 'Device revoked.' })
        setConfirmDeleteId(null)
      } else {
        setMsg({ type: 'error', text: result.error ?? 'Failed to revoke' })
      }
    })
  }

  function handleRename(deviceId: string) {
    if (!tenant?.id || !editName.trim()) return
    startTransition(async () => {
      const result = await updateDevice(deviceId, tenant.id, { name: editName.trim() })
      if (result.success) {
        setDevices(prev => prev.map(d => d.id === deviceId ? result.device : d))
        setEditingId(null)
        setEditName('')
      } else {
        setMsg({ type: 'error', text: result.error ?? 'Failed to rename' })
      }
    })
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/kds-config" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to KDS Configuration
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Tv className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Deploy to TV</h1>
          </div>
          <Link
            href="/admin/kds-config/deploy/add"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Device
          </Link>
        </div>
        <p className="text-sm text-gray-400 mt-1">Manage your Raspberry Pi KDS displays.</p>
      </div>

      {/* Messages */}
      {msg && (
        <div className={`flex items-center gap-3 p-3 rounded-lg mb-4 ${msg.type === 'success' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
          {msg.type === 'success' ? <CheckCircle className="w-4 h-4 text-green-400" /> : <AlertCircle className="w-4 h-4 text-red-400" />}
          <span className={`text-sm ${msg.type === 'success' ? 'text-green-300' : 'text-red-300'}`}>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="ml-auto text-gray-500 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Device Table */}
      {loading ? (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 text-center">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : devices.length === 0 ? (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 text-center">
          <Tv className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm mb-4">No devices registered yet.</p>
          <Link
            href="/admin/kds-config/deploy/add"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Your First Device
          </Link>
        </div>
      ) : (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Screen 1</th>
                <th className="text-left px-4 py-3">Screen 2</th>
                <th className="text-left px-4 py-3">Last Heartbeat</th>
                <th className="text-left px-4 py-3">IP</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map(device => (
                <tr key={device.id} className="border-b border-gray-700/50 hover:bg-gray-750">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot device={device} />
                      <span className="text-xs text-gray-400 capitalize">{device.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {editingId === device.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRename(device.id)}
                          className="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 w-40"
                          autoFocus
                        />
                        <button onClick={() => handleRename(device.id)} className="text-green-400 hover:text-green-300 text-xs">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-white text-xs">Cancel</button>
                      </div>
                    ) : (
                      <span className="text-white font-medium">{device.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300 capitalize">{device.screen_1}</td>
                  <td className="px-4 py-3 text-gray-300 capitalize">{device.screen_2}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {device.last_heartbeat_at ? (
                        <Wifi className="w-3.5 h-3.5 text-gray-500" />
                      ) : (
                        <WifiOff className="w-3.5 h-3.5 text-gray-600" />
                      )}
                      <RelativeTime date={device.last_heartbeat_at} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{device.ip_address ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => { setEditingId(device.id); setEditName(device.name) }}
                        className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700"
                        title="Rename"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {confirmDeleteId === device.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleRevoke(device.id)}
                            disabled={isPending}
                            className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded disabled:opacity-50"
                          >
                            {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(device.id)}
                          className="p-1.5 text-gray-400 hover:text-red-400 rounded hover:bg-gray-700"
                          title="Revoke"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
