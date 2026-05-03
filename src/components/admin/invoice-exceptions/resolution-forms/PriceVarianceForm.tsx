'use client'

import { useEffect, useState } from 'react'
import { Search, TrendingUp, TrendingDown } from 'lucide-react'
import type { InvoiceException, PriceVarianceContext } from '@/types/invoice-exceptions'

interface InventorySearchHit {
  id: string
  item_name: string
  unit_cost: number | null
  pack_size: number | null
}

interface Props {
  exception: InvoiceException
  onResolve: (action: { type: string; resolution_notes?: string }) => Promise<void>
  onDismiss: (notes?: string) => Promise<void>
  /** MOK-123 + MOK-136: surfaced for info-severity exceptions; resolves the
   *  exception as 'acknowledged' rather than 'resolved' or 'dismissed'. */
  onAcknowledge?: (notes?: string) => Promise<void>
  loading?: boolean
}

/**
 * MOK-136: pack-aware render. After MOK-133 stage 4 emits price_mode,
 * comparator_cost, effective_unit_price, and pack_size on the exception
 * context. This form uses those when present so the pack vs unit anchor is
 * consistent across Previous / Invoice / Variance / Approve label.
 *
 * Falls back to the legacy per-unit fields for exceptions written before
 * MOK-133 added pack mode.
 */
