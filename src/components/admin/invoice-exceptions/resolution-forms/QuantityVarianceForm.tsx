'use client'

import { useState } from 'react'
import { Scale } from 'lucide-react'
import type { InvoiceException, QuantityVarianceContext } from '@/types/invoice-exceptions'

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; accepted_quantity?: number; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  /** MOK-123 + MOK-137: surfaced for info-severity exceptions; resolves the
   *  exception as 'acknowledged' rather than 'resolved' or 'dismissed'. */
  onAcknowledge?: (notes?: string) => Promise<void>
  loading?: boolean
}

/**
 * MOK-137: pack-aware quantity-variance render.
 *
 * - Reads `price_mode`, `pack_size`, `invoice_quantity_raw` from the
 *   exception context (post-MOK-133 fields, optional for legacy exceptions).
 *   When per-pack, surfaces the "N packs × packSize = M units" derivation.
 * - Sign-aware label: invoice > PO is an over-shipment, invoice < PO is a
 *   short shipment. Pre-MOK-137 the radio label hard-coded "short shipment"
 *   even when the supplier over-shipped.
 * - Adds Acknowledge for info-severity exceptions (mirror of MOK-136 pattern
 *   in the price-variance form).
 */
export function QuantityVarianceForm({
  exception,
  onResolve,
  onDismiss,
  onAcknowledge,
  loading,
}: Props) {
  const ctx = exception.exception_context as unknown as QuantityVarianceContext
  const [choice, setChoice] = useState<'invoice' | 'po' | 'custom' | 'acknowledge' | null>(null)
  const [customQty, setCustomQty] = useState('')
  const [notes, setNotes] = useState('')

  const poQty = ctx.po_quantity ?? 0
  const invoiceQty = ctx.invoice_quantity ?? 0
  const diff = invoiceQty - poQty
  const variancePct = Math.abs(ctx.variance_pct ?? 0).toFixed(1)
  const isOverShipment = diff > 0
  const isShortShipment = diff < 0

  // Pack-mode metadata (MOK-133, optional)
  const isPerPack = ctx.price_mode === 'per_pack'
  const packSize = ctx.pack_size ?? 1
  const rawInvoiceQty = ctx.invoice_quantity_raw

  // Severity gates the Acknowledge action surface (MOK-123/MOK-137)
  const isInfoSeverity = exception.severity === 'info'
  const showAcknowledge = isInfoSeverity && !!onAcknowledge

  const getAcceptedQuantity = (): number => {
    if (choice === 'invoice') return invoiceQty
    if (choice === 'po') return poQty
    if (choice === 'custom') return parseFloat(customQty) || 0
    return 0
  }

  const handleSubmit = async () => {
    if (choice === 'acknowledge' && onAcknowledge) {
      await onAcknowledge(notes || undefined)
      return
    }
    const qty = getAcceptedQuantity()
    await onResolve({ type: 'confirm_quantity', accepted_quantity: qty, resolution_notes: notes || undefined })
  }

  const canSubmit =
    choice === 'invoice' ||
    choice === 'po' ||
    choice === 'acknowledge' ||
    (choice === 'custom' && parseFloat(customQty) > 0)

  // Sign-aware label for the "Accept invoice quantity" radio. MOK-137 fixed
  // the hardcoded "short shipment" suffix that mislabeled over-shipments.
  const acceptInvoiceLabel = (() => {
    const base = `Accept invoice quantity (${invoiceQty} units)`
    if (isOverShipment) return `${base} — over-shipment, supplier sent extra`
    if (isShortShipment) return `${base} — short shipment, supplier under-delivered`
    return base
  })()

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <Scale className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-800">
          Quantity variance — {variancePct}%{' '}
          {isInfoSeverity ? 'difference (informational only)' : 'difference exceeds threshold'}
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
              <td className="px-3 py-2 text-gray-700">{poQty} units</td>
              <td className="px-3 py-2 font-medium">{invoiceQty} units</td>
              <td className={`px-3 py-2 font-semibold ${isOverShipment ? 'text-green-600' : 'text-red-600'}`}>
                {diff > 0 ? '+' : ''}
                {diff}
              </td>
            </tr>
          </tbody>
        </table>
        {isPerPack && rawInvoiceQty != null && (
          <div className="px-3 py-1.5 bg-gray-50 text-xs text-gray-500 border-t border-gray-200">
            Invoice line: {rawInvoiceQty} pack{rawInvoiceQty === 1 ? '' : 's'} × {packSize} = {invoiceQty} units
          </div>
        )}
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
            <span className="text-sm text-gray-700">{acceptInvoiceLabel}</span>
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
            <span className="text-sm text-gray-700">Accept PO quantity ({poQty} units) — invoice is wrong</span>
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
          {showAcknowledge && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="qty-choice"
                value="acknowledge"
                checked={choice === 'acknowledge'}
                onChange={() => setChoice('acknowledge')}
                className="mt-0.5"
              />
              <span className="text-sm text-gray-700">
                Acknowledge — accept the variance, log it for supplier reporting, no PO change
              </span>
            </label>
          )}
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
          className={`px-4 py-2 text-white text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${
            choice === 'acknowledge'
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {choice === 'acknowledge' ? 'Acknowledge' : 'Confirm Quantity'}
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
