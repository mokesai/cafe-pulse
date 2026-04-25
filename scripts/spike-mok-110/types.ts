/**
 * Shared types for the MOK-110 invoice extraction spike.
 * Mirrors the production ParsedInvoiceResult shape (see
 * supabase/functions/invoice-pipeline/vision-service.ts) so findings
 * translate cleanly to the edge function fix.
 */

export type WorkflowId = 'A' | 'B' | 'C' | 'D'

export type ModelSlug =
  | 'openai/gpt-4o'
  | 'openai/gpt-4o-mini'
  | 'anthropic/claude-sonnet-4.6'
  | 'google/gemini-2.5-pro'
  | 'mistralai/pixtral-large-2411'

export interface ParsedLineItem {
  line_number: number
  description: string
  supplier_item_code: string | null
  quantity: number
  unit_price: number
  total_price: number
  package_size: string | null
  unit_type: string | null
  confidence: number
}

export interface ParsedInvoice {
  invoice_number: string | null
  invoice_date: string | null
  supplier_info: {
    name: string | null
    address: string | null
    phone: string | null
    email: string | null
  }
  subtotal: number | null
  tax_amount: number | null
  total_amount: number | null
  supplier_fees: {
    delivery: number
    shipping: number
    processing: number
    other: number
  }
  total_fees: number
  line_items: ParsedLineItem[]
  overall_confidence: number
}

/** Ground truth — tier 1 fields are required, tier 2 fields refine scoring. */
export interface ExpectedInvoice {
  pdf_filename: string

  // Tier 1 (required)
  invoice_number: string
  total_amount: number
  line_items_count: number

  // Tier 2 (optional)
  supplier_name?: string
  invoice_date?: string
  line_items?: Array<{
    description: string
    quantity: number
    unit_price: number
    total_price?: number
    supplier_item_code?: string | null
  }>
  expected_inventory_matches?: Array<{
    line_index: number
    inventory_item_code: string
  }>
}

export type StepKind =
  | 'pdf2json'
  | 'openrouter-text'
  | 'openrouter-pdf'
  | 'openrouter-image'

export interface WorkflowStep {
  kind: StepKind
  model?: ModelSlug
  latencyMs: number
  confidence?: number
  tokenUsage?: TokenUsage
  costUsd?: number
  error?: string
  /** Was this step's output accepted, or did the workflow fall through to a next step? */
  accepted: boolean
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface WorkflowResult {
  pdfFile: string
  workflow: WorkflowId
  model: ModelSlug
  /** Full sequence of steps the workflow took (e.g. pdf2json → openrouter-text). */
  steps: WorkflowStep[]
  /** Final extracted invoice, if any step succeeded. */
  parsed?: ParsedInvoice
  /** Total cost in USD across all API calls in this workflow run. */
  totalCostUsd: number
  /** Total wall-clock latency in ms. */
  totalLatencyMs: number
  /** Top-level error if the whole workflow failed. */
  error?: string
}

export interface EvaluationScore {
  invoice_number_match: boolean
  total_amount_match: boolean
  line_items_count_match: boolean
  // Tier 2
  supplier_name_match?: boolean
  invoice_date_match?: boolean
  per_line_match_rate?: number
  inventory_match_rate?: number
}

export interface EvaluatedRun extends WorkflowResult {
  expected: ExpectedInvoice
  score: EvaluationScore
  /** Convenience: did this run pass the tier-1 bar (invoice #, total, line count)? */
  passedTier1: boolean
}
