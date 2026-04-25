/**
 * Workflow B — pdf2json + AI text parse, then fall back to Vision/PDF if
 * confidence is low. This is the proposed MOK-110 fix.
 *
 * Steps:
 *   1. Run workflow A (pdf2json → text-mode chat)
 *   2. If overall_confidence >= threshold → accept and stop
 *   3. Else → run workflow C (PDF-mode chat) and prefer that result
 */

import { runWorkflowA } from './a-pdf2json-only'
import { runWorkflowC } from './c-vision-first'
import { CONFIDENCE_FALLBACK_THRESHOLD } from '../config'
import type { ModelSlug, WorkflowResult } from '../types'

export async function runWorkflowB(args: {
  pdfPath: string
  pdfFile: string
  model: ModelSlug
}): Promise<WorkflowResult> {
  const startedAt = Date.now()
  const a = await runWorkflowA(args)

  // If A succeeded with sufficient confidence, accept it and label as workflow B.
  if (a.parsed && a.parsed.overall_confidence >= CONFIDENCE_FALLBACK_THRESHOLD) {
    return { ...a, workflow: 'B', totalLatencyMs: Date.now() - startedAt }
  }

  // Mark A's last step as not-accepted (we're falling through) and run C.
  const aStepsRelabeled = a.steps.map((s, i, arr) =>
    i === arr.length - 1 ? { ...s, accepted: false } : s
  )

  const c = await runWorkflowC(args)
  const combinedSteps = [...aStepsRelabeled, ...c.steps]
  const totalCost = a.totalCostUsd + c.totalCostUsd

  return {
    pdfFile: args.pdfFile,
    workflow: 'B',
    model: args.model,
    steps: combinedSteps,
    parsed: c.parsed ?? a.parsed,
    totalCostUsd: totalCost,
    totalLatencyMs: Date.now() - startedAt,
    error: c.error ?? (c.parsed ? undefined : a.error),
  }
}
