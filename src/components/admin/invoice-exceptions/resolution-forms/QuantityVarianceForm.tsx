'use client'

import { useState } from 'react'
import { Scale } from 'lucide-react'
import type { InvoiceException, QuantityVarianceContext } from '@/types/invoice-exceptions'

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; accepted_quantity?: number; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  loading?: boolean
}

export function QuantityVarianceForm({ exception, onResolve, onDismiss, loading }: Props) {
  const ctx = exception.exception_context as unknown as QuantityVarianceContext
  const [choice, setChoice] = useState<'invoice' | 'po' | 'custom' | null>(null)
  const [customQty, setCustomQty] = useState('')
  const [notes, setNotes] = useState('')

  const diff = (ctx.invoice_quantity ?? 0) - (ctx.po_quantity ?? 0)
  const variancePct = Math.abs(ctx.variance_pct ?? 0).toFixed(1)

  const getAcceptedQuantity = (): number => {
    if (choice === 'invoice') return ctx.invoice_quantity
    if (choice === 'po') return ctx.po_quantity
    if (choice === 'custom') return parseFloat(customQty) || 0
    return 0
  }

  const handleSubmit = async () => {
    const qty = getAcceptedQuantity()
    await onResolve({ type: 'confirm_quantity', accepted_quantity: qty, resolution_notes: notes || undefined })
  }

  const canSubmit = choice === 'invoice' || choice === 'po' || (choice === 'custom' && parseFloat(customQty) > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <Scale className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-800">
          Quantity variance — {variancePct}% difference exceeds threshold
        </div>
      </div>

      {/* Quantity comparison table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600">PO quantity</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Invoice quantity</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Diff</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-3 py-2 text-gray-700">{ctx.po_quantity} units</td>
              <td className="px-3 py-2 font-medium">{ctx.invoice_quantity} units</td>
              <td className={`px-3 py-2 font-semibold ${diff < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {diff > 0 ? '+' : ''}{diff}
              </td>
            </tr>
          </tbody>
        </table>
        {ctx.purchase_order_number && (
          <div className="px-3 py-1.5 bg-gray-50 text-xs text-gray-500 border-t border-gray-200">
            PO #{ctx.purchase_order_number}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Resolution:</p>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="qty-choice"
              value="invoice"
              checked={choice === 'invoice'}
              onChange={() => setChoice('invoice')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">Accept invoice quantity ({ctx.invoice_quantity} units) — short shipment</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="qty-choice"
              value="po"
              checked={choice === 'po'}
              onChange={() => setChoice('po')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">Accept PO quantity ({ctx.po_quantity} units) — invoice is wrong</span>
          </label>
          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="qty-choice"
                value="custom"
                checked={choice === 'custom'}
                onChange={() => setChoice('custom')}
                className="mt-0.5"
              />
              <span className="text-sm text-gray-700">Accept different quantity:</span>
            </label>
            {choice === 'custom' && (
              <input
                type="number"
                value={customQty}
                onChange={(e) => setCustomQty(e.target.value)}
                min="0"
                step="1"
                className="mt-1 ml-5 w-24 border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Units"
              />
            )}
          </div>
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
          disabled={!canSubmit || loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Confirm Quantity
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
