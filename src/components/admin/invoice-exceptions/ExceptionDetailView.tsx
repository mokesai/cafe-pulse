'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import type { InvoiceException, InvoiceExceptionDetailResponse } from '@/types/invoice-exceptions'
import { ExceptionRow } from './ExceptionRow'

interface Props {
  exceptionId: string
}

const STATUS_COLORS = {
  open: 'bg-amber-100 text-amber-800',
  resolved: 'bg-green-100 text-green-800',
  dismissed: 'bg-gray-100 text-gray-600',
}

export function ExceptionDetailView({ exceptionId }: Props) {
  const router = useRouter()
  const [data, setData] = useState<InvoiceExceptionDetailResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchException = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/invoice-exceptions/${exceptionId}`)
      if (!res.ok) throw new Error('Failed to load exception')
      const json: InvoiceExceptionDetailResponse = await res.json()
      setData(json.data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load exception')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchException()
  }, [exceptionId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-32" />
        <div className="h-10 bg-gray-200 rounded w-64" />
        <div className="h-48 bg-gray-200 rounded" />
        <div className="h-48 bg-gray-200 rounded" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/admin/invoice-exceptions" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" />
          Back to Exception Queue
        </Link>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">⚠️ {error ?? 'Could not load exception'}</p>
          <button onClick={fetchException} className="text-sm text-red-600 hover:underline mt-2">Try again</button>
        </div>
      </div>
    )
  }

  const statusColor = STATUS_COLORS[data.status] ?? STATUS_COLORS.open
  const invoiceNumber = data.invoice?.invoice_number ?? 'N/A'
  const supplierName = data.invoice?.suppliers?.name ?? 'Unknown'
  const isOpen = data.status === 'open'

  const handleResolved = () => {
    toast.success('Exception resolved ✅')
    router.push('/admin/invoice-exceptions')
  }

  const handleDismissed = () => {
    toast.success('Exception dismissed')
    router.push('/admin/invoice-exceptions')
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back */}
      <Link href="/admin/invoice-exceptions" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" />
        Back to Exception Queue
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Exception #{exceptionId.slice(0, 8)}</h1>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColor}`}>
            {data.status.charAt(0).toUpperCase() + data.status.slice(1)}
          </span>
        </div>
      </div>

      {/* Details card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Exception Details</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-gray-500">Type</dt>
            <dd className="text-gray-900 font-medium">{data.exception_type.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Created</dt>
            <dd className="text-gray-900">{new Date(data.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Invoice</dt>
            <dd>
              <Link href="/admin/invoices" className="text-blue-600 hover:underline font-medium">
                #{invoiceNumber}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Supplier</dt>
            <dd className="text-gray-900">{supplierName}</dd>
          </div>
          {data.invoice_item && (
            <>
              <div>
                <dt className="text-gray-500">Line item</dt>
                <dd className="text-gray-900">{data.invoice_item.item_description}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Qty / Price</dt>
                <dd className="text-gray-900">{data.invoice_item.quantity} × ${data.invoice_item.unit_price?.toFixed(2)}</dd>
              </div>
            </>
          )}
          <div className="col-span-2">
            <dt className="text-gray-500">Message</dt>
            <dd className="text-gray-900">{data.exception_message}</dd>
          </div>
        </dl>
      </div>

      {/* Resolution */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Resolution</h2>
        {isOpen ? (
          <ExceptionRow
            exception={data as InvoiceException}
            selected={false}
            onSelect={() => {}}
            onResolved={handleResolved}
            onDismissed={handleDismissed}
          />
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-gray-500">Resolved by: {data.resolved_by ?? 'System'}</p>
            <p className="text-gray-500">Resolved at: {data.resolved_at ? new Date(data.resolved_at).toLocaleString() : '—'}</p>
            {data.resolution_notes && (
              <p className="text-gray-700">Notes: {data.resolution_notes}</p>
            )}
          </div>
        )}
      </div>

      {/* Pipeline Context */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Pipeline Context</h2>
        <div className="text-sm space-y-1">
          <p className="text-gray-600">Stage when created: <span className="text-gray-900">{data.pipeline_stage_at_creation ?? '—'}</span></p>
          {data.other_open_exceptions_count > 0 && (
            <p className="text-gray-600">
              Other exceptions on this invoice:{' '}
              <Link
                href={`/admin/invoice-exceptions?invoice_id=${data.invoice_id}`}
                className="text-blue-600 hover:underline"
              >
                {data.other_open_exceptions_count} open
              </Link>
            </p>
          )}
          <Link
            href={`/admin/invoice-exceptions?invoice_id=${data.invoice_id}`}
            className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm"
          >
            View all exceptions for Invoice #{invoiceNumber}
          </Link>
        </div>
      </div>

      {/* Audit Log */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Audit Log</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex gap-3">
            <span className="text-gray-400 flex-shrink-0">{new Date(data.created_at).toLocaleString()}</span>
            <span>Exception created by pipeline</span>
          </div>
          {data.pipeline_stage_at_creation && (
            <div className="flex gap-3">
              <span className="text-gray-400 flex-shrink-0">{new Date(data.created_at).toLocaleString()}</span>
              <span>Stage: {data.pipeline_stage_at_creation} — {data.exception_message}</span>
            </div>
          )}
          {data.resolved_at && (
            <div className="flex gap-3">
              <span className="text-gray-400 flex-shrink-0">{new Date(data.resolved_at).toLocaleString()}</span>
              <span>Exception {data.status}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
