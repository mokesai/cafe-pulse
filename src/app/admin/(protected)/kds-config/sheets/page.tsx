'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTenant } from '@/providers/TenantProvider'
import { generateKDSSetupSheet } from './actions'
import { importFromSheet, type ImportMode, type ImportSubMode, type ImportPreviewResult } from './import-actions'
import { syncFromSquare, type SyncMode } from './sync-actions'
import {
  FileSpreadsheet, RefreshCw, Upload, ExternalLink,
  AlertCircle, CheckCircle, Loader2, ArrowLeft, ChevronDown, ChevronUp, Eye,
} from 'lucide-react'
import Link from 'next/link'

interface SheetStatus {
  google_sheet_url: string | null
  last_synced_at: string | null
  last_imported_at: string | null
}

function StatusLine({ label, date }: { label: string; date: string | null }) {
  if (!date) return <p className="text-xs text-gray-500">{label}: Never</p>
  return (
    <p className="text-xs text-gray-400">
      {label}: {new Date(date).toLocaleString()}
    </p>
  )
}

function MessageBanner({ type, text, onDismiss }: { type: 'success' | 'error'; text: string; onDismiss: () => void }) {
  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg mb-5 ${type === 'success' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
      {type === 'success'
        ? <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
        : <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />}
      <p className={`text-sm flex-1 ${type === 'success' ? 'text-green-300' : 'text-red-300'}`}>{text}</p>
      <button onClick={onDismiss} className="text-gray-500 hover:text-white text-xs">✕</button>
    </div>
  )
}

