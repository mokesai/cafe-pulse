'use client'

import { useState } from 'react'
import {
  ScanLine, Building2, FileX, PackageX, TrendingUp, TrendingDown,
  Scale, AlertCircle, Copy, ChevronDown, ChevronUp, MoreHorizontal
} from 'lucide-react'
import type { InvoiceException, InvoiceExceptionType } from '@/types/invoice-exceptions'
import { LowExtractionConfidenceForm } from './resolution-forms/LowExtractionConfidenceForm'
import { NoSupplierMatchForm } from './resolution-forms/NoSupplierMatchForm'
import { NoPOMatchForm } from './resolution-forms/NoPOMatchForm'
import { NoItemMatchForm } from './resolution-forms/NoItemMatchForm'
import { PriceVarianceForm } from './resolution-forms/PriceVarianceForm'
import { QuantityVarianceForm } from './resolution-forms/QuantityVarianceForm'
import { ParseErrorForm } from './resolution-forms/ParseErrorForm'
import { DuplicateInvoiceForm } from './resolution-forms/DuplicateInvoiceForm'
import { NewInventoryItemDrawer } from './NewInventoryItemDrawer'

interface ExceptionTypeConfig {
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  borderColor: string
  bgColor: string
}

const TYPE_CONFIG: Record<InvoiceExceptionType, ExceptionTypeConfig> = {
  low_extraction_confidence: {
    label: 'Low Confidence Scan',
    icon: ScanLine,
    color: 'text-amber-700',
    borderColor: 'border-amber-400',
    bgColor: 'bg-amber-50',
  },
  no_supplier_match: {
    label: 'Unknown Supplier',
    icon: Building2,
    color: 'text-orange-700',
    borderColor: 'border-orange-400',
    bgColor: 'bg-orange-50',
  },
  no_po_match: {
    label: 'No Purchase Order',
    icon: FileX,
    color: 'text-slate-700',
    borderColor: 'border-slate-400',
    bgColor: 'bg-slate-50',
  },
  no_item_match: {
    label: 'Unmatched Item',
    icon: PackageX,
    color: 'text-orange-700',
    borderColor: 'border-orange-400',
    bgColor: 'bg-orange-50',
  },
  price_variance: {
    label: 'Price Change',
    icon: TrendingUp, // overridden in render based on direction
    color: 'text-red-700',
    borderColor: 'border-red-400',
    bgColor: 'bg-red-50',
  },
  quantity_variance: {
    label: 'Quantity Mismatch',
    icon: Scale,
    color: 'text-amber-700',
    borderColor: 'border-amber-400',
    bgColor: 'bg-amber-50',
  },
  parse_error: {
    label: 'Processing Error',
    icon: AlertCircle,
    color: 'text-red-700',
    borderColor: 'border-red-400',
    bgColor: 'bg-red-50',
  },
  duplicate_invoice: {
    label: 'Duplicate Invoice',
    icon: Copy,
    color: 'text-purple-700',
    borderColor: 'border-purple-400',
    bgColor: 'bg-purple-50',
  },
}

interface Props {
  exception: InvoiceException
  selected: boolean
  onSelect: (id: string, checked: boolean) => void
  onResolved: (id: string) => void
  onDismissed: (id: string) => void
}

