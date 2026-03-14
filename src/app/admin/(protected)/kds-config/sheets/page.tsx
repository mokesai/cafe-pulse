'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTenant } from '@/providers/TenantProvider'
import { generateKDSSetupSheet } from './actions'
import {
  FileSpreadsheet,
  RefreshCw,
  Upload,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Loader2,
  ArrowLeft,
} from 'lucide-react'
import Link from 'next/link'

interface SheetStatus {
  google_sheet_url: string | null
  last_synced_at: string | null
  last_imported_at: string | null
}

export default function KdsSheetsPage() {
  const tenant = useTenant()
  const supabase = createClient()
  const [sheetStatus, setSheetStatus] = useState<SheetStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)

  const hasSheet = !!sheetStatus?.google_sheet_url

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

  function handleGenerate(regenerate = false) {
    if (!tenant?.id) return
    setMessage(null)
    setShowRegenerateConfirm(false)

    startTransition(async () => {
      const result = await generateKDSSetupSheet(tenant.id, regenerate)
      if (result.success) {
        setSheetStatus(prev => ({
          ...prev,
          google_sheet_url: result.sheetUrl,
          last_synced_at: null,
          last_imported_at: null,
        }))
        setMessage({
          type: 'success',
          text: `Sheet created with ${result.itemCount} menu items. Click "Open Sheet" to edit.`,
        })
      } else if (result.error === 'SHEET_EXISTS') {
        setShowRegenerateConfirm(true)
      } else if (result.error === 'NO_SQUARE_CREDENTIALS') {
        setMessage({ type: 'error', text: 'Square credentials not connected. Set up Square integration first.' })
      } else {
        setMessage({ type: 'error', text: result.error })
      }
    })
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/kds-config"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to KDS Configuration
        </Link>
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold text-white">Google Sheets Management</h1>
        </div>
        <p className="text-sm text-gray-400 mt-1">
          Generate a setup sheet from your Square catalog, edit it in Google Sheets, then import it back.
        </p>
      </div>

      {/* Message */}
      {message && (
        <div className={`flex items-start gap-3 p-4 rounded-lg mb-6 ${
          message.type === 'success' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
        }`}>
          {message.type === 'success'
            ? <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            : <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />}
          <p className={`text-sm ${message.type === 'success' ? 'text-green-300' : 'text-red-300'}`}>
            {message.text}
          </p>
        </div>
      )}

      {/* Section 1: Sheet */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-blue-400" />
          Setup Sheet
        </h2>

        {loading ? (
          <div className="h-8 bg-gray-700 rounded animate-pulse" />
        ) : hasSheet ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Sheet linked</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={sheetStatus?.google_sheet_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Open Sheet
              </a>
              {!showRegenerateConfirm ? (
                <button
                  onClick={() => setShowRegenerateConfirm(true)}
                  disabled={isPending}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors disabled:opacity-50"
                >
                  Regenerate Sheet
                </button>
              ) : (
                <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-xs text-amber-300">This will replace the existing sheet. Your edits will be lost.</span>
                  <button
                    onClick={() => handleGenerate(true)}
                    disabled={isPending}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes, regenerate'}
                  </button>
                  <button
                    onClick={() => setShowRegenerateConfirm(false)}
                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">
              No sheet yet. Generate one from your Square catalog to get started.
            </p>
            <button
              onClick={() => handleGenerate(false)}
              disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
              ) : (
                <><FileSpreadsheet className="w-4 h-4" /> Generate Setup Sheet</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Section 2: Import (placeholder — MOK-10) */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-4 opacity-60">
        <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
          <Upload className="w-4 h-4 text-purple-400" />
          Import from Sheet
          <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded ml-1">Coming soon</span>
        </h2>
        <p className="text-sm text-gray-500">
          {sheetStatus?.last_imported_at
            ? `Last imported: ${new Date(sheetStatus.last_imported_at).toLocaleString()}`
            : 'Never imported'}
        </p>
      </div>

      {/* Section 3: Square Sync (placeholder — MOK-11) */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 opacity-60">
        <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-green-400" />
          Sync from Square
          <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded ml-1">Coming soon</span>
        </h2>
        <p className="text-sm text-gray-500">
          {sheetStatus?.last_synced_at
            ? `Last synced: ${new Date(sheetStatus.last_synced_at).toLocaleString()}`
            : 'Never synced'}
        </p>
      </div>
    </div>
  )
}
