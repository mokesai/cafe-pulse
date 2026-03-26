'use client'

import { useState, useEffect } from 'react'
import { FileX, Search } from 'lucide-react'
import type { InvoiceException, NoPOMatchContext } from '@/types/invoice-exceptions'

interface PurchaseOrder {
  id: string
  order_number: string
  order_date: string
  total_amount: number
  status: string
  supplier_name?: string
}

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; purchase_order_id?: string; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  loading?: boolean
}

export function NoPOMatchForm({ exception, onResolve, onDismiss, loading }: Props) {
  const ctx = exception.exception_context as unknown as NoPOMatchContext
  const [choice, setChoice] = useState<'without_po' | 'link_po' | null>(null)
  const [poSearch, setPOSearch] = useState('')
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null)
  const [selectedPONumber, setSelectedPONumber] = useState('')
  const [poResults, setPOResults] = useState<PurchaseOrder[]>([])
  const [poSearching, setPOSearching] = useState(false)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (choice !== 'link_po' || poSearch.length < 2) {
      setPOResults([])
      return
    }
    const timer = setTimeout(async () => {
      setPOSearching(true)
      try {
        const res = await fetch(`/api/admin/purchase-orders?search=${encodeURIComponent(poSearch)}&limit=10`)
        if (res.ok) {
          const data = await res.json()
          setPOResults(data.data ?? [])
        }
      } catch {
        // ignore
      } finally {
        setPOSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [poSearch, choice])

  const handleSubmit = async () => {
    if (choice === 'without_po') {
      await onResolve({ type: 'confirm_without_po', resolution_notes: notes || undefined })
    } else if (choice === 'link_po' && selectedPOId) {
      await onResolve({ type: 'link_po', purchase_order_id: selectedPOId, resolution_notes: notes || undefined })
    }
  }

  const invoiceTotalFormatted = ctx.invoice_total != null
    ? `$${ctx.invoice_total.toFixed(2)}`
    : 'N/A'

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <FileX className="w-5 h-5 text-slate-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-slate-700">
          <p>Invoice total: <strong>{invoiceTotalFormatted}</strong> · Supplier: <strong>{ctx.supplier_name}</strong></p>
          <p className="text-slate-500 mt-0.5">
            No purchase orders found matching this supplier within {ctx.search_window_days ?? 30} days.
          </p>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Options:</p>
        <div className="space-y-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="po-choice"
              value="without_po"
              checked={choice === 'without_po'}
              onChange={() => setChoice('without_po')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">This invoice doesn&apos;t have a PO — confirm without one</span>
          </label>

          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="po-choice"
                value="link_po"
                checked={choice === 'link_po'}
                onChange={() => setChoice('link_po')}
                className="mt-0.5"
              />
              <span className="text-sm text-gray-700">Link to an existing PO</span>
            </label>

            {choice === 'link_po' && (
              <div className="mt-2 ml-5 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={poSearch}
                    onChange={(e) => setPOSearch(e.target.value)}
                    placeholder="Search purchase orders…"
                    className="w-full pl-8 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {poSearching && <p className="text-xs text-gray-500">Searching…</p>}
                {poResults.length > 0 && (
                  <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-40 overflow-y-auto">
                    {poResults.map((po) => (
                      <button
                        key={po.id}
                        onClick={() => { setSelectedPOId(po.id); setSelectedPONumber(po.order_number); setPOResults([]) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex justify-between"
                      >
                        <span className="font-medium">{po.order_number}</span>
                        <span className="text-gray-500">${po.total_amount?.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedPOId && (
                  <p className="text-sm text-green-600 font-medium">Selected: {selectedPONumber}</p>
                )}
              </div>
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
        {choice === 'without_po' && (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            Confirm Without PO
          </button>
        )}
        {choice === 'link_po' && (
          <button
            onClick={handleSubmit}
            disabled={!selectedPOId || loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Link PO & Continue
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
