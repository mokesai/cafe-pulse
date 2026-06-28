'use client'

import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { CostCalculator } from './CostCalculator'

interface InventoryItem {
  id: string
  square_item_id: string
  item_name: string
  current_stock: number
  minimum_threshold: number
  reorder_point: number
  unit_cost: number
  unit_type: string
  pack_size?: number
  is_ingredient: boolean
  item_type?: 'ingredient' | 'prepackaged' | 'prepared' | 'supply'
  auto_decrement?: boolean
  supplier_id?: string
  location: string
  notes?: string
  package_label?: string | null
}

interface Supplier {
  id: string
  name: string
}

interface InventoryEditModalProps {
  item: InventoryItem | null
  suppliers: Supplier[]
  isOpen: boolean
  onClose: () => void
}

interface CostHistoryEntry {
  changed_at: string
  source: string
  previous_unit_cost: number | null
  new_unit_cost: number
  pack_size?: number | null
}

interface SquareSearchResult {
  variationId: string
  itemName: string
  variationName?: string
  sku?: string
  price?: number
}

const UNIT_TYPES = [
  { value: 'each', label: 'Each' },
  { value: 'lb', label: 'Pounds (lb)' },
  { value: 'oz', label: 'Ounces (oz)' },
  { value: 'gallon', label: 'Gallons' },
  { value: 'liter', label: 'Liters' },
  { value: 'ml', label: 'Milliliters (ml)' },
]

