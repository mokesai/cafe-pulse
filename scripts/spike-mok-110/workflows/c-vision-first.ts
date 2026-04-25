/**
 * Workflow C — Vision-first.
 *
 * Send the PDF directly to the model's vision/PDF endpoint. For models with
 * native PDF support (Claude, Gemini) this is a direct PDF read; for others
 * (GPT-4o, Pixtral) OpenRouter's file-parser plugin rasterizes server-side.
 *
 * Steps:
 *   1. send PDF to OpenRouter chat completion (PDF mode)
 *   2. normalize response → ParsedInvoice
 */

import { chatPdf } from '../providers/openrouter'
import { buildVisionSystemPrompt } from '../prompts'
import { normalize } from '../normalizer'
import type { ModelSlug, WorkflowResult, WorkflowStep } from '../types'

export async function runWorkflowC(args: {
  pdfPath: string
  pdfFile: string
  model: ModelSlug
}): Promise<WorkflowResult> {
  const steps: WorkflowStep[] = []
  const startedAt = Date.now()

  try {
    const result = await chatPdf({
      model: args.model,
      systemPrompt: buildVisionSystemPrompt(),
      pdfPath: args.pdfPath,
    })
    const parsed = normalize(result.parsed)
    steps.push({
      kind: 'openrouter-pdf',
      model: args.model,
      latencyMs: result.latencyMs,
      confidence: parsed.overall_confidence,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
      accepted: true,
    })
    return {
      pdfFile: args.pdfFile,
      workflow: 'C',
      model: args.model,
      steps,
      parsed,
      totalCostUsd: result.costUsd,
      totalLatencyMs: Date.now() - startedAt,
    }
  } catch (err) {
    steps.push({
      kind: 'openrouter-pdf',
      model: args.model,
      latencyMs: 0,
      accepted: false,
      error: errString(err),
    })
    return {
      pdfFile: args.pdfFile,
      workflow: 'C',
      model: args.model,
      steps,
      totalCostUsd: 0,
      totalLatencyMs: Date.now() - startedAt,
      error: `OpenRouter PDF call failed: ${errString(err)}`,
    }
  }
}

function errString(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
