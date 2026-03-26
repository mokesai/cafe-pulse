'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Info, Loader2, RotateCcw, Save } from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface InvoicePipelineSettingsData {
  no_po_match_behavior: 'always_create' | 'auto_dismiss' | 'notify_continue'
  price_variance_threshold_pct: number
  total_variance_threshold_pct: number
  match_confidence_threshold_pct: number
  vision_confidence_threshold_pct: number
}

const DEFAULTS: InvoicePipelineSettingsData = {
  no_po_match_behavior: 'always_create',
  price_variance_threshold_pct: 10,
  total_variance_threshold_pct: 5,
  match_confidence_threshold_pct: 85,
  vision_confidence_threshold_pct: 60,
}

// ──────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ──────────────────────────────────────────────────────────────────────────────

interface FieldErrors {
  price_variance_threshold_pct?: string
  total_variance_threshold_pct?: string
  match_confidence_threshold_pct?: string
  vision_confidence_threshold_pct?: string
}

interface FieldWarnings {
  match_confidence_threshold_pct?: string
  vision_confidence_threshold_pct?: string
}

function validateSettings(settings: InvoicePipelineSettingsData): FieldErrors {
  const errors: FieldErrors = {}

  if (settings.price_variance_threshold_pct < 1 || settings.price_variance_threshold_pct > 100) {
    errors.price_variance_threshold_pct = 'Must be between 1 and 100'
  }
  if (settings.total_variance_threshold_pct < 1 || settings.total_variance_threshold_pct > 100) {
    errors.total_variance_threshold_pct = 'Must be between 1 and 100'
  }
  if (settings.match_confidence_threshold_pct < 50 || settings.match_confidence_threshold_pct > 100) {
    errors.match_confidence_threshold_pct = 'Must be between 50 and 100'
  }
  if (settings.vision_confidence_threshold_pct < 10 || settings.vision_confidence_threshold_pct > 100) {
    errors.vision_confidence_threshold_pct = 'Must be between 10 and 100'
  }

  return errors
}

function getWarnings(settings: InvoicePipelineSettingsData): FieldWarnings {
  const warnings: FieldWarnings = {}

  if (settings.match_confidence_threshold_pct < 75) {
    warnings.match_confidence_threshold_pct =
      'Low threshold may cause incorrect inventory matches. We recommend 80–90%.'
  } else if (settings.match_confidence_threshold_pct > 95) {
    warnings.match_confidence_threshold_pct =
      'High threshold will send most items to the exception queue.'
  }

  if (settings.vision_confidence_threshold_pct < 40) {
    warnings.vision_confidence_threshold_pct =
      'Very low threshold may allow poorly extracted invoices to continue without review.'
  }

  return warnings
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string
}

function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div className="flex items-center mb-4">
      <div className="flex-1 border-t border-gray-200" />
      <span className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
        {title}
      </span>
      <div className="flex-1 border-t border-gray-200" />
    </div>
  )
}

interface ThresholdFieldProps {
  id: string
  label: string
  hint?: string
  value: number
  onChange: (val: number) => void
  min: number
  max: number
  error?: string
  warning?: string
  disabled?: boolean
}

