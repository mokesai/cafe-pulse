'use client'

import { useState } from 'react'
import { X, Trash2, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import type { InvoiceException } from '@/types/invoice-exceptions'

interface Props {
  selected: InvoiceException[]
  onClear: () => void
  onBulkDismissed: (ids: string[]) => void
}

export function ExceptionBulkActions({ selected, onClear, onBulkDismissed }: Props) {
  const [loading, setLoading] = useState(false)
  const [confirmModal, setConfirmModal] = useState<'dismiss' | null>(null)
  const [notes, setNotes] = useState('')

  if (selected.length === 0) return null

  const handleBulkDismiss = async () => {
    setLoading(true)
    try {
      const ids = selected.map(e => e.id)
      const res = await fetch('/api/admin/invoice-exceptions/bulk-dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exception_ids: ids, resolution_notes: notes || undefined }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Bulk dismiss failed')
      }
      const data = await res.json()
      toast.success(`Dismissed ${data.dismissed_count} exception${data.dismissed_count !== 1 ? 's' : ''}`)
      onBulkDismissed(ids)
      onClear()
      setConfirmModal(null)
      setNotes('')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-full shadow-xl">
        <span className="text-sm font-medium">{selected.length} selected</span>
        <div className="w-px h-4 bg-gray-600" />
        <button
          onClick={() => setConfirmModal('dismiss')}
          className="flex items-center gap-1.5 text-sm hover:text-red-300 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Dismiss Selected
        </button>
        <div className="w-px h-4 bg-gray-600" />
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 text-sm hover:text-gray-300 transition-colors"
        >
          <X className="w-4 h-4" />
          Clear Selection
        </button>
      </div>

      {/* Confirm modal */}
      {confirmModal === 'dismiss' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Dismiss {selected.length} exception{selected.length !== 1 ? 's' : ''}?</h3>
            <p className="text-sm text-gray-500 mb-4">
              This will mark the selected exceptions as dismissed. No pipeline actions will be taken.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional reason for dismissal…"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setConfirmModal(null); setNotes('') }}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDismiss}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? 'Dismissing…' : 'Dismiss All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
