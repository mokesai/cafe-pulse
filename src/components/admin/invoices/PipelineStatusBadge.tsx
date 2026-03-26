'use client'

import { Loader2 } from 'lucide-react'

/**
 * PipelineStatusBadge
 * Displays a pipeline_stage/status value as a styled badge.
 * Matches Screen 14 of Milli's UI/UX spec.
 */

interface PipelineStatusBadgeProps {
  pipelineStage?: string | null
  status: string
  openExceptionCount?: number
  /** If true, renders a compact inline version suitable for table cells */
  compact?: boolean
}

export function PipelineStatusBadge({
  pipelineStage,
  status,
  openExceptionCount = 0,
  compact = false,
}: PipelineStatusBadgeProps) {
  // Determine what to display based on pipeline_stage + status
  const displayStage = pipelineStage ?? status

  if (displayStage === 'extracting' || displayStage === 'resolving_supplier') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Extracting…
      </span>
    )
  }

  if (displayStage === 'matching_po' || displayStage === 'matching_items' || displayStage === 'matching') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Matching…
      </span>
    )
  }

  if (displayStage === 'confirming' || status === 'pipeline_running') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Processing…
      </span>
    )
  }

  if (displayStage === 'pending_exceptions' || status === 'pending_exceptions') {
    const count = openExceptionCount > 0 ? openExceptionCount : null
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
        ⚠ Needs Review{count !== null ? ` (${count})` : ''}
      </span>
    )
  }

  if (displayStage === 'completed' || status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        ✓ Confirmed
      </span>
    )
  }

  if (displayStage === 'failed' || status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        ✗ Error
      </span>
    )
  }

  if (status === 'duplicate') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
        Duplicate
      </span>
    )
  }

  // Legacy statuses
  if (status === 'uploading') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
        <Loader2 className="w-3 h-3 animate-spin" />
        Uploading…
      </span>
    )
  }

  if (status === 'parsed') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
        Parsed
      </span>
    )
  }

  if (status === 'uploaded') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
        Uploaded
      </span>
    )
  }

  // Fallback
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
      {status}
    </span>
  )
}
