/**
 * Score a WorkflowResult against an ExpectedInvoice.
 * Tier 1 metrics (always computed): invoice_number, total_amount, line_items_count.
 * Tier 2 metrics (when ground truth present): supplier_name, invoice_date,
 *   per-line match rate, inventory match rate.
 */

import type {
  EvaluatedRun,
  EvaluationScore,
  ExpectedInvoice,
  ParsedInvoice,
  WorkflowResult,
} from './types'

const TOTAL_AMOUNT_TOLERANCE = 0.01

export function evaluate(result: WorkflowResult, expected: ExpectedInvoice): EvaluatedRun {
  const score = result.parsed
    ? scoreParsed(result.parsed, expected)
    : emptyScore()

  const passedTier1 =
    score.invoice_number_match
    && score.total_amount_match
    && score.line_items_count_match

  return { ...result, expected, score, passedTier1 }
}

function emptyScore(): EvaluationScore {
  return {
    invoice_number_match: false,
    total_amount_match: false,
    line_items_count_match: false,
  }
}

function scoreParsed(parsed: ParsedInvoice, expected: ExpectedInvoice): EvaluationScore {
  const score: EvaluationScore = {
    invoice_number_match:
      normalizeInvoiceNumber(parsed.invoice_number) === normalizeInvoiceNumber(expected.invoice_number),
    total_amount_match:
      parsed.total_amount != null
      && Math.abs(parsed.total_amount - expected.total_amount) <= TOTAL_AMOUNT_TOLERANCE,
    line_items_count_match: parsed.line_items.length === expected.line_items_count,
  }

  if (expected.supplier_name) {
    score.supplier_name_match = fuzzyContains(
      parsed.supplier_info.name,
      expected.supplier_name
    )
  }
  if (expected.invoice_date) {
    score.invoice_date_match = parsed.invoice_date === expected.invoice_date
  }

  if (expected.line_items && expected.line_items.length > 0) {
    score.per_line_match_rate = scorePerLine(parsed, expected)
  }

  if (expected.expected_inventory_matches && expected.expected_inventory_matches.length > 0) {
    // Stub — real inventory match requires running production alias-service against
    // a tenant. Wire that in once we have tier-2 ground truth and a tenant context.
    score.inventory_match_rate = undefined
  }

  return score
}

function normalizeInvoiceNumber(v: string | null | undefined): string {
  if (!v) return ''
  return String(v).trim().toLowerCase().replace(/[\s-]+/g, '')
}

function fuzzyContains(actual: string | null | undefined, expected: string): boolean {
  if (!actual) return false
  const a = actual.toLowerCase()
  const e = expected.toLowerCase()
  return a.includes(e) || e.includes(a)
}

function scorePerLine(parsed: ParsedInvoice, expected: ExpectedInvoice): number {
  const expectedLines = expected.line_items ?? []
  if (expectedLines.length === 0) return 0

  let matched = 0
  for (const exp of expectedLines) {
    const hit = parsed.line_items.find((p) => {
      const descMatch = fuzzyDescription(p.description, exp.description)
      const qtyMatch = approxEqual(p.quantity, exp.quantity, 0.01)
      const priceMatch = approxEqual(p.unit_price, exp.unit_price, 0.01)
      return descMatch && qtyMatch && priceMatch
    })
    if (hit) matched++
  }
  return matched / expectedLines.length
}

function fuzzyDescription(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const an = norm(a)
  const bn = norm(b)
  if (an.length === 0 || bn.length === 0) return false
  return an.includes(bn) || bn.includes(an) || jaccard(an, bn) >= 0.6
}

function jaccard(a: string, b: string): number {
  const aSet = new Set<string>()
  const bSet = new Set<string>()
  for (let i = 0; i < a.length - 2; i++) aSet.add(a.slice(i, i + 3))
  for (let i = 0; i < b.length - 2; i++) bSet.add(b.slice(i, i + 3))
  const inter = [...aSet].filter((x) => bSet.has(x)).length
  const union = new Set([...aSet, ...bSet]).size
  return union === 0 ? 0 : inter / union
}

function approxEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance
}
