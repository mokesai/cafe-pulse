/**
 * Spike configuration: which workflows × models to run, and per-model metadata
 * (PDF support, pricing) that the harness needs to route requests and estimate cost.
 *
 * Pricing in USD per 1M tokens — sourced from OpenRouter model pages. Keep in
 * sync if pricing changes; values used only for cost reporting in the spike.
 */

import type { ModelSlug, WorkflowId } from './types'

export const WORKFLOWS: WorkflowId[] = ['A', 'B', 'C', 'D']

export const MODELS: ModelSlug[] = [
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'anthropic/claude-sonnet-4.6',
  'google/gemini-2.5-pro',
  'mistralai/pixtral-large-2411',
]

/** Whether the model accepts native PDF inputs on OpenRouter (vs requiring image rendering / file-parser plugin). */
export const MODEL_PDF_NATIVE: Record<ModelSlug, boolean> = {
  'openai/gpt-4o': false,
  'openai/gpt-4o-mini': false,
  'anthropic/claude-sonnet-4.6': true,
  'google/gemini-2.5-pro': true,
  'mistralai/pixtral-large-2411': false,
}

export const MODEL_PRICING: Record<ModelSlug, { promptUsdPer1M: number; completionUsdPer1M: number }> = {
  'openai/gpt-4o': { promptUsdPer1M: 2.5, completionUsdPer1M: 10 },
  'openai/gpt-4o-mini': { promptUsdPer1M: 0.15, completionUsdPer1M: 0.6 },
  'anthropic/claude-sonnet-4.6': { promptUsdPer1M: 3, completionUsdPer1M: 15 },
  'google/gemini-2.5-pro': { promptUsdPer1M: 1.25, completionUsdPer1M: 10 },
  'mistralai/pixtral-large-2411': { promptUsdPer1M: 2, completionUsdPer1M: 6 },
}

/**
 * Confidence threshold at which workflow B/D decide to fall back from text/vision.
 * Mirrors production default (visionConfidenceThresholdPct = 70).
 */
export const CONFIDENCE_FALLBACK_THRESHOLD = 0.7

export const FIXTURES_DIR = 'tests/fixtures/invoices/mok-110'
export const PDFS_DIR = `${FIXTURES_DIR}/pdfs`
export const EXPECTED_DIR = `${FIXTURES_DIR}/expected`
export const CACHE_DIR = 'scripts/spike-mok-110/cache'
export const REPORTS_DIR = 'scripts/spike-mok-110/reports'