export function PriceVarianceForm({
  exception,
  onResolve,
  onDismiss,
  onAcknowledge,
  loading,
}: Props) {
  const ctx = exception.exception_context as unknown as PriceVarianceContext
  const [choice, setChoice] = useState<
    'approve' | 'reject' | 'acknowledge' | 'rematch' | null
  >(null)
  const [notes, setNotes] = useState('')
  const [notesError, setNotesError] = useState('')

  // ── MOK-135: re-match UI state ────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<InventorySearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [rematchSelectedId, setRematchSelectedId] = useState<string | null>(null)
  // MOK-144: pack-pair siblings of the currently-matched row, fetched on
  // rematch open. Pre-MOK-144 the operator had to guess the sibling's
  // item_name (e.g. "Croissant 3oz 4pk" when the matched row was
  // "Butter Croissant"); the panel now surfaces siblings automatically.
  const [packPairSiblings, setPackPairSiblings] = useState<InventorySearchHit[]>([])

  useEffect(() => {
    if (choice !== 'rematch' || !ctx.inventory_item_id) {
      setPackPairSiblings([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/admin/inventory?siblings_of=${encodeURIComponent(ctx.inventory_item_id!)}&limit=10`,
        )
        if (cancelled || !res.ok) return
        const data = await res.json()
        setPackPairSiblings((data.data ?? data.items ?? []) as InventorySearchHit[])
      } catch {
        // non-fatal — siblings panel just stays empty
      }
    })()
    return () => {
      cancelled = true
    }
  }, [choice, ctx.inventory_item_id])

  useEffect(() => {
    if (choice !== 'rematch' || searchQuery.length < 2) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `/api/admin/inventory?search=${encodeURIComponent(searchQuery)}&limit=10`,
        )
        if (res.ok) {
          const data = await res.json()
          setSearchResults((data.data ?? data.items ?? []) as InventorySearchHit[])
        }
      } catch {
        // ignore — empty results UI is sufficient feedback
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [choice, searchQuery])

  // ── Resolve render anchors (MOK-136) ───────────────────────────────────────
  const isPerPack = ctx.price_mode === 'per_pack'
  const packSize = ctx.pack_size ?? 1
  const unitLabel = isPerPack ? '/pack' : '/unit'

  // Previous and Invoice anchored to the same mode. If pack mode is set, use
  // the pack price (comparator_cost) and the raw invoice unit_price (which
  // is the pack price for per-pack invoices). Otherwise fall back to the
  // legacy per-unit fields.
  const previousAnchored = isPerPack
    ? (ctx.comparator_cost ?? (ctx.previous_unit_cost ?? 0) * packSize)
    : (ctx.previous_unit_cost ?? 0)
  const invoiceAnchored = ctx.invoice_unit_price ?? 0

  // The per-individual price that would actually be written to inventory if
  // Approve is chosen. In per-pack mode this is invoice_unit_price ÷ pack_size;
  // in per-unit mode it's just invoice_unit_price.
  const newUnitCost = isPerPack
    ? (ctx.effective_unit_price ?? invoiceAnchored / Math.max(1, packSize))
    : invoiceAnchored

  const isIncrease = (ctx.variance_pct ?? 0) > 0
  const variancePct = Math.abs(ctx.variance_pct ?? 0).toFixed(1)
  // Variance dollar diff uses the SAME anchor as Previous / Invoice — no more
  // cross-unit subtraction (the old code did invoice_unit_price - previous_unit_cost
  // which is units-incoherent in pack mode).
  const priceDiff = invoiceAnchored - previousAnchored

  // Severity gates the Acknowledge action surface.
  const isInfoSeverity = exception.severity === 'info'
  const showAcknowledge = isInfoSeverity && !!onAcknowledge

  const handleSubmit = async () => {
    if (choice === 'reject' && !notes.trim()) {
      setNotesError('Notes are required when rejecting a price change.')
      return
    }
    if (choice === 'rematch' && !rematchSelectedId) {
      setNotesError('Pick an inventory item to re-match to.')
      return
    }
    setNotesError('')

    if (choice === 'approve') {
      await onResolve({ type: 'approve_cost_update', resolution_notes: notes || undefined })
    } else if (choice === 'reject') {
      await onResolve({ type: 'reject_cost_update', resolution_notes: notes })
    } else if (choice === 'acknowledge' && onAcknowledge) {
      await onAcknowledge(notes || undefined)
    } else if (choice === 'rematch' && rematchSelectedId) {
      await onResolve({
        type: 'match_item',
        // Cast through unknown — the action prop signature is permissive on
        // extra keys; the resolve route's match_item handler reads
        // inventory_item_id off the action.
        ...({ inventory_item_id: rematchSelectedId } as unknown as Record<string, never>),
        resolution_notes: notes || 'Re-matched to a different inventory item',
      })
    }
  }

  const formatPrice = (n: number) => `$${n.toFixed(2)}${unitLabel}`
  const formatDiff = (n: number) =>
    `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`

  return (
    <div className="space-y-4">
      <div
        className={`flex items-start gap-3 p-3 rounded-lg border ${
          isIncrease ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
        }`}
      >
        {isIncrease ? (
          <TrendingUp className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
        ) : (
          <TrendingDown className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
        )}
        <div className={`text-sm ${isIncrease ? 'text-red-800' : 'text-green-800'}`}>
          {isIncrease
            ? `⬆️ Price increased ${variancePct}% — ${
                isInfoSeverity
                  ? `below your ${ctx.threshold_pct ?? 10}% threshold (informational only)`
                  : `above your ${ctx.threshold_pct ?? 10}% threshold`
              }`
            : `⬇️ Price decreased ${variancePct}% — this may be a deal or data entry error`}
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
              <td className="px-3 py-2 text-gray-700">{formatPrice(previousAnchored)}</td>
              <td className="px-3 py-2 font-medium">{formatPrice(invoiceAnchored)}</td>
              <td
                className={`px-3 py-2 font-semibold ${
                  isIncrease ? 'text-red-600' : 'text-green-600'
                }`}
              >
                {formatDiff(priceDiff)} ({isIncrease ? '+' : '-'}
                {variancePct}%)
              </td>
            </tr>
          </tbody>
        </table>
        {isPerPack && (
          <div className="px-3 py-1.5 bg-gray-50 text-xs text-gray-500 border-t border-gray-200">
            Per individual unit:{' '}
            ${(ctx.previous_unit_cost ?? 0).toFixed(2)} →{' '}
            ${newUnitCost.toFixed(4)} (pack of {packSize})
          </div>
        )}
        {ctx.po_unit_cost != null && (
          <div className="px-3 py-1.5 bg-gray-50 text-xs text-gray-500 border-t border-gray-200">
            PO price: ${ctx.po_unit_cost?.toFixed(2)}/unit
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">
          Item:{' '}
          <span className="font-normal">
            {ctx.inventory_item_name ?? ctx.item_description}
          </span>
        </p>
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
              Approve — update inventory cost to ${newUnitCost.toFixed(4)}/unit
              {isPerPack && (
                <>
                  {' '}
                  <span className="text-gray-500">
                    (from invoice ${invoiceAnchored.toFixed(2)}/pack ÷ {packSize})
                  </span>
                </>
              )}
            </span>
          </label>
          {showAcknowledge && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="price-choice"
                value="acknowledge"
                checked={choice === 'acknowledge'}
                onChange={() => setChoice('acknowledge')}
                className="mt-0.5"
              />
              <span className="text-sm text-gray-700">
                Acknowledge — accept the new price, log it for supplier reporting,
                and update inventory cost to ${newUnitCost.toFixed(4)}/unit
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="price-choice"
              value="rematch"
              checked={choice === 'rematch'}
              onChange={() => setChoice('rematch')}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">
              Match to a different inventory item — pipeline picked the wrong row
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
              Reject — keep ${(ctx.previous_unit_cost ?? 0).toFixed(2)}/unit
              {isPerPack && (
                <>
                  {' '}
                  <span className="text-gray-500">
                    (${previousAnchored.toFixed(2)}/pack)
                  </span>
                </>
              )}
              ; flag supplier for review
            </span>
          </label>
        </div>
      </div>

      {/* MOK-135: re-match search/results, only when 'rematch' is selected */}
      {choice === 'rematch' && (
        <div className="space-y-2">
          {/* MOK-144: pack-pair siblings, surfaced automatically. Pack pairs
              share square_item_id but not item_name (e.g. "Butter Croissant"
              pairs with "Croissant 3oz 4pk"), so the typed search can miss
              them. Pinned at the top so the operator picks the sibling
              without guessing its name. */}
          {packPairSiblings.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">
                Pack-pair siblings:
              </p>
              <div className="border border-amber-200 bg-amber-50 rounded-md divide-y divide-amber-100">
                {packPairSiblings.map((item) => {
                  const packDisplay =
                    item.pack_size && item.pack_size > 1 ? ` · pack of ${item.pack_size}` : ''
                  return (
                    <label
                      key={item.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-amber-100 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="rematch-target"
                        value={item.id}
                        checked={rematchSelectedId === item.id}
                        onChange={() => setRematchSelectedId(item.id)}
                      />
                      <div className="flex-1 flex items-center justify-between">
                        <span className="text-sm text-gray-700">{item.item_name}</span>
                        <span className="text-xs text-gray-500">
                          ${(item.unit_cost ?? 0).toFixed(2)}/unit
                          {packDisplay}
                        </span>
                      </div>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-gray-500">
                Rows sharing the matched item&apos;s Square catalog ID — same product, different pack size.
              </p>
            </div>
          )}

          <p className="text-sm font-medium text-gray-700">Search inventory:</p>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type to search inventory items…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {searching && (
            <p className="text-xs text-gray-500">Searching…</p>
          )}
          {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
            <p className="text-xs text-gray-500 italic">No matches.</p>
          )}
          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
              {searchResults.map((item) => {
                const packDisplay =
                  item.pack_size && item.pack_size > 1 ? ` · pack of ${item.pack_size}` : ''
                return (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="rematch-target"
                      value={item.id}
                      checked={rematchSelectedId === item.id}
                      onChange={() => setRematchSelectedId(item.id)}
                    />
                    <div className="flex-1 flex items-center justify-between">
                      <span className="text-sm text-gray-700">{item.item_name}</span>
                      <span className="text-xs text-gray-400">
                        ${(item.unit_cost ?? 0).toFixed(2)}/unit
                        {packDisplay}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
          <p className="text-xs text-gray-500">
            Re-matching writes a manual supplier alias so the next invoice from this
            supplier with the same description auto-matches the chosen item.
          </p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes{' '}
          {choice === 'reject' ? (
            <span className="text-red-500">*</span>
          ) : (
            '(optional)'
          )}
        </label>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            if (e.target.value.trim()) setNotesError('')
          }}
          rows={2}
          className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            notesError ? 'border-red-400' : 'border-gray-300'
          }`}
          placeholder={
            choice === 'reject'
              ? 'Required: explain why you are rejecting this price change…'
              : 'Optional notes…'
          }
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
        {choice === 'acknowledge' && (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            Acknowledge
          </button>
        )}
        {choice === 'rematch' && (
          <button
            onClick={handleSubmit}
            disabled={loading || !rematchSelectedId}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            Re-match Item
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