function ThresholdField({
  id,
  label,
  hint,
  value,
  onChange,
  min,
  max,
  error,
  warning,
  disabled,
}: ThresholdFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          aria-describedby={error ? `${id}-error` : warning ? `${id}-warning` : hint ? `${id}-hint` : undefined}
          className={`w-24 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
            error
              ? 'border-red-300 bg-red-50'
              : 'border-gray-300'
          } ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50' : ''}`}
        />
        <span className="text-sm text-gray-500">%</span>
      </div>
      {hint && !error && !warning && (
        <p id={`${id}-hint`} className="text-xs text-gray-500 flex items-start gap-1 mt-1">
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-gray-400" />
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-600 flex items-center gap-1 mt-1" role="alert">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          {error}
        </p>
      )}
      {warning && !error && (
        <p id={`${id}-warning`} className="text-xs text-amber-600 flex items-start gap-1 mt-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          {warning}
        </p>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Skeleton loader
// ──────────────────────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-4 bg-gray-200 rounded w-1/3" />
      <div className="h-10 bg-gray-200 rounded w-full" />
      <div className="h-4 bg-gray-200 rounded w-1/4" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-10 bg-gray-200 rounded" />
        <div className="h-10 bg-gray-200 rounded" />
      </div>
      <div className="h-4 bg-gray-200 rounded w-1/4" />
      <div className="h-10 bg-gray-200 rounded w-1/3" />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export default function InvoicePipelineSettings() {
  const [settings, setSettings] = useState<InvoicePipelineSettingsData>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const errors = validateSettings(settings)
  const warnings = getWarnings(settings)
  const hasErrors = Object.keys(errors).length > 0

  // ── Load settings on mount ──────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/admin/invoice-pipeline-settings', {
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json()
      setSettings(body.data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // ── Save settings ───────────────────────────────────────────────────────────
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasErrors) return
    setSaveError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/invoice-pipeline-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json()
      setSettings(body.data)
      toast.success('Invoice pipeline settings saved')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
      toast.error('Failed to save settings — try again')
    } finally {
      setSaving(false)
    }
  }

  // ── Reset to defaults ───────────────────────────────────────────────────────
  const handleResetConfirm = async () => {
    setShowResetConfirm(false)
    setSaveError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/invoice-pipeline-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULTS),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json()
      setSettings(body.data)
      toast.success('Settings reset to defaults')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to reset')
      toast.error('Failed to reset settings — try again')
    } finally {
      setSaving(false)
    }
  }

  const update = <K extends keyof InvoicePipelineSettingsData>(
    key: K,
    value: InvoicePipelineSettingsData[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Invoice Pipeline Settings</h2>
        <SettingsSkeleton />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Invoice Pipeline Settings</h2>
        <div className="flex items-center gap-3 text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">Could not load settings</p>
            <p className="text-xs text-red-500 mt-0.5">{loadError}</p>
          </div>
          <button
            onClick={() => void loadSettings()}
            className="ml-auto text-sm text-red-700 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <form
        onSubmit={(e) => void handleSave(e)}
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Invoice Pipeline Settings</h2>

        {/* ── Purchase Order Matching ───────────────────────────────────────── */}
        <SectionHeader title="Purchase Order Matching" />
        <div className="mb-6">
          <label
            htmlFor="no_po_match_behavior"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            When an invoice has no matching purchase order:
          </label>
          <select
            id="no_po_match_behavior"
            value={settings.no_po_match_behavior}
            onChange={(e) =>
              update(
                'no_po_match_behavior',
                e.target.value as InvoicePipelineSettingsData['no_po_match_behavior']
              )
            }
            disabled={saving}
            className="block w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="always_create">
              Always create an exception (require review)
            </option>
            <option value="auto_dismiss">
              Auto-dismiss (skip PO matching entirely)
            </option>
            <option value="notify_continue">
              Notify but continue — auto-dismiss after 24h
            </option>
          </select>
          <p className="mt-2 text-xs text-gray-500 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-gray-400" />
            {settings.no_po_match_behavior === 'auto_dismiss'
              ? 'Invoices without a matching PO will be silently processed. No exceptions will be created.'
              : settings.no_po_match_behavior === 'notify_continue'
              ? 'An exception will be created but the pipeline will auto-resolve it after 24 hours if not reviewed.'
              : 'An exception will always be created when no matching PO is found, requiring admin review.'}
          </p>
        </div>

        {/* ── Price Variance Thresholds ─────────────────────────────────────── */}
        <SectionHeader title="Price Variance Thresholds" />
        <div className="mb-6 space-y-4">
          <p className="text-sm text-gray-600 mb-3">
            Flag a price change for review when:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <ThresholdField
              id="price_variance_threshold_pct"
              label="Unit price variance exceeds:"
              hint={`e.g., entering ${settings.price_variance_threshold_pct} means a price change from $12.50 to more than $${(12.5 * (1 + settings.price_variance_threshold_pct / 100)).toFixed(2)} triggers review`}
              value={settings.price_variance_threshold_pct}
              onChange={(val) => update('price_variance_threshold_pct', val)}
              min={1}
              max={100}
              error={errors.price_variance_threshold_pct}
              disabled={saving}
            />
            <ThresholdField
              id="total_variance_threshold_pct"
              label="Invoice total vs. PO total exceeds:"
              hint="Compares invoice total against matching PO total"
              value={settings.total_variance_threshold_pct}
              onChange={(val) => update('total_variance_threshold_pct', val)}
              min={1}
              max={100}
              error={errors.total_variance_threshold_pct}
              disabled={saving}
            />
          </div>
          <p className="text-xs text-gray-500 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-gray-400" />
            Changes apply to new invoices only. Existing exceptions are not affected.
          </p>
        </div>

        {/* ── Item Matching ─────────────────────────────────────────────────── */}
        <SectionHeader title="Item Matching" />
        <div className="mb-6 space-y-4">
          <p className="text-sm text-gray-600 mb-3">
            Auto-match inventory items when confidence is at least:
          </p>
          <ThresholdField
            id="match_confidence_threshold_pct"
            label="Item match confidence threshold:"
            hint="Items below this threshold are sent to the exception queue."
            value={settings.match_confidence_threshold_pct}
            onChange={(val) => update('match_confidence_threshold_pct', val)}
            min={50}
            max={100}
            error={errors.match_confidence_threshold_pct}
            warning={warnings.match_confidence_threshold_pct}
            disabled={saving}
          />
          {!errors.match_confidence_threshold_pct && !warnings.match_confidence_threshold_pct && (
            <p className="text-xs text-gray-500 flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-gray-400" />
              Lowering this threshold reduces exceptions but may cause incorrect matches. We recommend 80–90%.
            </p>
          )}
        </div>

        {/* ── Vision Extraction ─────────────────────────────────────────────── */}
        <SectionHeader title="Vision Extraction" />
        <div className="mb-8 space-y-4">
          <p className="text-sm text-gray-600 mb-3">
            Flag an invoice for low confidence review when extraction confidence is below:
          </p>
          <ThresholdField
            id="vision_confidence_threshold_pct"
            label="Vision confidence threshold:"
            hint="Invoices extracted below this confidence score will generate a low-confidence exception for review."
            value={settings.vision_confidence_threshold_pct}
            onChange={(val) => update('vision_confidence_threshold_pct', val)}
            min={10}
            max={100}
            error={errors.vision_confidence_threshold_pct}
            warning={warnings.vision_confidence_threshold_pct}
            disabled={saving}
          />
        </div>

        {/* ── Save Error ────────────────────────────────────────────────────── */}
        {saveError && (
          <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Failed to save — {saveError}. Please try again.</span>
          </div>
        )}

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to Defaults
          </button>

          <button
            type="submit"
            disabled={saving || hasErrors}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Settings
              </>
            )}
          </button>
        </div>
      </form>

      {/* ── Reset Confirmation Modal ──────────────────────────────────────────── */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-confirm-title"
        >
          <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-6 w-full max-w-md mx-4">
            <h3 id="reset-confirm-title" className="text-base font-semibold text-gray-900 mb-2">
              Reset to defaults?
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              Reset all invoice pipeline settings to defaults? This will overwrite your current
              configuration and cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleResetConfirm()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
