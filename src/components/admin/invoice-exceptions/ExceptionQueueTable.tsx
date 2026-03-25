'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useRouter, useSearchParams } from 'next/navigation'
import type { InvoiceException } from '@/types/invoice-exceptions'
import { ExceptionQueueFilters, type ExceptionFilters } from './ExceptionQueueFilters'
import { ExceptionRow } from './ExceptionRow'
import { ExceptionBulkActions } from './ExceptionBulkActions'

function buildUrlParams(filters: ExceptionFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.status !== 'open') params.set('status', filters.status)
  if (filters.types.length) params.set('type', filters.types.join(','))
  if (filters.supplier_id) params.set('supplier_id', filters.supplier_id)
  if (filters.invoice_id) params.set('invoice_id', filters.invoice_id)
  if (filters.start_date) params.set('start_date', filters.start_date)
  if (filters.end_date) params.set('end_date', filters.end_date)
  if (filters.search) params.set('search', filters.search)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

function buildApiParams(filters: ExceptionFilters): URLSearchParams {
  const params = new URLSearchParams()
  params.set('status', filters.status)
  if (filters.types.length) params.set('type', filters.types.join(','))
  if (filters.supplier_id) params.set('supplier_id', filters.supplier_id)
  if (filters.invoice_id) params.set('invoice_id', filters.invoice_id)
  if (filters.start_date) params.set('start_date', filters.start_date)
  if (filters.end_date) params.set('end_date', filters.end_date)
  if (filters.search) params.set('search', filters.search)
  params.set('page', String(filters.page))
  params.set('limit', '20')
  return params
}

function parseFiltersFromSearch(searchParams: URLSearchParams): ExceptionFilters {
  return {
    status: (searchParams.get('status') as ExceptionFilters['status']) || 'open',
    types: searchParams.get('type')?.split(',').filter(Boolean) as ExceptionFilters['types'] || [],
    supplier_id: searchParams.get('supplier_id'),
    invoice_id: searchParams.get('invoice_id'),
    start_date: searchParams.get('start_date'),
    end_date: searchParams.get('end_date'),
    search: searchParams.get('search') || '',
    page: parseInt(searchParams.get('page') || '1'),
  }
}

export function ExceptionQueueTable() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [filters, setFilters] = useState<ExceptionFilters>(() => parseFiltersFromSearch(searchParams))
  const [exceptions, setExceptions] = useState<InvoiceException[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const fetchRef = useRef(0)

  const fetchExceptions = useCallback(async (f: ExceptionFilters) => {
    const fetchId = ++fetchRef.current
    setLoading(true)
    setError(null)
    try {
      const params = buildApiParams(f)
      const res = await fetch(`/api/admin/invoice-exceptions?${params}`)
      if (!res.ok) throw new Error('Failed to load exceptions')
      const data = await res.json()
      if (fetchId !== fetchRef.current) return // stale
      setExceptions(data.data ?? [])
      setOpenCount(data.open_count ?? 0)
      setPagination(data.pagination ?? { page: 1, limit: 20, total: 0, pages: 1 })
    } catch (err: unknown) {
      if (fetchId !== fetchRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load exceptions')
    } finally {
      if (fetchId === fetchRef.current) setLoading(false)
    }
  }, [])

  // Sync filters from URL on mount
  useEffect(() => {
    const f = parseFiltersFromSearch(searchParams)
    setFilters(f)
    fetchExceptions(f)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = (newFilters: ExceptionFilters) => {
    setFilters(newFilters)
    setSelected(new Set())
    // Sync to URL
    const params = buildUrlParams(newFilters)
    router.replace(`/admin/invoice-exceptions${params.size ? `?${params}` : ''}`, { scroll: false })
    fetchExceptions(newFilters)
  }

  const handleResolved = (id: string) => {
    setExceptions(prev => prev.filter(e => e.id !== id))
    setOpenCount(prev => Math.max(0, prev - 1))
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s })
    toast.success('Exception resolved ✅')
    // Check if queue is now empty
    if (exceptions.length === 1) {
      toast.success('✅ All caught up!', { duration: 3000 })
    }
  }

  const handleDismissed = (id: string) => {
    setExceptions(prev => prev.filter(e => e.id !== id))
    if (filters.status === 'open') {
      setOpenCount(prev => Math.max(0, prev - 1))
    }
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s })
    toast.success('Exception dismissed')
  }

  const handleBulkDismissed = (ids: string[]) => {
    setExceptions(prev => prev.filter(e => !ids.includes(e.id)))
    setOpenCount(prev => Math.max(0, prev - ids.length))
    setSelected(new Set())
  }

  const handleSelect = (id: string, checked: boolean) => {
    setSelected(prev => {
      const s = new Set(prev)
      if (checked) s.add(id)
      else s.delete(id)
      return s
    })
  }

  const selectedExceptions = exceptions.filter(e => selected.has(e.id))

  const isFiltered =
    filters.status !== 'open' ||
    filters.types.length > 0 ||
    filters.supplier_id ||
    filters.start_date ||
    filters.end_date ||
    filters.search

  return (
    <div className="space-y-4">
      <ExceptionQueueFilters filters={filters} onChange={handleFilterChange} openCount={openCount} />

      {/* Header row with count + refresh */}
      <div className="flex items-center justify-between">
        {!loading && !error && (
          <p className="text-sm text-gray-500">
            {pagination.total} exception{pagination.total !== 1 ? 's' : ''}
            {filters.status === 'open' && openCount > 0 && ` (${openCount} open)`}
          </p>
        )}
        <button
          onClick={() => fetchExceptions(filters)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 ml-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="space-y-3" aria-label="Loading exceptions…">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-16 bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">⚠️ {error}</p>
          <button
            onClick={() => fetchExceptions(filters)}
            className="text-sm text-red-600 hover:underline font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && exceptions.length === 0 && (
        <div className="text-center py-16">
          {filters.status === 'open' && !isFiltered ? (
            <>
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-900">All caught up!</h3>
              <p className="text-gray-500 text-sm mt-1">No open exceptions.</p>
              <button
                onClick={() => handleFilterChange({ ...filters, status: 'resolved' })}
                className="mt-4 text-sm text-blue-600 hover:underline"
              >
                View Resolved Exceptions
              </button>
            </>
          ) : (
            <>
              <p className="text-gray-500 text-sm">🔍 No exceptions match your filters.</p>
              <button
                onClick={() => handleFilterChange({ status: 'open', types: [], supplier_id: null, invoice_id: null, start_date: null, end_date: null, search: '', page: 1 })}
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}

      {/* Exception rows */}
      {!loading && !error && exceptions.length > 0 && (
        <div className="space-y-2">
          {exceptions.map(exc => (
            <ExceptionRow
              key={exc.id}
              exception={exc}
              selected={selected.has(exc.id)}
              onSelect={handleSelect}
              onResolved={handleResolved}
              onDismissed={handleDismissed}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && pagination.pages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => handleFilterChange({ ...filters, page: filters.page - 1 })}
            disabled={filters.page <= 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {filters.page} of {pagination.pages}
          </span>
          <button
            onClick={() => handleFilterChange({ ...filters, page: filters.page + 1 })}
            disabled={filters.page >= pagination.pages}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      <ExceptionBulkActions
        selected={selectedExceptions}
        onClear={() => setSelected(new Set())}
        onBulkDismissed={handleBulkDismissed}
      />
    </div>
  )
}