export function ExceptionRow({ exception, selected, onSelect, onResolved, onDismissed }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const config = TYPE_CONFIG[exception.exception_type]
  if (!config) return null

  // For price_variance, pick icon by direction
  let TypeIcon = config.icon
  if (exception.exception_type === 'price_variance') {
    const ctx = exception.exception_context as { variance_pct?: number }
    TypeIcon = (ctx.variance_pct ?? 0) >= 0 ? TrendingUp : TrendingDown
  }

  const supplierName = exception.invoices?.suppliers?.name ?? '—'
  const invoiceNumber = exception.invoices?.invoice_number ?? '—'
  const relativeTime = getRelativeTime(exception.created_at)

  const handleResolve = async (action: Record<string, unknown>) => {
    setLoading(true)
    try {
      const notes = action.resolution_notes
      const actionPayload = { ...action }
      delete actionPayload.resolution_notes
      const res = await fetch(`/api/admin/invoice-exceptions/${exception.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionPayload, resolution_notes: notes }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to resolve')
      }
      onResolved(exception.id)
    } catch (err: unknown) {
      console.error('Resolve failed:', err)
      // Re-throw to let form handle toast
    } finally {
      setLoading(false)
    }
  }

  const handleDismiss = async (notes?: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/invoice-exceptions/${exception.id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_notes: notes }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to dismiss')
      }
      onDismissed(exception.id)
    } catch (err: unknown) {
      console.error('Dismiss failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const isResolved = exception.status !== 'open'

  return (
    <>
      <div
        className={`bg-white border rounded-lg transition-shadow ${expanded ? `border-l-4 ${config.borderColor} shadow-md` : 'border-gray-200 hover:shadow-sm'} ${isResolved ? 'opacity-60' : ''}`}
        aria-expanded={expanded}
      >
        {/* Collapsed row */}
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(exception.id, e.target.checked)}
            className="h-4 w-4 text-blue-600 border-gray-300 rounded flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select exception`}
          />

          {/* Type badge */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${config.bgColor} ${config.color} flex-shrink-0`}>
            <TypeIcon className="w-3.5 h-3.5" />
            <span>{config.label}</span>
          </div>

          {/* Summary */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{exception.exception_message}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Invoice #{invoiceNumber}
              {exception.invoice_items?.item_description && (
                <span> · {exception.invoice_items.item_description}</span>
              )}
            </p>
          </div>

          {/* Supplier */}
          <span className="text-sm text-gray-500 hidden sm:block flex-shrink-0">{supplierName}</span>

          {/* Date */}
          <span className="text-xs text-gray-400 flex-shrink-0">{relativeTime}</span>

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1 text-gray-400 hover:text-gray-600 rounded flex-shrink-0"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Expanded inline form */}
        {expanded && (
          <div className="border-t border-gray-100 px-6 py-4 bg-gray-50 rounded-b-lg">
            <div className="text-xs text-gray-500 mb-3">
              Invoice #{invoiceNumber} · {supplierName}
            </div>
            {renderForm(exception, handleResolve, handleDismiss, loading, () => setDrawerOpen(true))}
          </div>
        )}
      </div>

      <NewInventoryItemDrawer
        open={drawerOpen}
        exception={exception}
        onClose={() => setDrawerOpen(false)}
        onCreated={(itemId, itemName) => {
          setDrawerOpen(false)
          onResolved(exception.id)
        }}
      />
    </>
  )
}

function renderForm(
  exception: InvoiceException,
  onResolve: (action: Record<string, unknown>) => Promise<void>,
  onDismiss: (notes?: string) => Promise<void>,
  loading: boolean,
  onCreateNewItem?: () => void
) {
  const resolveTyped = onResolve as (action: { type: string; [k: string]: unknown }) => Promise<void>

  switch (exception.exception_type) {
    case 'low_extraction_confidence':
      return <LowExtractionConfidenceForm exception={exception} onResolve={resolveTyped} onDismiss={onDismiss} loading={loading} />
    case 'no_supplier_match':
      return <NoSupplierMatchForm exception={exception} onResolve={resolveTyped} onDismiss={onDismiss} loading={loading} />
    case 'no_po_match':
      return <NoPOMatchForm exception={exception} onResolve={resolveTyped} onDismiss={onDismiss} loading={loading} />
    case 'no_item_match':
      return <NoItemMatchForm exception={exception} onResolve={resolveTyped} onDismiss={onDismiss} loading={loading} onCreateNewItem={onCreateNewItem} />
    case 'price_variance':
      return <PriceVarianceForm exception={exception} onResolve={resolveTyped} onDismiss={onDismiss} loading={loading} />
    case 'quantity_variance':
      return <QuantityVarianceForm exception={exception} onResolve={resolveTyped} onDismiss={onDismiss} loading={loading} />
    case 'parse_error':
      return <ParseErrorForm exception={exception} onResolve={resolveTyped} onDismiss={onDismiss} loading={loading} />
    case 'duplicate_invoice':
      return <DuplicateInvoiceForm exception={exception} onResolve={resolveTyped} onDismiss={onDismiss} loading={loading} />
    default:
      return <p className="text-sm text-gray-500">Unknown exception type</p>
  }
}

function getRelativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diff = now - then
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(isoString).toLocaleDateString()
}
