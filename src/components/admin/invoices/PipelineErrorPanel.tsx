'use client'

import { XCircle, Loader2 } from 'lucide-react'
import { useState } from 'react'

/**
 * PipelineErrorPanel
 * Red panel displayed when pipeline_stage = 'failed' or status = 'error'.
 * Matches Screen 17 of Milli's UI/UX spec.
 */

interface PipelineErrorPanelProps {
  invoiceId: string
  pipelineError?: string | null
  pipelineStage?: string | null
  onRetrySuccess?: () => void
  /** Navigate to the exception queue for this invoice */
  onViewExceptions?: () => void
}

function stageName(stage?: string | null): string {
  switch (stage) {
    case 'extracting':
    case 'resolving_supplier':
      return 'Extraction'
    case 'matching_po':
    case 'matching_items':
      return 'Matching'
    case 'confirming':
      return 'Confirmation'
    default:
      return 'Processing'
  }
}

export function PipelineErrorPanel({
  invoiceId,
  pipelineError,
  pipelineStage,
  onRetrySuccess,
  onViewExceptions,
}: PipelineErrorPanelProps) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [retrySuccess, setRetrySuccess] = useState(false)

  const handleRetry = async () => {
    try {
      setRetrying(true)
      setRetryError(null)
      const response = await fetch(`/api/admin/invoices/${invoiceId}/retry-pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_stage: 'extracting' }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? 'Retry failed')
      }
      setRetrySuccess(true)
      onRetrySuccess?.()
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed. Please try again.')
    } finally {
      setRetrying(false)
    }
  }

  if (retrySuccess) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-medium text-blue-800">
          Pipeline retrying — check back in 60 seconds.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-800">
            The pipeline failed during {stageName(pipelineStage)}.
          </p>
          {pipelineError && (
            <p className="mt-1 text-sm text-red-700">{pipelineError}</p>
          )}
          {retryError && (
            <p className="mt-1 text-sm text-red-700">{retryError}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {onViewExceptions && (
              <button
                type="button"
                onClick={onViewExceptions}
                className="text-sm font-medium text-red-700 underline hover:text-red-900"
              >
                View Exception in Queue →
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {retrying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Retrying…
                </>
              ) : (
                'Retry Pipeline'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