export default function InventoryEditModal({ item, suppliers, isOpen, onClose }: InventoryEditModalProps) {
  const [formData, setFormData] = useState<Partial<InventoryItem>>({})
  const [packPrice, setPackPrice] = useState<string>('0')
  const [costHistory, setCostHistory] = useState<CostHistoryEntry[]>([])
  const [squareResults, setSquareResults] = useState<SquareSearchResult[]>([])
  const [squareSearchLoading, setSquareSearchLoading] = useState(false)
  const [squareSearchError, setSquareSearchError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (item && isOpen) {
      const isPack = (item.pack_size || 1) > 1
      // Stored unit_cost is per-unit; derive pack cost when pack size > 1
      const initialPackPrice = isPack ? (item.unit_cost || 0) * (item.pack_size || 1) : (item.unit_cost || 0)
      const derivedUnitCost = item.unit_cost || 0
      setFormData({
        item_name: item.item_name,
        minimum_threshold: item.minimum_threshold,
        reorder_point: item.reorder_point,
        unit_cost: derivedUnitCost,
        unit_type: item.unit_type,
        pack_size: item.pack_size || 1,
        supplier_id: item.supplier_id || '',
        location: item.location,
        notes: item.notes || '',
        is_ingredient: item.is_ingredient,
        item_type: item.item_type || (item.is_ingredient ? 'ingredient' : 'prepackaged'),
        auto_decrement: item.auto_decrement ?? false,
        square_item_id: item.square_item_id || '',
        package_label: item.package_label ?? ''
      })
      setPackPrice(initialPackPrice.toString())
      loadCostHistory(item.id)
    }
  }, [item, isOpen])

  const loadCostHistory = async (itemId: string) => {
    try {
      const res = await fetch(`/api/admin/inventory/cost-history?id=${itemId}&limit=5`)
      const json = await res.json()
      if (json.success) setCostHistory((json.history || []) as CostHistoryEntry[])
    } catch (err) {
      console.error('Failed to load cost history', err)
    }
  }

  const updateItemMutation = useMutation({
    mutationFn: async (data: Partial<InventoryItem>) => {
      const response = await fetch(`/api/admin/inventory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item?.id,
          ...data
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update item')
      }

      return response.json()
    },
    onSuccess: () => {
      toast.success('Item updated successfully')
      queryClient.invalidateQueries({ queryKey: ['admin-inventory'] })
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update item')
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    if (!formData.item_name?.trim()) {
      toast.error('Item name is required')
      return
    }
    
    if (formData.minimum_threshold !== undefined && formData.minimum_threshold < 0) {
      toast.error('Minimum threshold cannot be negative')
      return
    }
    
    if (formData.reorder_point !== undefined && formData.minimum_threshold !== undefined && 
        formData.reorder_point < formData.minimum_threshold) {
      toast.error('Reorder point must be greater than or equal to minimum threshold')
      return
    }

    if (formData.unit_cost !== undefined && formData.unit_cost < 0) {
      toast.error('Unit cost cannot be negative')
      return
    }

    if (formData.pack_size !== undefined && formData.pack_size <= 0) {
      toast.error('Pack size must be at least 1')
      return
    }

    updateItemMutation.mutate(formData)
  }

  if (!isOpen || !item) return null

  const handleSquareIdChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      square_item_id: value.trim()
    }))
  }

  const handleSquareLookup = async () => {
    const keyword = (formData.item_name || '').trim() || (formData.square_item_id || '').trim() || item.item_name.trim()
    if (keyword.length < 2) {
      toast.error('Enter at least 2 characters in the Item Name or Square ID field first')
      return
    }

    setSquareSearchLoading(true)
    setSquareSearchError(null)
    try {
      const response = await fetch(`/api/admin/inventory/square-search?q=${encodeURIComponent(keyword)}`)
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to search Square catalog')
      }
      setSquareResults((data.results || []) as SquareSearchResult[])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Square catalog search failed'
      setSquareSearchError(message)
      setSquareResults([])
    } finally {
      setSquareSearchLoading(false)
    }
  }

  const handleSelectSquareResult = (result: SquareSearchResult) => {
    setFormData(prev => ({
      ...prev,
      square_item_id: result.variationId,
      item_name: prev.item_name || result.itemName
    }))
    setSquareResults([])
    toast.success('Linked Square catalog item')
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              Edit Inventory Item
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Item Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Item Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.item_name || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, item_name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Enter item name"
              required
            />
          </div>

          {/* Stock Thresholds */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Minimum Threshold
              </label>
              <input
                type="number"
                min="0"
                value={formData.minimum_threshold || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, minimum_threshold: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reorder Point
              </label>
              <input
                type="number"
                min="0"
                value={formData.reorder_point || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, reorder_point: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="0"
              />
            </div>
          </div>

          {/* Square item association */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Square Item ID
              </label>
              <button
                type="button"
                onClick={handleSquareLookup}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                disabled={squareSearchLoading}
              >
                {squareSearchLoading ? 'Searching…' : 'Lookup from Square'}
              </button>
            </div>
            <input
              type="text"
              value={formData.square_item_id || item.square_item_id || ''}
              onChange={(e) => handleSquareIdChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Optional – link to Square catalog item"
            />
            <p className="text-xs text-gray-500 mt-1">
              Use lookup to search your Square catalog by item name or variation.
            </p>
            {squareSearchError && (
              <p className="mt-1 text-sm text-red-600">{squareSearchError}</p>
            )}
            {squareResults.length > 0 && (
              <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/70 text-sm text-gray-900">
                {squareResults.map((result) => (
                  <button
                    key={result.variationId}
                    type="button"
                    onClick={() => handleSelectSquareResult(result)}
                    className="flex w-full items-center justify-between border-b border-indigo-100 px-4 py-2 text-left last:border-b-0 hover:bg-indigo-100"
                  >
                    <div>
                      <p className="font-medium">{result.itemName}</p>
                      <p className="text-xs text-gray-600">
                        Variation: {result.variationName}
                        {result.sku ? ` • SKU ${result.sku}` : ''}
                      </p>
                    </div>
                    {typeof result.price === 'number' && (
                      <span className="text-xs font-semibold text-gray-800">
                        ${result.price.toFixed(2)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cost & Units */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pack Size
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={formData.pack_size ?? ''}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10)
                  if (Number.isNaN(parsed)) {
                    setFormData(prev => ({ ...prev, pack_size: undefined }))
                    return
                  }
                  const newSize = Math.max(1, parsed)
                  const packPriceNum = Number(packPrice) || 0
                  const newUnit = newSize > 0 ? packPriceNum / newSize : (formData.unit_cost || 0)
                  setFormData(prev => ({
                    ...prev,
                    pack_size: newSize,
                    // MOK-139: 4dp precision matches the inventory_items.unit_cost
                    // column type (numeric(12,4)) and prevents pack-divided unit
                    // costs (e.g. $6.19 / 4 = $1.5475) from being silently rounded.
                    unit_cost: Number.isFinite(newUnit) ? Number(newUnit.toFixed(4)) : prev.unit_cost
                  }))
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="e.g., 24"
              />
              <p className="text-xs text-gray-500 mt-1">Units per supplier pack/case.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unit Type
              </label>
              <select
                value={formData.unit_type || 'each'}
                onChange={(e) => setFormData(prev => ({ ...prev, unit_type: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                {UNIT_TYPES.map(unit => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unit Cost ($ each)
              </label>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={formData.unit_cost ?? ''}
                onChange={(e) => {
                  const unitCost = parseFloat(e.target.value) || 0
                  const packSize = formData.pack_size || 1
                  setFormData(prev => ({ ...prev, unit_cost: unitCost }))
                  setPackPrice((unitCost * packSize).toFixed(4))
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="0.00"
              />
              <p className="text-xs text-gray-500 mt-1">Per-unit cost used in stock calculations.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pack Cost ($)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={packPrice}
                onChange={(e) => {
                  const val = e.target.value
                  const packCost = parseFloat(val) || 0
                  const packSize = formData.pack_size || 1
                  setPackPrice(val)
                  setFormData(prev => ({
                    ...prev,
                    // MOK-139: 4dp to match the column type. Pack price ÷ pack
                    // size for non-trivial pack sizes (e.g. 4) gives a non-2dp
                    // value that 2dp rounding loses.
                    unit_cost: packSize > 0 ? Number((packCost / packSize).toFixed(4)) : prev.unit_cost
                  }))
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="e.g., 19.76"
                disabled={(formData.pack_size || 1) <= 1}
              />
              <p className="text-xs text-gray-500 mt-1">Full pack/case price; auto-derives unit cost.</p>
            </div>
          </div>
          {/* Package label — MOK-170 discriminator */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Package Label
            </label>
            <input
              type="text"
              value={formData.package_label ?? ''}
              onChange={(e) => setFormData(prev => ({ ...prev, package_label: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Optional — e.g. Standalone 35-pack, From variety pack"
            />
            <p className="text-xs text-gray-500 mt-1">
              Distinguishes two products from the same supplier that share a Square item ID and pack size.
            </p>
          </div>

          {/* Supplier */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Supplier
            </label>
            <select
              value={formData.supplier_id || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, supplier_id: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Select supplier...</option>
              {suppliers.map(supplier => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Storage Location
            </label>
            <input
              type="text"
              value={formData.location || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g., Storage Room, Refrigerator, Display Case"
            />
          </div>

          {/* Classification */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Item Classification
              </label>
              <select
                value={formData.item_type || 'prepackaged'}
                onChange={(e) => {
                  const value = e.target.value as 'ingredient' | 'prepared' | 'prepackaged' | 'supply'
                  setFormData(prev => ({
                    ...prev,
                    item_type: value,
                    is_ingredient: value === 'ingredient',
                    auto_decrement: value === 'prepackaged' ? true : false
                  }))
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="prepackaged">Pre-packaged / Ready to sell</option>
                <option value="prepared">Prepared drink/food (manual deduction)</option>
                <option value="ingredient">Ingredient (used in recipes)</option>
                <option value="supply">Supply / Packaging</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="auto_decrement"
                checked={formData.auto_decrement || false}
                onChange={(e) => setFormData(prev => ({ ...prev, auto_decrement: e.target.checked }))}
                disabled={formData.item_type === 'ingredient' || formData.item_type === 'prepared'}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="auto_decrement" className="block text-sm text-gray-700">
                Auto sync stock from sales (for pre-packaged items)
              </label>
            </div>
          </div>

          {/* Pack calculator and cost history */}
          <div className="space-y-3">
            <div className="rounded-lg border p-3 bg-gray-50">
              <label className="block text-sm font-medium text-gray-700 mb-2">Pack → Unit Calculator</label>
              <label className="block text-xs font-medium text-gray-600 mb-1">Pack Cost ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={packPrice}
                onChange={(e) => {
                  const val = e.target.value
                  const packCost = parseFloat(val) || 0
                  const packSize = formData.pack_size || 1
                  setPackPrice(val)
                  setFormData(prev => ({
                    ...prev,
                    unit_cost: packSize > 0 ? packCost / packSize : prev.unit_cost
                  }))
                }}
                className="w-full rounded-md border px-2 py-1 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 mb-2"
                placeholder="e.g. 4.17"
              />
              <CostCalculator
                packSize={Number(formData.pack_size) || 1}
                packPrice={Number(packPrice) || 0}
                onUnitCost={(val) => {
                  const packSize = formData.pack_size || 1
                  const roundedUnit = Number(val.toFixed(2))
                  setFormData(prev => ({ ...prev, unit_cost: roundedUnit }))
                  setPackPrice((roundedUnit * packSize).toFixed(2))
                }}
              />
            </div>

            <div className="rounded-lg border p-3 bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-700">Recent Cost Changes</div>
                <button
                  type="button"
                  className="text-xs text-indigo-600 underline"
                  onClick={() => loadCostHistory(item.id)}
                >
                  Refresh
                </button>
              </div>
              {costHistory.length === 0 ? (
                <p className="text-xs text-gray-500">No history yet.</p>
              ) : (
                <div className="space-y-1">
                  {costHistory.map((h, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs text-gray-700">
                      <div>
                        {new Date(h.changed_at).toLocaleDateString()} • {h.source}
                        <div className="text-gray-500">
                          {h.previous_unit_cost ?? '—'} → {h.new_unit_cost} (pack {h.pack_size || 1})
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-indigo-600 underline"
                        onClick={async () => {
                          const res = await fetch('/api/admin/inventory/revert-cost', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ item_id: item.id, target_cost: h.new_unit_cost, note: 'Revert from history' })
                          })
                          const json = await res.json()
                          if (json.success) {
                            toast.success('Unit cost reverted')
                            setFormData(prev => ({ ...prev, unit_cost: h.new_unit_cost }))
                            loadCostHistory(item.id)
                            queryClient.invalidateQueries({ queryKey: ['admin-inventory'] })
                          } else {
                            toast.error(json.error || 'Failed to revert cost')
                          }
                        }}
                      >
                        Revert
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes
            </label>
            <textarea
              rows={3}
              value={formData.notes || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Additional notes about this item..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-6 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateItemMutation.isPending}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4 mr-2" />
              {updateItemMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
