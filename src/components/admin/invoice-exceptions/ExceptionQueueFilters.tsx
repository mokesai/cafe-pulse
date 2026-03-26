'use client'

import { useState, useEffect } from 'react'
import { Search, X, ChevronDown } from 'lucide-react'
import type { InvoiceExceptionType, InvoiceExceptionStatus } from '@/types/invoice-exceptions'

export interface ExceptionFilters {
  status: InvoiceExceptionStatus | 'all'
  types: InvoiceExceptionType[]
  supplier_id: string | null
  invoice_id: string | null
  start_date: string | null
  end_date: string | null
  search: string
  page: number
}

const STATUS_TABS: Array<{ key: ExceptionFilters['status']; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
]

const EXCEPTION_TYPE_LABELS: Record<InvoiceExceptionType, string> = {
  low_extraction_confidence: 'Low Confidence Scan',
  no_supplier_match: 'Unknown Supplier',
  no_po_match: 'No Purchase Order',
  no_item_match: 'Unmatched Item',
  price_variance: 'Price Change',
  quantity_variance: 'Quantity Mismatch',
  parse_error: 'Processing Error',
  duplicate_invoice: 'Duplicate Invoice',
}

const ALL_TYPES = Object.keys(EXCEPTION_TYPE_LABELS) as InvoiceExceptionType[]

interface Supplier {
  id: string
  name: string
}

interface Props {
  filters: ExceptionFilters
  onChange: (filters: ExceptionFilters) => void
  openCount?: number
}

export function ExceptionQueueFilters({ filters, onChange, openCount }: Props) {
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  useEffect(() => {
    fetch('/api/admin/suppliers?limit=200')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.data) setSuppliers(data.data) })
      .catch(() => {})
  }, [])

  const isFiltered =
    filters.status !== 'open' ||
    filters.types.length > 0 ||
    filters.supplier_id ||
    filters.start_date ||
    filters.end_date ||
    filters.search

  const clearFilters = () =>
    onChange({ status: 'open', types: [], supplier_id: null, invoice_id: null, start_date: null, end_date: null, search: '', page: 1 })

  const toggleType = (type: InvoiceExceptionType) => {
    const has = filters.types.includes(type)
    onChange({
      ...filters,
      types: has ? filters.types.filter(t => t !== type) : [...filters.types, type],
      page: 1,
    })
  }

  return (
    <div className="space-y-3">
      {/* Status tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => onChange({ ...filters, status: tab.key, page: 1 })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              filters.status === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.key === 'open' && openCount != null && openCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-4.5 px-1 rounded-full text-xs font-semibold bg-amber-500 text-white">
                {openCount > 99 ? '99+' : openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Type multiselect */}
        <div className="relative">
          <button
            onClick={() => setTypeDropdownOpen(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50"
          >
            <span>
              {filters.types.length === 0
                ? 'All types'
                : `${filters.types.length} type${filters.types.length > 1 ? 's' : ''}`}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>
          {typeDropdownOpen && (
            <div className="absolute z-20 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg py-1">
              {ALL_TYPES.map(type => (
                <label key={type} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.types.includes(type)}
                    onChange={() => toggleType(type)}
                    className="h-3.5 w-3.5 text-blue-600 border-gray-300 rounded"
                  />
                  <span className="text-sm text-gray-700">{EXCEPTION_TYPE_LABELS[type]}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Supplier dropdown */}
        <select
          value={filters.supplier_id ?? ''}
          onChange={(e) => onChange({ ...filters, supplier_id: e.target.value || null, page: 1 })}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50"
        >
          <option value="">All suppliers</option>
          {suppliers.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* Date range */}
        <input
          type="date"
          value={filters.start_date ?? ''}
          onChange={(e) => onChange({ ...filters, start_date: e.target.value || null, page: 1 })}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
          placeholder="From"
        />
        <input
          type="date"
          value={filters.end_date ?? ''}
          onChange={(e) => onChange({ ...filters, end_date: e.target.value || null, page: 1 })}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
          placeholder="To"
        />

        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value, page: 1 })}
            placeholder="Search invoice, supplier, message…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Clear filters */}
        {isFiltered && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <X className="w-3.5 h-3.5" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
