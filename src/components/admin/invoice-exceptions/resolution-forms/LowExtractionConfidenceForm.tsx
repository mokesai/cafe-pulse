'use client'

import { useState } from 'react'
import { ScanLine, FileImage, FileText, ExternalLink } from 'lucide-react'
import type { InvoiceException, LowExtractionConfidenceContext } from '@/types/invoice-exceptions'

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  loading?: boolean
}

export function LowExtractionConfidenceForm({ exception, onResolve, onDismiss, loading }: Props) {
  const ctx = exception.exception_context as unknown as LowExtractionConfidenceContext
  const [choice, setChoice] = useState<'approve' | 'reupload' | null>(null)
  const [notes, setNotes] = useState('')

  const confidencePct = Math.round((ctx.overall_confidence ?? 0) * 100)
  const thresholdPct = Math.round((ctx.threshold ?? 0.6) * 100)
  const perField = ctx.per_field_confidence ?? {}

  const fieldLabels: Record<string, string> = {
    invoice_number: 'Invoice number',
    invoice_date: 'Date',
    supplier_name: 'Supplier',
    total_amount: 'Total',
  }

  const isImage = ctx.file_url && !ctx.file_url.toLowerCase().includes('.pdf')

  const handleSubmit = async () => {
    if (choice === 'approve') {
      await onResolve({ type: 'approve_and_continue', resolution_notes: notes || undefined })
    } else if (choice === 'reupload') {
      await onResolve({ type: 'reupload_required', resolution_notes: notes || 'Re-upload required' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <ScanLine className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-800">
          Extracted with <strong>{confidencePct}% confidence</strong> (threshold: {thresholdPct}%)
        </div>
      </div>

      {/* Invoice preview */}
      {ctx.file_url && (
        <div>
          {isImage ? (
            <img
              src={ctx.file_url}
              alt="Invoice preview"
              className="max-h-48 rounded border border-gray-200 object-contain cursor-pointer"
              onClick={() => window.open(ctx.file_url, '_blank')}
            />
          ) : (
            <a
              href={ctx.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
            >
              <FileText className="w-4 h-4" />
              View Invoice PDF
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Per-field confidence */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Extracted Data:</p>
        <div className="space-y-1">
          {Object.entries(perField).map(([field, conf]) => {
            const pct = Math.round((conf as number) * 100)
            const isLow = pct < 70
            return (
              <div key={field} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">• {fieldLabels[field] ?? field}</span>
                <span className={isLow ? 'text-amber-600 font-medium' : 'text-gray-500'}>
                  {pct}%{isLow ? ' ⚠️' : ''}
                </span>
              </div>
            )
          })}
          {ctx.flagged_item_count != null && (
            <div className="text-sm text-gray-600">
              • Line items: {ctx.flagged_item_count} flagged
            </div>
          )}
        </div>
      </div>

      {/* Resolution options */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Resolution options:</p>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="lowconf-choice"
              value="approve"
              checked={choice === 'approve'}
              onChange={() => setChoice('approve')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">The data looks correct — approve and continue pipeline</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="lowconf-choice"
              value="reupload"
              checked={choice === 'reupload'}
              onChange={() => setChoice('reupload')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">This extraction is wrong — I&apos;ll re-upload a clearer scan</span>
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
        <button
          onClick={handleSubmit}
          disabled={!choice || loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {choice === 'approve' ? 'Approve & Continue' : choice === 'reupload' ? 'Re-upload Required' : 'Submit'}
        </button>
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
