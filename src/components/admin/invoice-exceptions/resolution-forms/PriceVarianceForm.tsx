'use client'

import { useState } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { InvoiceException, PriceVarianceContext } from '@/types/invoice-exceptions'

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  loading?: boolean
}

export function PriceVarianceForm({ exception, onResolve, onDismiss, loading }: Props) {
  const ctx = exception.exception_context as unknown as PriceVarianceContext
  const [choice, setChoice] = useState<'approve' | 'reject' | null>(null)
  const [notes, setNotes] = useState('')
  const [notesError, setNotesError] = useState('')

  const isIncrease = (ctx.variance_pct ?? 0) > 0
  const variancePct = Math.abs(ctx.variance_pct ?? 0).toFixed(1)
  const priceDiff = (ctx.invoice_unit_price ?? 0) - (ctx.previous_unit_cost ?? 0)

  const handleSubmit = async () => {
    if (choice === 'reject' && !notes.trim()) {
      setNotesError('Notes are required when rejecting a price change.')
      return
    }
    setNotesError('')

    if (choice === 'approve') {
      await onResolve({ type: 'approve_cost_update', resolution_notes: notes || undefined })
    } else if (choice === 'reject') {
      await onResolve({ type: 'reject_cost_update', resolution_notes: notes })
    }
  }

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 p-3 rounded-lg border ${isIncrease ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
        {isIncrease
          ? <TrendingUp className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          : <TrendingDown className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
        }
        <div className={`text-sm ${isIncrease ? 'text-red-800' : 'text-green-800'}`}>
          {isIncrease
            ? `⬆️ Price increased ${variancePct}% — above your ${ctx.threshold_pct ?? 10}% threshold`
            : `⬇️ Price decreased ${variancePct}% — this may be a deal or data entry error`
          }
        </div>
      </div>

      {/* Price comparison table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Previous price</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Invoice price</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-3 py-2 text-gray-700">${ctx.previous_unit_cost?.toFixed(2)}/unit</td>
              <td className="px-3 py-2 font-medium">${ctx.invoice_unit_price?.toFixed(2)}/unit</td>
              <td className={`px-3 py-2 font-semibold ${isIncrease ? 'text-red-600' : 'text-green-600'}`}>
                {isIncrease ? '+' : ''}{priceDiff >= 0 ? '+' : ''}${priceDiff.toFixed(2)} ({isIncrease ? '+' : '-'}{variancePct}%)
              </td>
            </tr>
          </tbody>
        </table>
        {ctx.po_unit_cost != null && (
          <div className="px-3 py-1.5 bg-gray-50 text-xs text-gray-500 border-t border-gray-200">
            PO price: ${ctx.po_unit_cost?.toFixed(2)}/unit
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Item: <span className="font-normal">{ctx.inventory_item_name ?? ctx.item_description}</span></p>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Decision:</p>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="price-choice"
              value="approve"
              checked={choice === 'approve'}
              onChange={() => setChoice('approve')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">
              Approve — update inventory cost to ${ctx.invoice_unit_price?.toFixed(2)}/unit
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="price-choice"
              value="reject"
              checked={choice === 'reject'}
              onChange={() => setChoice('reject')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">
              Reject — keep ${ctx.previous_unit_cost?.toFixed(2)}/unit; flag supplier for review
            </span>
          </label>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes {choice === 'reject' ? <span className="text-red-500">*</span> : '(optional)'}
        </label>
        <textarea
          value={notes}
          onChange={(e) => { setNotes(e.target.value); if (e.target.value.trim()) setNotesError('') }}
          rows={2}
          className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${notesError ? 'border-red-400' : 'border-gray-300'}`}
          placeholder={choice === 'reject' ? 'Required: explain why you are rejecting this price change…' : 'Optional notes…'}
        />
        {notesError && <p className="text-xs text-red-500 mt-1">{notesError}</p>}
      </div>

      <div className="flex gap-2 pt-1">
        {choice === 'approve' && (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            Approve Cost Update
          </button>
        )}
        {choice === 'reject' && (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            Reject Change
          </button>
        )}
        {!choice && (
          <button
            disabled
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md opacity-50 cursor-not-allowed"
          >
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
