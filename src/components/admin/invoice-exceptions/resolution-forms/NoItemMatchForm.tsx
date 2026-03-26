'use client'

import { useState, useEffect, useRef } from 'react'
import { PackageX, Search, Plus } from 'lucide-react'
import type { InvoiceException, NoItemMatchContext } from '@/types/invoice-exceptions'

interface InventorySearchResult {
  id: string
  item_name: string
  unit_type: string
  unit_cost: number
}

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; inventory_item_id?: string; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  onCreateNewItem?: () => void
  loading?: boolean
}

export function NoItemMatchForm({ exception, onResolve, onDismiss, onCreateNewItem, loading }: Props) {
  const ctx = exception.exception_context as unknown as NoItemMatchContext
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedFromSearch, setSelectedFromSearch] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<InventorySearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [notes, setNotes] = useState('')
  const searchRef = useRef<HTMLDivElement>(null)

  const suggestions = ctx.best_fuzzy_matches ?? []
  const hasSuggestions = suggestions.length > 0

  // Dismiss click outside dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/inventory?search=${encodeURIComponent(searchQuery)}&limit=10`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.data ?? [])
          setShowDropdown(true)
        }
      } catch {
        // ignore
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const effectiveSelectedId = selectedItemId ?? selectedFromSearch

  const handleMatch = async () => {
    if (!effectiveSelectedId) return
    await onResolve({ type: 'match_item', inventory_item_id: effectiveSelectedId, resolution_notes: notes || undefined })
  }

  const handleSkip = async () => {
    await onResolve({ type: 'skip_item', resolution_notes: notes || 'Item skipped — no inventory match' })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
        <PackageX className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-orange-800">
          <p><strong>&quot;{ctx.invoice_description}&quot;</strong> could not be matched to inventory.</p>
          <p className="text-orange-600 mt-0.5">
            Qty: {ctx.invoice_quantity} · Unit price: ${ctx.invoice_unit_price?.toFixed(2)} · Total: ${ctx.invoice_line_total?.toFixed(2)}
          </p>
        </div>
      </div>

      {hasSuggestions && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Best matches found (below threshold):</p>
          <div className="space-y-2">
            {suggestions.map((match) => (
              <label key={match.inventory_item_id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="item-match"
                  value={match.inventory_item_id}
                  checked={selectedItemId === match.inventory_item_id}
                  onChange={() => { setSelectedItemId(match.inventory_item_id); setSelectedFromSearch(null) }}
                />
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-sm text-gray-700">{match.item_name}</span>
                  <div className="text-xs text-gray-400 flex gap-2">
                    <span>{Math.round(match.confidence * 100)}% match</span>
                    <span>${match.unit_cost?.toFixed(2)}/unit</span>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {!hasSuggestions && (
        <p className="text-sm text-gray-500 italic">No similar inventory items found.</p>
      )}

      {/* Search all inventory */}
      <div ref={searchRef} className="relative">
        <p className="text-sm font-medium text-gray-700 mb-1">Search all inventory items:</p>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
            placeholder="Search by name or SKU…"
            className="w-full pl-8 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {searching && <p className="text-xs text-gray-400 mt-1">Searching…</p>}
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-40 overflow-y-auto mt-1">
            {searchResults.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedFromSearch(item.id)
                  setSelectedItemId(null)
                  setSearchQuery(item.item_name)
                  setShowDropdown(false)
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex justify-between"
              >
                <span>{item.item_name}</span>
                <span className="text-gray-400">{item.unit_type} · ${item.unit_cost?.toFixed(2)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create new item */}
      {onCreateNewItem && (
        <button
          onClick={onCreateNewItem}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          <Plus className="w-3.5 h-3.5" />
          Create new inventory item &quot;{ctx.invoice_description}&quot;
        </button>
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

      <div className="flex gap-2 pt-1 flex-wrap">
        <button
          onClick={handleMatch}
          disabled={!effectiveSelectedId || loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Match & Continue
        </button>
        <button
          onClick={handleSkip}
          disabled={loading}
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50"
          title="Skip this item — don't update inventory"
        >
          Skip Item
        </button>
        <button
          onClick={() => onDismiss(notes || undefined)}
          disabled={loading}
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          Dismiss Exception
        </button>
      </div>
    </div>
  )
}
