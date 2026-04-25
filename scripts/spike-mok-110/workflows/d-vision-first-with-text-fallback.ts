/**
 * Workflow D — Vision/PDF first, fall back to pdf2json+text if confidence is low.
 * The mirror of workflow B; useful for image-heavy or scanned PDFs where Vision
 * is more likely to win, but where text extraction can still rescue corner cases.
 */

import { runWorkflowA } from './a-pdf2json-only'
import { runWorkflowC } from './c-vision-first'
import { CONFIDENCE_FALLBACK_THRESHOLD } from '../config'
import type { ModelSlug, WorkflowResult } from '../types'

export async function runWorkflowD(args: {
  pdfPath: string
  pdfFile: string
  model: ModelSlug
}): Promise<WorkflowResult> {
  const startedAt = Date.now()
  const c = await runWorkflowC(args)

  if (c.parsed && c.parsed.overall_confidence >= CONFIDENCE_FALLBACK_THRESHOLD) {
    return { ...c, workflow: 'D', totalLatencyMs: Date.now() - startedAt }
  }

  const cStepsRelabeled = c.steps.map((s, i, arr) =>
    i === arr.length - 1 ? { ...s, accepted: false } : s
  )

  const a = await runWorkflowA(args)
  const combinedSteps = [...cStepsRelabeled, ...a.steps]
  const totalCost = c.totalCostUsd + a.totalCostUsd

  return {
    pdfFile: args.pdfFile,
    workflow: 'D',
    model: args.model,
    steps: combinedSteps,
    parsed: a.parsed ?? c.parsed,
    totalCostUsd: totalCost,
    totalLatencyMs: Date.now() - startedAt,
    error: a.error ?? (a.parsed ? undefined : c.error),
  }
}
