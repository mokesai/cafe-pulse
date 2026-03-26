'use client'

import { Check, Loader2, AlertTriangle, X } from 'lucide-react'
import { PipelineStage } from '@/types/invoice'

/**
 * PipelineProgressBar
 * 5-stage horizontal step indicator for the invoice pipeline.
 * Matches Screen 15 of Milli's UI/UX spec.
 *
 * Stages: uploaded → extracting → matching → reviewing → confirmed
 */

interface Stage {
  id: string
  label: string
  pipelineStages: string[]  // pipeline_stage values that map to this display stage
}

const STAGES: Stage[] = [
  {
    id: 'upload',
    label: 'Upload',
    pipelineStages: ['uploading'],
  },
  {
    id: 'extract',
    label: 'Extract',
    pipelineStages: ['extracting', 'resolving_supplier'],
  },
  {
    id: 'match',
    label: 'Match',
    pipelineStages: ['matching_po', 'matching_items'],
  },
  {
    id: 'review',
    label: 'Review',
    pipelineStages: ['confirming', 'pending_exceptions'],
  },
  {
    id: 'confirmed',
    label: 'Confirmed',
    pipelineStages: ['completed'],
  },
]

// Which stage index is "active" based on pipeline_stage + status
function getActiveStageIndex(pipelineStage: PipelineStage | null | undefined, status: string): number {
  if (!pipelineStage && !status) return 0

  const stage = pipelineStage ?? status

  if (stage === 'failed' || status === 'error') {
    // Find the index of the failed stage
    for (let i = 0; i < STAGES.length; i++) {
      if (STAGES[i].pipelineStages.some(s => s === stage)) return i
    }
    return 1 // default to extract if unknown
  }

  if (stage === 'completed' || status === 'confirmed') return 4 // all done

  // Find matching stage
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].pipelineStages.some(s => s === stage)) return i
  }

  // Legacy statuses
  if (status === 'uploaded') return 0
  if (status === 'parsed' || status === 'parsing') return 1
  if (status === 'reviewing' || status === 'matched') return 2
  if (status === 'pending_exceptions') return 3

  return 0
}

type StageState = 'completed' | 'active-running' | 'active-review' | 'active-error' | 'pending'

function getStageState(
  stageIndex: number,
  activeIndex: number,
  pipelineStage: PipelineStage | null | undefined,
  status: string,
): StageState {
  const isError = pipelineStage === 'failed' || status === 'error'
  const isConfirmed = pipelineStage === 'completed' || status === 'confirmed'
  const isPendingExceptions = pipelineStage === null && status === 'pending_exceptions'
    || pipelineStage === 'confirming' && status === 'pending_exceptions'
    || status === 'pending_exceptions'

  if (stageIndex < activeIndex) return 'completed'
  if (stageIndex === activeIndex) {
    if (isError) return 'active-error'
    if (isPendingExceptions && stageIndex === 3) return 'active-review'
    if (isConfirmed) return 'completed'
    return 'active-running'
  }
  return 'pending'
}

interface PipelineProgressBarProps {
  pipelineStage?: PipelineStage | null
  status: string
  pipelineStartedAt?: string | null
  pipelineCompletedAt?: string | null
  pipelineError?: string | null
}

export function PipelineProgressBar({
  pipelineStage,
  status,
  pipelineStartedAt,
  pipelineCompletedAt,
  pipelineError,
}: PipelineProgressBarProps) {
  const activeIndex = getActiveStageIndex(pipelineStage, status)

  return (
    <div className="w-full" role="list" aria-label="Invoice pipeline progress">
      <div className="flex items-center">
        {STAGES.map((stage, i) => {
          const state = getStageState(i, activeIndex, pipelineStage, status)
          const isLast = i === STAGES.length - 1

          return (
            <div key={stage.id} className="flex items-center flex-1" role="listitem">
              {/* Stage circle + label */}
              <div className="flex flex-col items-center">
                <div
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all
                    ${state === 'completed' ? 'bg-green-500 text-white' : ''}
                    ${state === 'active-running' ? 'bg-blue-500 text-white ring-4 ring-blue-100' : ''}
                    ${state === 'active-review' ? 'bg-amber-500 text-white ring-4 ring-amber-100' : ''}
                    ${state === 'active-error' ? 'bg-red-500 text-white ring-4 ring-red-100' : ''}
                    ${state === 'pending' ? 'bg-gray-200 text-gray-500' : ''}
                  `}
                  aria-label={`${stage.label}: ${
                    state === 'completed' ? 'completed' :
                    state === 'active-running' ? 'in progress' :
                    state === 'active-review' ? 'needs review' :
                    state === 'active-error' ? 'error' :
                    'not started'
                  }`}
                  aria-current={state !== 'pending' && state !== 'completed' ? 'step' : undefined}
                >
                  {state === 'completed' && <Check className="w-4 h-4" aria-hidden />}
                  {state === 'active-running' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                  {state === 'active-review' && <AlertTriangle className="w-4 h-4" aria-hidden />}
                  {state === 'active-error' && <X className="w-4 h-4" aria-hidden />}
                  {state === 'pending' && <span aria-hidden>{i + 1}</span>}
                </div>
                <span
                  className={`mt-1.5 text-xs font-medium whitespace-nowrap ${
                    state === 'completed' ? 'text-green-600' :
                    state === 'active-running' ? 'text-blue-600' :
                    state === 'active-review' ? 'text-amber-600' :
                    state === 'active-error' ? 'text-red-600' :
                    'text-gray-400'
                  }`}
                >
                  {stage.label}
                </span>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div
                  className={`flex-1 h-0.5 mx-2 mb-5 transition-all ${
                    i < activeIndex ? 'bg-green-400' : 'bg-gray-200'
                  }`}
                  aria-hidden
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Optional timing info */}
      {pipelineStartedAt && (
        <p className="mt-2 text-xs text-gray-400">
          Started {new Date(pipelineStartedAt).toLocaleString()}
          {pipelineCompletedAt && (
            <> · Completed {new Date(pipelineCompletedAt).toLocaleString()}</>
          )}
        </p>
      )}
    </div>
  )
}
