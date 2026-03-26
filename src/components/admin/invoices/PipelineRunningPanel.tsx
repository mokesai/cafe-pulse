'use client'

import { Loader2 } from 'lucide-react'

/**
 * PipelineRunningPanel
 * Blue panel shown while the pipeline is actively processing.
 * Matches Screen 16 of Milli's UI/UX spec.
 */

interface PipelineRunningPanelProps {
  pipelineStage?: string | null
  onRefresh?: () => void
  refreshing?: boolean
}

function getStageCopy(stage?: string | null): string {
  switch (stage) {
    case 'extracting':
    case 'resolving_supplier':
      return 'Extracting invoice data…'
    case 'matching_po':
    case 'matching_items':
    case 'matching':
      return 'Matching items to inventory…'
    case 'confirming':
      return 'Confirming invoice…'
    default:
      return 'Processing invoice…'
  }
}

export function PipelineRunningPanel({
  pipelineStage,
  onRefresh,
  refreshing = false,
}: PipelineRunningPanelProps) {
  const message = getStageCopy(pipelineStage)

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <Loader2
          className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-500"
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-800">{message}</p>
          <p className="mt-0.5 text-sm text-blue-600">
            This usually takes 20–60 seconds. You can leave this page.
          </p>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="shrink-0 text-sm font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
          >
            {refreshing ? (
              <span className="flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Refreshing…
              </span>
            ) : (
              'Refresh Status'
            )}
          </button>
        )}
      </div>
    </div>
  )
}
