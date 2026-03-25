'use client'

import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import type { InvoiceException, NoItemMatchContext } from '@/types/invoice-exceptions'

interface Props {
  open: boolean
  exception: InvoiceException | null
  onClose: () => void
  onCreated: (inventoryItemId: string, itemName: string) => void
}

const UNIT_OPTIONS = [
  'each', 'lb', 'oz', 'kg', 'g', 'gallon', 'quart', 'pint', 'cup', 'fl oz',
  'liter', 'ml', 'case', 'pack', 'box', 'bag', 'can', 'bottle', 'jar', 'roll',
]

interface Category {
  id: string
  name: string
}

export function NewInventoryItemDrawer({ open, exception, onClose, onCreated }: Props) {
  const ctx = exception?.exception_context as unknown as NoItemMatchContext | undefined

  const [itemName, setItemName] = useState('')
  const [unit, setUnit] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [category, setCategory] = useState('')
  const [sku, setSku] = useState('')
  const [notes, setNotes] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const firstInputRef = useRef<HTMLInputElement>(null)

  // Pre-fill from context when drawer opens
  useEffect(() => {
    if (open && ctx) {
      setItemName(ctx.invoice_description ?? '')
      setUnitCost(ctx.invoice_unit_price != null ? String(ctx.invoice_unit_price) : '')
      setUnit('')
      setCategory('')
      setSku('')
      setNotes('')
      setErrors({})
      // Focus first input
      setTimeout(() => firstInputRef.current?.focus(), 100)
    }
  }, [open, ctx])

  // Load categories
  useEffect(() => {
    if (!open) return
    fetch('/api/admin/inventory/categories')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.data) setCategories(data.data)
      })
      .catch(() => {})
  }, [open])

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!itemName.trim()) errs.itemName = 'Item name is required'
    else if (itemName.length > 255) errs.itemName = 'Max 255 characters'
    if (!unit) errs.unit = 'Unit is required'
    const cost = parseFloat(unitCost)
    if (!unitCost || isNaN(cost) || cost <= 0) errs.unitCost = 'Valid unit cost > 0 is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    if (!exception) return

    setLoading(true)
    try {
      const res = await fetch(`/api/admin/invoice-exceptions/${exception.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: {
            type: 'create_and_match_item',
            item_name: itemName.trim(),
            unit,
            unit_cost: parseFloat(unitCost),
            category_id: category || undefined,
            sku: sku.trim() || undefined,
          },
          resolution_notes: notes || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to create item')
      }

      const data = await res.json()
      toast.success(`Item '${itemName.trim()}' created and matched. Alias saved for future invoices.`)
      onCreated(data.inventory_item_id ?? '', itemName.trim())
      onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create item')
    } finally {
      setLoading(false)
    }
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const supplierName = exception?.invoices?.suppliers?.name ?? 'Unknown supplier'
  const invoicePrice = ctx?.invoice_unit_price != null ? `$${ctx.invoice_unit_price.toFixed(2)}/unit` : ''

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="fixed inset-y-0 right-0 z-50 w-full max-w-[480px] bg-white shadow-xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 id="drawer-title" className="text-lg font-semibold text-gray-900">New Inventory Item</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Context banner */}
          {ctx && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <p className="font-medium">Creating from invoice line item:</p>
              <p className="text-blue-700 mt-0.5">
                &quot;{ctx.invoice_description}&quot; · {supplierName} {invoicePrice && `· ${invoicePrice}`}
              </p>
            </div>
          )}

          {/* Item Details */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Item Details</p>
            <div className="space-y-3">
              <div>
                <label htmlFor="drawer-item-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Item name <span className="text-red-500">*</span>
                </label>
                <input
                  id="drawer-item-name"
                  ref={firstInputRef}
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  maxLength={255}
                  className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.itemName ? 'border-red-400' : 'border-gray-300'}`}
                  aria-describedby={errors.itemName ? 'drawer-item-name-error' : undefined}
                />
                {errors.itemName && (
                  <p id="drawer-item-name-error" className="text-xs text-red-500 mt-1">{errors.itemName}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">Pre-filled from invoice description — edit as needed</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="drawer-unit" className="block text-sm font-medium text-gray-700 mb-1">
                    Unit <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="drawer-unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.unit ? 'border-red-400' : 'border-gray-300'}`}
                    aria-describedby={errors.unit ? 'drawer-unit-error' : undefined}
                  >
                    <option value="">Select unit…</option>
                    {UNIT_OPTIONS.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  {errors.unit && (
                    <p id="drawer-unit-error" className="text-xs text-red-500 mt-1">{errors.unit}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="drawer-unit-cost" className="block text-sm font-medium text-gray-700 mb-1">
                    Unit cost <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-sm text-gray-500">$</span>
                    <input
                      id="drawer-unit-cost"
                      type="number"
                      value={unitCost}
                      onChange={(e) => setUnitCost(e.target.value)}
                      min="0.01"
                      step="0.01"
                      className={`w-full pl-6 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.unitCost ? 'border-red-400' : 'border-gray-300'}`}
                      aria-describedby={errors.unitCost ? 'drawer-unit-cost-error' : undefined}
                    />
                  </div>
                  {errors.unitCost && (
                    <p id="drawer-unit-cost-error" className="text-xs text-red-500 mt-1">{errors.unitCost}</p>
                  )}
                  {ctx?.invoice_unit_price != null && (
                    <p className="text-xs text-gray-400 mt-1">From invoice</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="drawer-category" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    id="drawer-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">No category</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="drawer-sku" className="block text-sm font-medium text-gray-700 mb-1">SKU / Item Code</label>
                  <input
                    id="drawer-sku"
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional"
                  />
                </div>
              </div>

              {/* Supplier display (read-only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <p className="text-sm text-gray-600 px-3 py-2 bg-gray-50 border border-gray-200 rounded-md">
                  {supplierName} <span className="text-gray-400 text-xs">(from invoice)</span>
                </p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional notes…"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create & Match'}
          </button>
        </div>
      </div>
    </>
  )
}