export default function KdsSheetsPage() {
  const tenant = useTenant()
  const supabase = createClient()
  const [sheetStatus, setSheetStatus] = useState<SheetStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Generate sheet state
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)

  // Import state
  const [importMode, setImportMode] = useState<ImportMode>('clean')
  const [importSubMode, setImportSubMode] = useState<ImportSubMode>('quick')
  const [importExpanded, setImportExpanded] = useState(false)
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)

  // Sync state
  const [syncMode, setSyncMode] = useState<SyncMode>('merge')
  const [syncExpanded, setSyncExpanded] = useState(false)
  const [showCleanSyncWarning, setShowCleanSyncWarning] = useState(false)

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

  // --- Generate ---
  function handleGenerate(regenerate = false) {
    if (!tenant?.id) return
    setMessage(null)
    setShowRegenerateConfirm(false)
    startTransition(async () => {
      const result = await generateKDSSetupSheet(tenant.id, regenerate)
      if (result.success) {
        setSheetStatus(prev => ({ ...prev, google_sheet_url: result.sheetUrl, last_synced_at: null, last_imported_at: null }))
        setMessage({ type: 'success', text: `Sheet created with ${result.itemCount} menu items.` })
      } else if (result.error === 'SHEET_EXISTS') {
        setShowRegenerateConfirm(true)
      } else if (result.error === 'NO_SQUARE_CREDENTIALS') {
        setMessage({ type: 'error', text: 'Square credentials not connected. Set up Square integration first.' })
      } else {
        setMessage({ type: 'error', text: result.error })
      }
    })
  }

  // --- Import ---
  function handleImport() {
    if (!tenant?.id) return
    setMessage(null)
    setPreview(null)
    startTransition(async () => {
      const result = await importFromSheet(tenant.id, importMode, importSubMode)
      if (!result.success) {
        setMessage({ type: 'error', text: result.error })
        return
      }
      if (result.preview) {
        setPreview(result as ImportPreviewResult)
      } else {
        const c = result.counts
        setSheetStatus(prev => ({ ...prev, last_imported_at: new Date().toISOString() }))
        setMessage({ type: 'success', text: `Imported: ${c.categories} categories, ${c.items} items, ${c.images} images, ${c.settings} settings.` })
      }
    })
  }

  function handleApplyPreview() {
    if (!tenant?.id) return
    setMessage(null)
    startTransition(async () => {
      const result = await importFromSheet(tenant.id, importMode, 'quick')
      if (!result.success) {
        setMessage({ type: 'error', text: result.error })
        return
      }
      if (!result.preview) {
        const c = result.counts
        setPreview(null)
        setSheetStatus(prev => ({ ...prev, last_imported_at: new Date().toISOString() }))
        setMessage({ type: 'success', text: `Imported: ${c.categories} categories, ${c.items} items, ${c.images} images, ${c.settings} settings.` })
      }
    })
  }

  // --- Sync ---
  function handleSync(confirmedClean = false) {
    if (!tenant?.id) return
    if (syncMode === 'clean' && !confirmedClean) {
      setShowCleanSyncWarning(true)
      return
    }
    setMessage(null)
    setShowCleanSyncWarning(false)
    startTransition(async () => {
      const result = await syncFromSquare(tenant.id, syncMode)
      if (!result.success) {
        setMessage({ type: 'error', text: result.error === 'NO_SQUARE_CREDENTIALS' ? 'Square credentials not connected.' : result.error })
        return
      }
      setSheetStatus(prev => ({ ...prev, last_synced_at: new Date().toISOString() }))
      const { updated, added, flagged } = result.counts
      setMessage({ type: 'success', text: `Square sync complete: ${updated} updated, ${added} added, ${flagged} flagged as removed.` })
    })
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/kds-config" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to KDS Configuration
        </Link>
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold text-white">Google Sheets Management</h1>
        </div>
        <p className="text-sm text-gray-400 mt-1">Generate a setup sheet, edit in Google Sheets, then import back.</p>
      </div>

      {message && <MessageBanner type={message.type} text={message.text} onDismiss={() => setMessage(null)} />}

      {/* ── Section 1: Setup Sheet ── */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-blue-400" />
          Setup Sheet
        </h2>
        {loading ? (
          <div className="h-8 bg-gray-700 rounded animate-pulse" />
        ) : hasSheet ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Sheet linked</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={sheetStatus?.google_sheet_url ?? '#'} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
                <ExternalLink className="w-4 h-4" />Open Sheet
              </a>
              {!showRegenerateConfirm ? (
                <button onClick={() => setShowRegenerateConfirm(true)} disabled={isPending}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors disabled:opacity-50">
                  Regenerate
                </button>
              ) : (
                <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg w-full">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-xs text-amber-300 flex-1">This replaces the sheet. Your edits will be lost.</span>
                  <button onClick={() => handleGenerate(true)} disabled={isPending}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded disabled:opacity-50">
                    {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Regenerate'}
                  </button>
                  <button onClick={() => setShowRegenerateConfirm(false)}
                    className="px-3 py-1 bg-gray-700 text-gray-300 text-xs rounded">Cancel</button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">No sheet yet. Generate one from your Square catalog.</p>
            <button onClick={() => handleGenerate(false)} disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
              {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Generating…</> : <><FileSpreadsheet className="w-4 h-4" />Generate Setup Sheet</>}
            </button>
          </div>
        )}
      </div>

      {/* ── Section 2: Import from Sheet ── */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-4">
        <button onClick={() => setImportExpanded(v => !v)}
          className="w-full flex items-center justify-between text-left">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-purple-400" />
            Import from Sheet
          </h2>
          <div className="flex items-center gap-3">
            <StatusLine label="Last imported" date={sheetStatus?.last_imported_at ?? null} />
            {importExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </button>

        {importExpanded && (
          <div className="mt-4 space-y-4">
            {/* Mode toggles */}
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Import mode</p>
                <div className="flex rounded-lg overflow-hidden border border-gray-600">
                  {(['clean', 'merge'] as ImportMode[]).map(m => (
                    <button key={m} onClick={() => setImportMode(m)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${importMode === m ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                      {m === 'clean' ? 'Clean (default)' : 'Merge'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Sub-mode</p>
                <div className="flex rounded-lg overflow-hidden border border-gray-600">
                  {(['quick', 'preview'] as ImportSubMode[]).map(m => (
                    <button key={m} onClick={() => setImportSubMode(m)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${importSubMode === m ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                      {m === 'quick' ? 'Quick import' : 'Preview first'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {importMode === 'clean' && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">Clean import deletes all existing KDS data and replaces it with the sheet contents.</p>
              </div>
            )}

            {/* Preview results */}
            {preview && (
              <div className="border border-gray-600 rounded-lg overflow-hidden">
                <div className="p-3 bg-gray-750 flex items-center justify-between">
                  <div className="flex gap-4 text-xs">
                    <span className="text-green-400">+{preview.counts.new} new</span>
                    <span className="text-blue-400">~{preview.counts.changed} changed</span>
                    <span className="text-red-400">-{preview.counts.removed} removed</span>
                  </div>
                  {preview.warnings.length > 0 && (
                    <span className="text-xs text-amber-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />{preview.warnings.length} warning{preview.warnings.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {preview.warnings.length > 0 && (
                  <div className="p-3 bg-amber-500/5 border-t border-gray-600 space-y-1">
                    {preview.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-300">⚠ {w}</p>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 p-3 border-t border-gray-600">
                  <button onClick={handleApplyPreview} disabled={isPending}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg disabled:opacity-50 flex items-center gap-2">
                    {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Apply Import
                  </button>
                  <button onClick={() => setPreview(null)}
                    className="px-4 py-2 bg-gray-700 text-gray-300 text-sm rounded-lg">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!preview && (
              <button onClick={handleImport} disabled={isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : importSubMode === 'preview' ? <Eye className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                {isPending ? 'Working…' : importSubMode === 'preview' ? 'Preview Import' : 'Import Now'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Section 3: Sync from Square ── */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <button onClick={() => setSyncExpanded(v => !v)}
          className="w-full flex items-center justify-between text-left">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-green-400" />
            Sync from Square
          </h2>
          <div className="flex items-center gap-3">
            <StatusLine label="Last synced" date={sheetStatus?.last_synced_at ?? null} />
            {syncExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </button>

        {syncExpanded && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs text-gray-400 mb-1">Sync mode</p>
              <div className="flex rounded-lg overflow-hidden border border-gray-600">
                {(['merge', 'clean'] as SyncMode[]).map(m => (
                  <button key={m} onClick={() => { setSyncMode(m); setShowCleanSyncWarning(false) }}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${syncMode === m ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                    {m === 'merge' ? 'Merge (default)' : 'Clean (overwrite)'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {syncMode === 'merge'
                  ? 'Updates prices and Square categories. Preserves your display names, visibility, and sort order.'
                  : 'Overwrites the entire Menu Items tab with fresh Square data. Your KDS edits will be lost.'}
              </p>
            </div>

            {showCleanSyncWarning && (
              <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs text-red-300 mb-2">This will discard all your KDS display edits. Are you sure?</p>
                  <div className="flex gap-2">
                    <button onClick={() => handleSync(true)} disabled={isPending}
                      className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded disabled:opacity-50">
                      {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes, overwrite'}
                    </button>
                    <button onClick={() => setShowCleanSyncWarning(false)}
                      className="px-3 py-1 bg-gray-700 text-gray-300 text-xs rounded">Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {!showCleanSyncWarning && (
              <button onClick={() => handleSync()} disabled={isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {isPending ? 'Syncing…' : 'Sync from Square'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
