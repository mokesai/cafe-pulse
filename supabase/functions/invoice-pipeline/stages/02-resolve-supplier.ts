/**
 * Stage 02 — Supplier Resolution
 *
 * Resolves the extracted supplier name to a known supplier record.
 * Uses fuzzy matching via OpenRouter AI when no exact match is found.
 *
 * Decision points:
 * - Exact match (case-insensitive) → auto-resolve
 * - High-confidence fuzzy match (>= 0.85) → auto-resolve
 * - Low-confidence matches → create no_supplier_match exception (non-fatal)
 * - Fatal: parsedData is null (Stage 1 did not run or failed)
 *
 * Architecture: §2.4
 * Runtime: Deno (Supabase Edge Function)
 */

import type { PipelineContext } from '../context.ts'
import type { StageResult } from '../orchestrator.ts'
import { createException, sanitizeError } from '../exceptions.ts'

const STAGE = 'resolving_supplier'
const AUTO_RESOLVE_CONFIDENCE = 0.85

interface SupplierRecord {
  id: string
  name: string
  tenant_id: string
}

export async function runSupplierResolution(ctx: PipelineContext): Promise<StageResult> {
  console.log(JSON.stringify({
    event: 'stage_start',
    stage: STAGE,
    invoice_id: ctx.invoiceId,
    tenant_id: ctx.tenantId,
  }))

  if (!ctx.parsedData) {
    return { ok: false, fatal: true, error: 'No parsed data available — Stage 1 must complete first' }
  }

  const extractedSupplierName = ctx.parsedData.supplier_info.name?.trim() ?? null

  // ── Case 1: Invoice already has a supplier_id (uploaded with supplier pre-set) ──
  if (ctx.invoice.supplier_id) {
    ctx.resolvedSupplierId = ctx.invoice.supplier_id
    console.log(JSON.stringify({
      event: 'supplier_resolved_from_invoice',
      invoice_id: ctx.invoiceId,
      supplier_id: ctx.invoice.supplier_id,
    }))
    await updateInvoiceSupplier(ctx, ctx.invoice.supplier_id)
    return { ok: true }
  }

  // ── Case 2: No supplier name extracted ────────────────────────────────────
  if (!extractedSupplierName) {
    await createException(ctx, {
      type: 'no_supplier_match',
      message: 'Could not extract supplier name from invoice. Please select the supplier manually.',
      context: {
        extracted_supplier_name: null,
        suggested_suppliers: [],
      },
      pipelineStage: STAGE,
    })
    // Non-fatal — continue pipeline but without supplier_id
    return { ok: true }
  }

  // ── Load all suppliers for this tenant ────────────────────────────────────
  const { data: suppliers, error: suppliersError } = await ctx.supabase
    .from('suppliers')
    .select('id, name, tenant_id')
    .eq('tenant_id', ctx.tenantId)
    .order('name')

  if (suppliersError) {
    return { ok: false, fatal: true, error: `Failed to load suppliers: ${suppliersError.message}` }
  }

  const supplierList = (suppliers ?? []) as SupplierRecord[]

  // ── Case 3: Exact match (case-insensitive) ────────────────────────────────
  const exactMatch = supplierList.find(
    (s) => s.name.toLowerCase() === extractedSupplierName.toLowerCase()
  )

  if (exactMatch) {
    ctx.resolvedSupplierId = exactMatch.id
    await updateInvoiceSupplier(ctx, exactMatch.id)
    console.log(JSON.stringify({
      event: 'supplier_resolved_exact',
      invoice_id: ctx.invoiceId,
      supplier_id: exactMatch.id,
      supplier_name: exactMatch.name,
    }))
    return { ok: true }
  }

  // ── Case 4: Fuzzy match via AI ────────────────────────────────────────────
  const fuzzyMatches = await fuzzyMatchSuppliersWithAI(
    extractedSupplierName,
    supplierList
  )

  if (fuzzyMatches.length > 0 && fuzzyMatches[0].confidence >= AUTO_RESOLVE_CONFIDENCE) {
    // Auto-resolve to the top match
    const topMatch = fuzzyMatches[0]
    ctx.resolvedSupplierId = topMatch.id
    await updateInvoiceSupplier(ctx, topMatch.id)
    console.log(JSON.stringify({
      event: 'supplier_resolved_fuzzy',
      invoice_id: ctx.invoiceId,
      supplier_id: topMatch.id,
      supplier_name: topMatch.name,
      confidence: topMatch.confidence,
    }))
    return { ok: true }
  }

  // ── Case 5: No confident match — create exception ─────────────────────────
  await createException(ctx, {
    type: 'no_supplier_match',
    message: `Could not match "${extractedSupplierName}" to a known supplier. Please select the correct supplier from the list.`,
    context: {
      extracted_supplier_name: extractedSupplierName,
      suggested_suppliers: fuzzyMatches.slice(0, 5).map((m) => ({
        id: m.id,
        name: m.name,
        confidence: m.confidence,
      })),
    },
    pipelineStage: STAGE,
  })

  // Non-fatal — continue pipeline
  console.log(JSON.stringify({
    event: 'supplier_unresolved',
    invoice_id: ctx.invoiceId,
    extracted_name: extractedSupplierName,
    candidate_count: fuzzyMatches.length,
  }))

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function updateInvoiceSupplier(
  ctx: PipelineContext,
  supplierId: string
): Promise<void> {
  await ctx.supabase
    .from('invoices')
    .update({ supplier_id: supplierId })
    .eq('id', ctx.invoiceId)
    .eq('tenant_id', ctx.tenantId)
}

interface FuzzyMatch {
  id: string
  name: string
  confidence: number
}

/**
 * Use OpenRouter GPT-4o to fuzzy-match a supplier name against the known list.
 * Returns up to 5 candidates sorted by confidence descending.
 *
 * This replaces Fuse.js (not verified Deno-compatible) with AI-based matching
 * which is actually more accurate for supplier name variations.
 */
async function fuzzyMatchSuppliersWithAI(
  extractedName: string,
  suppliers: SupplierRecord[]
): Promise<FuzzyMatch[]> {
  if (suppliers.length === 0) return []

  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    console.warn('[02-resolve-supplier] OPENROUTER_API_KEY not set, skipping fuzzy match')
    return []
  }

  const supplierListText = suppliers
    .map((s, i) => `${i + 1}. ID: ${s.id} | Name: ${s.name}`)
    .join('\n')

  const prompt = `You are a supplier name matching assistant.
  
Given the extracted supplier name from an invoice, find the best matching suppliers from the list below.

Extracted name: "${extractedName}"

Known suppliers:
${supplierListText}

Return ONLY a JSON array of matches (best first), with this structure:
[{"id": "uuid", "name": "name", "confidence": 0.0-1.0}]

Rules:
- confidence 0.9+: very strong match (abbreviation, typo, or common alias)
- confidence 0.75-0.89: plausible match (partial name or similar)
- confidence below 0.75: uncertain match
- Include up to 5 matches, even low-confidence ones
- If no reasonable match exists, return []
- Return ONLY the JSON array, no other text`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://cafe-pulse.mokesai.com',
        'X-Title': 'CafePulse Invoice Pipeline',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 512,
      }),
    })

    if (!response.ok) return []

    const responseJson = await response.json()
    const content = responseJson?.choices?.[0]?.message?.content ?? '[]'

    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const matches = JSON.parse(jsonMatch[0]) as FuzzyMatch[]
    return matches
      .filter((m) => m.id && m.name && typeof m.confidence === 'number')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
  } catch (err) {
    console.warn('[02-resolve-supplier] AI fuzzy match error:', sanitizeError(err))
    return []
  }
}
