'use client'

import { CheckCircle2 } from 'lucide-react'

/**
 * AutoConfirmedPanel
 * Green success panel shown when invoice has been auto-confirmed.
 * Matches Screen 15 (confirmed state) of Milli's UI/UX spec.
 */

interface AutoConfirmedPanelProps {
  pipelineCompletedAt?: string | null
  purchaseOrderNumber?: string | null
}

export function AutoConfirmedPanel({
  pipelineCompletedAt,
  purchaseOrderNumber,
}: AutoConfirmedPanelProps) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" aria-hidden />
        <div>
          <p className="text-sm font-medium text-green-800">Invoice Confirmed</p>
          <p className="mt-0.5 text-sm text-green-700">
            {pipelineCompletedAt
              ? `Automatically confirmed on ${new Date(pipelineCompletedAt).toLocaleString()}`
              : 'Automatically confirmed by the pipeline.'}
          </p>
          {purchaseOrderNumber && (
            <p className="mt-0.5 text-sm text-green-700">
              PO #{purchaseOrderNumber} marked received · Inventory updated
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
