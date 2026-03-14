'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTenant } from '@/providers/TenantProvider'
import { 
  Monitor, 
  FileSpreadsheet, 
  RefreshCw, 
  Upload, 
  Eye,
  Grid,
  CheckCircle,
  AlertCircle,
  Clock
} from 'lucide-react'
import Link from 'next/link'

interface KdsSheetStatus {
  google_sheet_url: string | null
  last_synced_at: string | null
  last_imported_at: string | null
}

function StatusBadge({ label, date }: { label: string; date: string | null }) {
  if (!date) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <AlertCircle className="w-4 h-4" />
        <span className="text-sm">{label}: Never</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-green-400">
      <CheckCircle className="w-4 h-4" />
      <span className="text-sm">
        {label}: {new Date(date).toLocaleDateString()} {new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

export default function KdsConfigPage() {
  const tenant = useTenant()
  const supabase = createClient()
  const [sheetStatus, setSheetStatus] = useState<KdsSheetStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    const client = supabase
    client
      .from('tenant_kds_sheets')
      .select('google_sheet_url, last_synced_at, last_imported_at')
      .eq('tenant_id', tenant.id)
      .maybeSingle()
      .then(({ data }) => {
        setSheetStatus(data ?? { google_sheet_url: null, last_synced_at: null, last_imported_at: null })
        setLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id])

  const hasSheet = !!sheetStatus?.google_sheet_url

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Monitor className="w-7 h-7 text-primary-400" />
          <h1 className="text-2xl font-bold text-white">KDS Configuration</h1>
        </div>
        <p className="text-gray-400">
          Configure your Kitchen Display System screens — manage menu data, display layout, and screen settings.
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Sheet Status */}
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-medium text-gray-300">Setup Sheet</span>
          </div>
          {loading ? (
            <div className="h-4 bg-gray-700 rounded animate-pulse" />
          ) : hasSheet ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-medium">Sheet linked</span>
              </div>
              <a
                href={sheetStatus?.google_sheet_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Open in Google Sheets ↗
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">No sheet yet</span>
            </div>
          )}
        </div>

        {/* Last Import */}
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <Upload className="w-5 h-5 text-purple-400" />
            <span className="text-sm font-medium text-gray-300">Last Import</span>
          </div>
          {loading ? (
            <div className="h-4 bg-gray-700 rounded animate-pulse" />
          ) : (
            <StatusBadge label="Imported" date={sheetStatus?.last_imported_at ?? null} />
          )}
        </div>

        {/* Last Square Sync */}
        <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <RefreshCw className="w-5 h-5 text-green-400" />
            <span className="text-sm font-medium text-gray-300">Square Sync</span>
          </div>
          {loading ? (
            <div className="h-4 bg-gray-700 rounded animate-pulse" />
          ) : (
            <StatusBadge label="Synced" date={sheetStatus?.last_synced_at ?? null} />
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

          {/* Sheets Pipeline */}
          <Link
            href="/admin/kds-config/sheets"
            className="flex items-start gap-4 p-4 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-blue-500 rounded-lg transition-colors group"
          >
            <div className="p-2 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors">
              <FileSpreadsheet className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Manage Sheet</p>
              <p className="text-xs text-gray-400 mt-0.5">Generate, import, or sync via Google Sheets</p>
            </div>
          </Link>

          {/* Grid Editor — Phase 3 */}
          <div className="flex items-start gap-4 p-4 bg-gray-800 border border-gray-700 rounded-lg opacity-50 cursor-not-allowed">
            <div className="p-2 bg-gray-700 rounded-lg">
              <Grid className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-400">Layout Editor</p>
              <p className="text-xs text-gray-500 mt-0.5">Visual drag-and-drop screen builder</p>
              <span className="inline-block mt-1 text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Coming soon</span>
            </div>
          </div>

          {/* Preview — Phase 4 */}
          <div className="flex items-start gap-4 p-4 bg-gray-800 border border-gray-700 rounded-lg opacity-50 cursor-not-allowed">
            <div className="p-2 bg-gray-700 rounded-lg">
              <Eye className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-400">Preview Screens</p>
              <p className="text-xs text-gray-500 mt-0.5">Preview KDS at 1920×1080</p>
              <span className="inline-block mt-1 text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Coming soon</span>
            </div>
          </div>

          {/* Live KDS links */}
          <a
            href="/kds/drinks"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-4 p-4 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-500 rounded-lg transition-colors group"
          >
            <div className="p-2 bg-gray-700 rounded-lg">
              <Monitor className="w-5 h-5 text-gray-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Live Drinks Screen ↗</p>
              <p className="text-xs text-gray-400 mt-0.5">Open live KDS drinks display</p>
            </div>
          </a>

          <a
            href="/kds/food"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-4 p-4 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-500 rounded-lg transition-colors group"
          >
            <div className="p-2 bg-gray-700 rounded-lg">
              <Monitor className="w-5 h-5 text-gray-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Live Food Screen ↗</p>
              <p className="text-xs text-gray-400 mt-0.5">Open live KDS food display</p>
            </div>
          </a>

          {/* Settings */}
          <Link
            href="/admin/kds-config/settings"
            className="flex items-start gap-4 p-4 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-500 rounded-lg transition-colors group"
          >
            <div className="p-2 bg-gray-700 rounded-lg">
              <Clock className="w-5 h-5 text-gray-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Display Settings</p>
              <p className="text-xs text-gray-400 mt-0.5">Theme, refresh intervals, access control</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
