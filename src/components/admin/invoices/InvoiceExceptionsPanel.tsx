'use client'

import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { InvoiceException } from '@/types/invoice-exceptions'

/**
 * InvoiceExceptionsPanel
 * Amber panel shown on invoice detail when pipeline_stage = 'pending_exceptions'.
 * Lists open exceptions with resolve links.
 * Matches Screen 15 of Milli's UI/UX spec.
 */

interface InvoiceExceptionsPanelProps {
  invoiceId: string
  exceptions: InvoiceException[]
  openCount: number
}

const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  low_extraction_confidence: 'Low Confidence Scan',
  no_supplier_match: 'Unknown Supplier',
  no_po_match: 'No Purchase Order',
  no_item_match: 'Unmatched Item',
  price_variance: 'Price Change',
  quantity_variance: 'Quantity Mismatch',
  parse_error: 'Processing Error',
  duplicate_invoice: 'Duplicate Invoice',
}

function getExceptionBrief(ex: InvoiceException): string {
  const ctx = ex.exception_context as Record<string, unknown>
  switch (ex.exception_type) {
    case 'no_item_match':
      return (ctx.invoice_description as string) ?? ex.exception_message
    case 'price_variance': {
      const pct = typeof ctx.variance_pct === 'number' ? Math.abs(Math.round(ctx.variance_pct)) : null
      const name = (ctx.inventory_item_name as string) ?? ''
      return pct !== null ? `${name} ${ctx.variance_pct > 0 ? '+' : '−'}${pct}%` : ex.exception_message
    }
    default:
      return ''
  }
}

export function InvoiceExceptionsPanel({
  invoiceId,
  exceptions,
  openCount,
}: InvoiceExceptionsPanelProps) {
  const displayExceptions = exceptions.slice(0, 5) // show at most 5 inline

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-800">
            {openCount === 1
              ? '1 exception is blocking confirmation of this invoice.'
              : `${openCount} exceptions are blocking confirmation of this invoice.`}
          </p>

          <ul className="mt-3 space-y-1.5" role="list">
            {displayExceptions.map((ex) => {
              const label = EXCEPTION_TYPE_LABELS[ex.exception_type] ?? ex.exception_type
              const brief = getExceptionBrief(ex)
              return (
                <li key={ex.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-amber-700">
                    ● {label}{brief ? ` · ${brief}` : ''}
                  </span>
                  <Link
                    href={`/admin/invoice-exceptions?invoice_id=${invoiceId}`}
                    className="shrink-0 font-medium text-amber-800 underline hover:text-amber-950"
                  >
                    Resolve →
                  </Link>
                </li>
              )
            })}
            {openCount > displayExceptions.length && (
              <li className="text-sm text-amber-600">
                + {openCount - displayExceptions.length} more exception{openCount - displayExceptions.length > 1 ? 's' : ''}
              </li>
            )}
          </ul>

          <div className="mt-3">
            <Link
              href={`/admin/invoice-exceptions?invoice_id=${invoiceId}`}
              className="text-sm font-medium text-amber-800 underline hover:text-amber-950"
            >
              View All in Exception Queue →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
