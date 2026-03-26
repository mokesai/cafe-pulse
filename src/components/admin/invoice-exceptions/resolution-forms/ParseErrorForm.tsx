'use client'

import { useState } from 'react'
import { AlertCircle, ExternalLink } from 'lucide-react'
import type { InvoiceException, ParseErrorContext } from '@/types/invoice-exceptions'

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; from_stage?: string; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  loading?: boolean
}

const STAGE_LABELS: Record<string, string> = {
  extracting: 'Extraction',
  resolving_supplier: 'Supplier Resolution',
  matching_po: 'PO Matching',
  matching_items: 'Item Matching',
  confirming: 'Confirmation',
}

export function ParseErrorForm({ exception, onResolve, onDismiss, loading }: Props) {
  const ctx = exception.exception_context as unknown as ParseErrorContext
  const [choice, setChoice] = useState<'retry' | 'reupload' | null>(null)
  const [notes, setNotes] = useState('')

  const stageLabel = STAGE_LABELS[ctx.stage ?? ''] ?? ctx.stage ?? 'Unknown'

  const handleSubmit = async () => {
    if (choice === 'retry') {
      await onResolve({ type: 'retry_pipeline', from_stage: ctx.stage, resolution_notes: notes || undefined })
    } else if (choice === 'reupload') {
      await onResolve({ type: 'reupload_required', resolution_notes: notes || 'Re-upload required' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
        <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-red-800">
          The pipeline encountered an error during: <strong>{stageLabel}</strong>
        </div>
      </div>

      {/* Error details */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Error details</p>
        <p className="text-sm text-gray-700">{ctx.error_message ?? 'Unknown error occurred'}</p>
        {ctx.retry_count != null && (
          <p className="text-xs text-gray-400 mt-1">
            Retry attempts: {ctx.retry_count} · Fallback attempted: {ctx.fallback_attempted ? 'Yes' : 'No'}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <a
          href={`/admin/invoices`}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          View Invoice
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <a
          href={`/admin/invoice-exceptions/${exception.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          View full error log
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Options:</p>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="parse-choice"
              value="retry"
              checked={choice === 'retry'}
              onChange={() => setChoice('retry')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">Retry pipeline from {stageLabel} stage</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="parse-choice"
              value="reupload"
              checked={choice === 'reupload'}
              onChange={() => setChoice('reupload')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">Re-upload a new file (current file may be corrupt)</span>
          </label>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Optional notes…"
        />
      </div>

      <div className="flex gap-2 pt-1">
        {choice === 'retry' && (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            Retry Pipeline
          </button>
        )}
        {choice === 'reupload' && (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-md hover:bg-orange-700 disabled:opacity-50"
          >
            Mark for Re-upload
          </button>
        )}
        {!choice && (
          <button disabled className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md opacity-50 cursor-not-allowed">
            Select an option above
          </button>
        )}
        <button
          onClick={() => onDismiss(notes || undefined)}
          disabled={loading}
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
