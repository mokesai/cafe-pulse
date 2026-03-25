'use client'

import { useState } from 'react'
import { Building2, Plus } from 'lucide-react'
import type { InvoiceException, NoSupplierMatchContext } from '@/types/invoice-exceptions'

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; supplier_id?: string; supplier_name?: string; contact_email?: string; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  loading?: boolean
}

export function NoSupplierMatchForm({ exception, onResolve, onDismiss, loading }: Props) {
  const ctx = exception.exception_context as unknown as NoSupplierMatchContext
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null)
  const [createMode, setCreateMode] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState(ctx.extracted_supplier_name ?? '')
  const [newSupplierEmail, setNewSupplierEmail] = useState('')
  const [notes, setNotes] = useState('')

  const suggestions = ctx.suggested_suppliers ?? []

  const handleSubmit = async () => {
    if (createMode) {
      if (!newSupplierName.trim()) return
      await onResolve({ type: 'create_supplier', supplier_name: newSupplierName, contact_email: newSupplierEmail || undefined, resolution_notes: notes || undefined })
    } else if (selectedSupplierId) {
      await onResolve({ type: 'select_supplier', supplier_id: selectedSupplierId, resolution_notes: notes || undefined })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
        <Building2 className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-orange-800">
          Extracted supplier: <strong>&quot;{ctx.extracted_supplier_name}&quot;</strong> — no match found in your supplier list.
        </div>
      </div>

      {suggestions.length > 0 && !createMode && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Suggested matches:</p>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="supplier-match"
                  value={s.id}
                  checked={selectedSupplierId === s.id}
                  onChange={() => setSelectedSupplierId(s.id)}
                />
                <span className="text-sm text-gray-700">
                  {s.name}{' '}
                  <span className="text-gray-400 text-xs">({Math.round(s.confidence * 100)}% match)</span>
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="supplier-match"
                value=""
                checked={selectedSupplierId === null && !createMode}
                onChange={() => setSelectedSupplierId(null)}
              />
              <span className="text-sm text-gray-500">None of these</span>
            </label>
          </div>
        </div>
      )}

      {!createMode && (
        <button
          onClick={() => { setCreateMode(true); setSelectedSupplierId(null) }}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          <Plus className="w-3.5 h-3.5" />
          Create new supplier &quot;{ctx.extracted_supplier_name}&quot;
        </button>
      )}

      {createMode && (
        <div className="space-y-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
          <p className="text-sm font-medium text-gray-700">New supplier details:</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Supplier name *</label>
            <input
              type="text"
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contact email (optional)</label>
            <input
              type="email"
              value={newSupplierEmail}
              onChange={(e) => setNewSupplierEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button onClick={() => setCreateMode(false)} className="text-xs text-gray-500 hover:underline">
            ← Back to suggestions
          </button>
        </div>
      )}

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
          disabled={(!selectedSupplierId && !createMode) || (createMode && !newSupplierName.trim()) || loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save & Continue
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
