/**
 * Workflow A — pdf2json + AI text parse.
 *
 * Mirrors the current production PDF path in
 * supabase/functions/invoice-pipeline/stages/01-extract.ts when text extraction
 * succeeds with sufficient confidence. Establishes the baseline that B/C/D must beat.
 *
 * Steps:
 *   1. pdf2json → text + heuristic confidence
 *   2. send text to OpenRouter chat completion (text mode)
 *   3. normalize response → ParsedInvoice
 */

import { chatText } from '../providers/openrouter'
import { extractPdfText } from '../providers/pdf-text'
import { buildTextSystemPrompt } from '../prompts'
import { normalize } from '../normalizer'
import type { ModelSlug, WorkflowResult, WorkflowStep } from '../types'

export async function runWorkflowA(args: {
  pdfPath: string
  pdfFile: string
  model: ModelSlug
}): Promise<WorkflowResult> {
  const steps: WorkflowStep[] = []
  const startedAt = Date.now()

  // Step 1 — pdf2json text extraction
  let pdfText: Awaited<ReturnType<typeof extractPdfText>>
  const t1 = Date.now()
  try {
    pdfText = await extractPdfText(args.pdfPath)
  } catch (err) {
    steps.push({
      kind: 'pdf2json',
      latencyMs: Date.now() - t1,
      accepted: false,
      error: errString(err),
    })
    return {
      pdfFile: args.pdfFile,
      workflow: 'A',
      model: args.model,
      steps,
      totalCostUsd: 0,
      totalLatencyMs: Date.now() - startedAt,
      error: `pdf2json failed: ${errString(err)}`,
    }
  }
  steps.push({
    kind: 'pdf2json',
    latencyMs: Date.now() - t1,
    confidence: pdfText.confidence,
    accepted: true,
  })

  // Step 2 — chat completion in text mode
  try {
    const result = await chatText({
      model: args.model,
      systemPrompt: buildTextSystemPrompt(),
      userText: `Parse this invoice text:\n\n${pdfText.text}`,
    })
    const parsed = normalize(result.parsed)
    steps.push({
      kind: 'openrouter-text',
      model: args.model,
      latencyMs: result.latencyMs,
      confidence: parsed.overall_confidence,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
      accepted: true,
    })
    return {
      pdfFile: args.pdfFile,
      workflow: 'A',
      model: args.model,
      steps,
      parsed,
      totalCostUsd: result.costUsd,
      totalLatencyMs: Date.now() - startedAt,
    }
  } catch (err) {
    steps.push({
      kind: 'openrouter-text',
      model: args.model,
      latencyMs: 0,
      accepted: false,
      error: errString(err),
    })
    return {
      pdfFile: args.pdfFile,
      workflow: 'A',
      model: args.model,
      steps,
      totalCostUsd: 0,
      totalLatencyMs: Date.now() - startedAt,
      error: `OpenRouter text call failed: ${errString(err)}`,
    }
  }
}

function errString(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
