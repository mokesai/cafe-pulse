'use client'

import { useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import type { InvoiceException, DuplicateInvoiceContext } from '@/types/invoice-exceptions'

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  loading?: boolean
}

export function DuplicateInvoiceForm({ exception, onResolve, onDismiss, loading }: Props) {
  const ctx = exception.exception_context as unknown as DuplicateInvoiceContext
  const [choice, setChoice] = useState<'dismiss_duplicate' | 'correction' | 'keep_both' | null>(null)
  const [notes, setNotes] = useState('')

  const existingConfirmedAt = ctx.existing_confirmed_at
    ? new Date(ctx.existing_confirmed_at).toLocaleDateString()
    : 'Unknown'

  const handleSubmit = async () => {
    if (choice === 'dismiss_duplicate') {
      await onResolve({ type: 'dismiss_as_duplicate', resolution_notes: notes || undefined })
    } else if (choice === 'correction') {
      await onResolve({ type: 'process_as_correction', resolution_notes: notes || undefined })
    } else if (choice === 'keep_both') {
      await onResolve({ type: 'keep_both', resolution_notes: notes || undefined })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
        <Copy className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-purple-800">
          ⚠️ A confirmed invoice with this number already exists.
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Existing invoice</p>
          <p className="text-sm font-medium text-gray-700">#{ctx.existing_invoice_number}</p>
          <p className="text-xs text-gray-500">Confirmed {existingConfirmedAt}</p>
          <p className="text-sm text-gray-700 mt-1">${ctx.existing_total_amount?.toFixed(2)}</p>
          {ctx.existing_invoice_id && (
            <a
              href={`/admin/invoices`}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
            >
              View existing <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <div className="p-3 border border-amber-200 rounded-lg bg-amber-50">
          <p className="text-xs font-medium text-amber-600 uppercase tracking-wide mb-2">New upload</p>
          <p className="text-sm font-medium text-gray-700">#{ctx.existing_invoice_number}</p>
          <p className="text-xs text-gray-500">This invoice</p>
          <p className="text-sm text-gray-700 mt-1">${ctx.new_total_amount?.toFixed(2)}</p>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">How would you like to proceed?</p>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="dup-choice"
              value="dismiss_duplicate"
              checked={choice === 'dismiss_duplicate'}
              onChange={() => setChoice('dismiss_duplicate')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">This is a duplicate — dismiss and mark the new upload as duplicate</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="dup-choice"
              value="correction"
              checked={choice === 'correction'}
              onChange={() => setChoice('correction')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">This is a correction — replace the existing invoice with the new one</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="dup-choice"
              value="keep_both"
              checked={choice === 'keep_both'}
              onChange={() => setChoice('keep_both')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">These are different invoices (same number, different content) — process both</span>
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

      <div className="flex gap-2 pt-1 flex-wrap">
        {choice === 'dismiss_duplicate' && (
          <button onClick={handleSubmit} disabled={loading} className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-md hover:bg-gray-700 disabled:opacity-50">
            Dismiss as Duplicate
          </button>
        )}
        {choice === 'correction' && (
          <button onClick={handleSubmit} disabled={loading} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50">
            Process as Correction
          </button>
        )}
        {choice === 'keep_both' && (
          <button onClick={handleSubmit} disabled={loading} className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 disabled:opacity-50">
            Keep Both
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
