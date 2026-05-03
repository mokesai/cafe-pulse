/**
 * Vision Service — invoice extraction via OpenRouter.
 *
 * Accepts image files and PDFs (via URL). PDFs are routed through OpenRouter's
 * file-parser plugin so any model (vision-capable or otherwise) can extract
 * structured data — see MOK-110 spike findings (2026-04-25) for benchmarks.
 *
 * Architecture: §3.1, §3.2, §3.3
 * Runtime: Deno (Supabase Edge Function)
 * AI Provider: OpenRouter (https://openrouter.ai/api/v1)
 * Default model: openai/gpt-4o-mini (override with INVOICE_VISION_MODEL env)
 */

import type { ParsedInvoiceResult, ParsedLineItem, SupplierFees } from './context.ts'

// ============================================================
// Types
// ============================================================

export interface VisionExtractionInput {
  /** Supabase Storage public URL for the invoice file */
  fileUrl: string
  /** 'pdf' | 'png' | 'jpg' | 'jpeg' | 'webp' */
  fileType: string
  /** Optional supplier name hint for the model */
  supplierName?: string
  /** For multi-page PDFs: 0-indexed page (default: process all) */
  pageIndex?: number
  /** OpenRouter model slug. Defaults to env INVOICE_VISION_MODEL or openai/gpt-4o-mini. */
  model?: string
}

/**
 * Models with native PDF support on OpenRouter — these accept PDF files
 * directly. Other models need OpenRouter's file-parser plugin to rasterize
 * server-side (mistral-ocr is most reliable; pdf-text fails on image-only PDFs).
 */
const MODEL_PDF_NATIVE: Record<string, boolean> = {
  'anthropic/claude-sonnet-4.6': true,
  'anthropic/claude-sonnet-4.5': true,
  'anthropic/claude-opus-4.7': true,
  'google/gemini-2.5-pro': true,
  'google/gemini-2.0-flash': true,
}

/** USD per 1M tokens for cost estimation. Add new models as needed. */
const MODEL_PRICING: Record<string, { promptPer1M: number; completionPer1M: number }> = {
  'openai/gpt-4o': { promptPer1M: 2.5, completionPer1M: 10 },
  'openai/gpt-4o-mini': { promptPer1M: 0.15, completionPer1M: 0.6 },
  'anthropic/claude-sonnet-4.6': { promptPer1M: 3, completionPer1M: 15 },
  'google/gemini-2.5-pro': { promptPer1M: 1.25, completionPer1M: 10 },
  'mistralai/pixtral-large-2411': { promptPer1M: 2, completionPer1M: 6 },
}

export interface VisionExtractionOutput {
  parsed: ParsedInvoiceResult
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// Raw AI response schema (must match system prompt)
interface RawVisionResponse {
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
    delivery: number | null
    shipping: number | null
    processing: number | null
    other: number | null
  } | null
  line_items: Array<{
    line_number: number
    description: string
    supplier_item_code: string | null
    quantity: number
    unit_price: number
    total_price: number
    package_size: string | null
    unit_type: string | null
    confidence: number
  }>
  overall_confidence: number
}

// ============================================================
// System Prompt
// ============================================================

function buildSystemPrompt(supplierName?: string): string {
  const supplierHint = supplierName
    ? `\nThis invoice is from supplier: ${supplierName}. Use this to resolve ambiguous supplier information.`
    : ''

  return `You are an expert invoice data extraction AI with computer vision capabilities.
Your task is to extract ALL structured data from the invoice image or document provided.${supplierHint}

CRITICAL INSTRUCTIONS:
1. Return ONLY valid JSON matching the exact schema below. No markdown, no explanation, no preamble.
2. Extract ALL line items — do not omit any product or service listed.
3. Set confidence scores (0.0–1.0) for each line item individually AND for overall extraction quality.
4. Handle encrypted, image-only, or scanned PDFs by reading pixel content.
5. For Walmart Business invoices: they often have complex layouts — extract each SKU line carefully.
6. If a field is not found or unreadable, set it to null. Never guess — set low confidence instead.
7. Parse ALL quantity formats: "12x", "case of 24", "ea", "lb", "oz", etc.
8. Prices must be numeric (no $ symbols). Quantities must be numeric.

REQUIRED JSON SCHEMA (return this exact structure):
{
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "supplier_info": {
    "name": "string or null",
    "address": "string or null",
    "phone": "string or null",
    "email": "string or null"
  },
  "subtotal": number_or_null,
  "tax_amount": number_or_null,
  "total_amount": number_or_null,
  "supplier_fees": {
    "delivery": number_or_null,
    "shipping": number_or_null,
    "processing": number_or_null,
    "other": number_or_null
  },
  "line_items": [
    {
      "line_number": integer,
      "description": "full product description string",
      "supplier_item_code": "string or null",
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "package_size": "e.g. '12x', 'case', '24-pack' or null",
      "unit_type": "e.g. 'each', 'lb', 'oz', 'case' or null",
      "confidence": 0.0_to_1.0
    }
  ],
  "overall_confidence": 0.0_to_1.0
}

FEE EXTRACTION INSTRUCTIONS:
- Look for any charges that are NOT product line items: delivery charges, shipping fees,
  fuel surcharges, handling fees, service charges, processing fees, convenience fees, etc.
- Map each fee type to the correct key:
  - "delivery": delivery charges, fuel surcharges, drop fees
  - "shipping": shipping costs, freight charges, postage
  - "processing": processing fees, service charges, convenience fees, transaction fees
  - "other": any other fees not fitting the above categories
- If no fees of a given type exist, set that key to 0 (not null).
- Do NOT include taxes in supplier_fees (taxes go in tax_amount).
- Do NOT include product discounts or rebates (they stay on the product line item).

CONFIDENCE GUIDELINES:
- 0.9–1.0: Clearly visible, unambiguous data
- 0.7–0.89: Mostly clear, minor uncertainty
- 0.5–0.69: Partially visible or requires inference
- 0.3–0.49: Poor quality or heavily inferred
- 0.0–0.29: Nearly unreadable — flag for human review

Return ONLY the JSON object. No other text.`
}

// ============================================================
// Core extraction function
// ============================================================

/**
 * Extract invoice data from an image or PDF via OpenRouter.
 *
 * - Images (PNG/JPG/WEBP): sent as base64 image_url.
 * - PDFs: sent via OpenRouter's file-parser plugin. Models with native PDF
 *   support (Claude, Gemini) get the PDF directly; others (OpenAI, Pixtral)
 *   are served pre-rasterized by the mistral-ocr engine.
 *
 * MOK-110: previously this function used image_url for both, which silently
 * failed on PDFs. The pipeline's pdf2json-confidence gate masked the failure
 * by short-circuiting before Vision was attempted.
 */
export async function extractInvoiceWithVision(
  input: VisionExtractionInput
): Promise<VisionExtractionOutput> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    throw new Error('[vision-service] OPENROUTER_API_KEY not set')
  }

  const model = input.model ?? Deno.env.get('INVOICE_VISION_MODEL') ?? 'openai/gpt-4o-mini'
  const fileType = input.fileType.toLowerCase()
  const isPdf = fileType === 'pdf'

  // Download file → base64
  console.log(`[vision-service] Downloading file from ${input.fileUrl}`)
  let fileBase64: string
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    const fileResponse = await fetch(input.fileUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'CafePulse/1.0' },
    })
    clearTimeout(timeoutId)
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: HTTP ${fileResponse.status}`)
    }
    const fileBuffer = await fileResponse.arrayBuffer()
    fileBase64 = uint8ToBase64(new Uint8Array(fileBuffer))
    console.log(`[vision-service] Downloaded file: ${fileBuffer.byteLength} bytes`)
  } catch (err) {
    throw new Error(`[vision-service] Failed to download file: ${String(err).slice(0, 300)}`)
  }

  // Build the message content + plugins, branching by file type
  const systemPromptText = buildSystemPrompt(input.supplierName)
  const requestBody: Record<string, unknown> = {
    model,
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  }

  if (isPdf) {
    const filename = input.fileUrl.split('/').pop()?.split('?')[0] ?? 'invoice.pdf'
    requestBody.messages = [
      { role: 'system', content: systemPromptText },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract structured data from this invoice. Return only the JSON object per the system schema.' },
          {
            type: 'file',
            file: {
              filename,
              file_data: `data:application/pdf;base64,${fileBase64}`,
            },
          },
        ],
      },
    ]
    requestBody.plugins = [
      {
        id: 'file-parser',
        pdf: { engine: MODEL_PDF_NATIVE[model] ? 'native' : 'mistral-ocr' },
      },
    ]
  } else {
    const mimeType = getMimeType(fileType)
    requestBody.messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: systemPromptText },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${fileBase64}`, detail: 'high' },
          },
        ],
      },
    ]
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://cafe-pulse.mokesai.com',
      'X-Title': 'CafePulse Invoice Pipeline',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `[vision-service] OpenRouter API error ${response.status} (model=${model}): ${errorText.slice(0, 300)}`
    )
  }

  const responseJson = await response.json()
  const rawContent = responseJson?.choices?.[0]?.message?.content
  if (!rawContent) {
    throw new Error(`[vision-service] Empty response from OpenRouter (model=${model})`)
  }

  // Parse JSON. Some models (Claude, sometimes Gemini) wrap in ```json fences
  // despite response_format=json_object, so strip those before parsing.
  let rawData: RawVisionResponse
  try {
    rawData = JSON.parse(stripCodeFences(rawContent)) as RawVisionResponse
  } catch (e) {
    throw new Error(
      `[vision-service] Invalid JSON from model ${model}: ${String(e).slice(0, 200)}. ` +
        `Raw: ${rawContent.slice(0, 300)}`
    )
  }

  const parsed = normalizeVisionResponse(rawData, input.fileUrl)

  const tokenUsage = {
    promptTokens: responseJson?.usage?.prompt_tokens ?? 0,
    completionTokens: responseJson?.usage?.completion_tokens ?? 0,
    totalTokens: responseJson?.usage?.total_tokens ?? 0,
  }

  return { parsed, tokenUsage }
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim()
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  return m ? m[1].trim() : trimmed
}

/**
 * Encode a Uint8Array to base64 in 32KB chunks. The naive
 * `String.fromCharCode(...bytes)` approach exceeds the JS engine's max
 * function-argument count for files > ~100KB and throws a RangeError.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000 // 32KB
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// ============================================================
// Retry wrapper (architecture §2.7)
// ============================================================

/**
 * Retry wrapper for Vision API calls.
 * On failure, waits baseDelayMs * attempt before retrying.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 2,
  baseDelayMs = 5000
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      console.warn(
        `[vision-service] Attempt ${attempt}/${maxAttempts} failed:`,
        err instanceof Error ? err.message : String(err)
      )
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt))
      }
    }
  }
  throw lastError
}

// ============================================================
// Token usage logging
// ============================================================

/**
 * Log Vision API token usage in structured JSON format.
 * Phase 2 will persist this to a pipeline_usage_logs table.
 */
export function logVisionTokenUsage(
  invoiceId: string,
  tenantId: string,
  usage: VisionExtractionOutput['tokenUsage'],
  model?: string
): void {
  const m = model ?? Deno.env.get('INVOICE_VISION_MODEL') ?? 'openai/gpt-4o-mini'
  const pricing = MODEL_PRICING[m]
  const estimatedCostUsd = pricing
    ? (usage.promptTokens * pricing.promptPer1M + usage.completionTokens * pricing.completionPer1M) / 1_000_000
    : 0

  console.log(
    JSON.stringify({
      event: 'vision_token_usage',
      invoice_id: invoiceId,
      tenant_id: tenantId,
      model: m,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: Math.round(estimatedCostUsd * 10000) / 10000,
      timestamp: new Date().toISOString(),
    })
  )
}

// ============================================================
// Text-based extraction (fallback via internal API)
// ============================================================

export interface TextExtractionResult {
  text: string
  confidence: number
  method: 'pdf2json' | 'pdfjs' | 'ocr' | 'unknown'
}

/**
 * Fetch extracted text from the Next.js text extraction route.
 * This route runs on Vercel and uses the existing pdf-processor.ts cascade.
 *
 * URL: GET /api/admin/invoices/[id]/extract-text
 * Returns: { success: true, text: string, confidence: number, method: string }
 */
export async function fetchExtractedText(
  invoiceId: string,
  tenantId: string
): Promise<TextExtractionResult> {
  // IMPORTANT: NEXTJS_BASE_URL must be set in Supabase Edge Function environment.
  // To set it, go to: Supabase Dashboard → Edge Functions → invoice-pipeline → Settings → Secrets
  // Add: NEXTJS_BASE_URL = https://staging.cafepulse.org (or your deployed URL)
  
  const nextjsBaseUrl = Deno.env.get('NEXTJS_BASE_URL')
  if (!nextjsBaseUrl) {
    throw new Error(
      '[vision-service] NEXTJS_BASE_URL not set in Edge Function secrets. ' +
      'Configure it in Supabase Dashboard → Edge Functions → invoice-pipeline → Secrets'
    )
  }

  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')
  if (!serviceRoleKey) {
    throw new Error('[vision-service] SERVICE_ROLE_KEY not set in Edge Function secrets')
  }

  const url = `${nextjsBaseUrl}/api/admin/invoices/${invoiceId}/extract-text`
  
  console.log(`[vision-service] Calling text extraction: ${url}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      // Pass service role key as internal auth header
      'X-Pipeline-Service-Key': serviceRoleKey ?? '',
      'X-Tenant-Id': tenantId,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `[vision-service] Text extraction API error ${response.status}: ${errorText.slice(0, 300)}`
    )
  }

  const data = await response.json()

  if (!data.success) {
    throw new Error(
      `[vision-service] Text extraction failed: ${data.error ?? 'unknown error'}`
    )
  }

  return {
    text: data.text ?? '',
    confidence: data.confidence ?? 0,
    method: data.method ?? 'unknown',
  }
}

/**
 * Parse invoice text using OpenRouter GPT-4o (text mode, no Vision).
 * Used as fallback when Vision is unavailable or for high-quality native PDFs.
 */
export async function parseInvoiceTextWithAI(
  text: string,
  supplierName?: string
): Promise<ParsedInvoiceResult> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    throw new Error('[vision-service] OPENROUTER_API_KEY not set')
  }

  const model = Deno.env.get('INVOICE_VISION_MODEL') ?? 'openai/gpt-4o-mini'

  const systemPrompt = `You are an expert invoice data extraction AI.
Extract structured data from the invoice text provided.${supplierName ? `\nSupplier: ${supplierName}` : ''}

Return ONLY valid JSON with this exact schema:
{
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "supplier_info": {
    "name": "string or null",
    "address": "string or null",
    "phone": "string or null",
    "email": "string or null"
  },
  "subtotal": number_or_null,
  "tax_amount": number_or_null,
  "total_amount": number_or_null,
  "supplier_fees": {
    "delivery": number_or_0,
    "shipping": number_or_0,
    "processing": number_or_0,
    "other": number_or_0
  },
  "line_items": [
    {
      "line_number": integer,
      "description": "string",
      "supplier_item_code": "string or null",
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "package_size": "string or null",
      "unit_type": "string or null",
      "confidence": 0.0_to_1.0
    }
  ],
  "overall_confidence": 0.0_to_1.0
}

For supplier_fees: capture delivery charges, shipping/freight, processing/service fees, and any
other non-product fees. Use 0 (not null) when a fee type is absent. Do not include taxes here.`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://cafe-pulse.mokesai.com',
      'X-Title': 'CafePulse Invoice Pipeline',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Parse this invoice text:\n\n${text}` },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `[vision-service] OpenRouter text API error ${response.status} (model=${model}): ${errorText.slice(0, 300)}`
    )
  }

  const responseJson = await response.json()
  const rawContent = responseJson?.choices?.[0]?.message?.content
  if (!rawContent) {
    throw new Error(`[vision-service] Empty response from OpenRouter text API (model=${model})`)
  }

  const rawData = JSON.parse(stripCodeFences(rawContent)) as RawVisionResponse
  return normalizeVisionResponse(rawData, '')
}

// ============================================================
// Helpers
// ============================================================

function getMimeType(fileType: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  }
  return map[fileType] ?? 'application/octet-stream'
}

/**
 * Normalize raw Vision API response into a validated ParsedInvoiceResult.
 */
// ─────────────────────────────────────────────────────────────────────────────
// MOK-129: classify line-item descriptions that are actually fees
// ─────────────────────────────────────────────────────────────────────────────

const FEE_CLASSIFIERS: Array<{ pattern: RegExp; category: keyof SupplierFees }> = [
  // MOK-141: shipping-insurance / package-protection add-ons. Listed first
  // so the specific "Delivery Guarantee" pattern beats the generic "^delivery"
  // rule below. Two shapes — generic ("Package Protection", "Shipping
  // Insurance") which can match anywhere in the description, and brand
  // prefixes ("ShipInsure Package Protection", "Route Package Protection")
  // which need to anchor at the start so they don't false-positive on real
  // product names.
  { pattern: /\bpackage\s*protection\b/i, category: 'shipping' },
  { pattern: /\bshipping\s*insurance\b/i, category: 'shipping' },
  { pattern: /\border\s*protection\b/i, category: 'shipping' },
  { pattern: /\bdelivery\s*guarantee\b/i, category: 'shipping' },
  { pattern: /^shipinsure\b/i, category: 'shipping' },
  { pattern: /^route\s*(package|shipping|order)/i, category: 'shipping' },
  // Delivery-shaped charges
  { pattern: /^delivery\b/i, category: 'delivery' },
  { pattern: /^fuel\s*surcharge\b/i, category: 'delivery' },
  { pattern: /^drop\s*(fee|charge)\b/i, category: 'delivery' },
  // Shipping
  { pattern: /^shipping\b/i, category: 'shipping' },
  { pattern: /^freight\b/i, category: 'shipping' },
  { pattern: /^postage\b/i, category: 'shipping' },
  // Processing / service / convenience
  { pattern: /^processing\s*(fee|charge)\b/i, category: 'processing' },
  { pattern: /^service\s*(fee|charge)\b/i, category: 'processing' },
  { pattern: /^convenience\s*(fee|charge)\b/i, category: 'processing' },
  { pattern: /^handling\s*(fee|charge)\b/i, category: 'processing' },
  { pattern: /^transaction\s*(fee|charge)\b/i, category: 'processing' },
]

/**
 * Determine whether a line-item description is actually a supplier fee
 * miscategorized by Vision. Returns the matching `supplier_fees` key, or
 * null when the description isn't fee-shaped.
 *
 * Patterns are anchored at the start with `\b` boundaries so "Delivery Fee"
 * and "Delivery charge" both match `delivery`, but "Delivery special
 * croissant" (a hypothetical product name) does not. Pure function — exported
 * for unit tests.
 */
export function classifyFeeLineItem(description: string): keyof SupplierFees | null {
  const trimmed = description?.trim() ?? ''
  if (!trimmed) return null
  for (const { pattern, category } of FEE_CLASSIFIERS) {
    if (pattern.test(trimmed)) return category
  }
  return null
}

interface FeeExtractionResult {
  /** Line items minus any rows that were reclassified as fees. */
  cleanedLineItems: ParsedLineItem[]
  /** Per-bucket sum of total_price values for reclassified rows. */
  reclassifiedFees: SupplierFees
  /** Descriptions of rows that were reclassified — for logging / debugging. */
  reclassifiedDescriptions: string[]
}

/**
 * Walk line_items, separate fee-shaped rows (Delivery/Shipping/etc.), and
 * sum their total_price into the matching `supplier_fees` bucket. Pure;
 * exported for unit tests.
 */
export function extractFeesFromLineItems(items: ParsedLineItem[]): FeeExtractionResult {
  const reclassified: SupplierFees = { delivery: 0, shipping: 0, processing: 0, other: 0 }
  const cleaned: ParsedLineItem[] = []
  const reclassifiedDescriptions: string[] = []

  for (const item of items) {
    const category = classifyFeeLineItem(item.description)
    if (category) {
      reclassified[category] += Math.max(0, item.total_price)
      reclassifiedDescriptions.push(item.description)
    } else {
      cleaned.push(item)
    }
  }

  // Round to cents to match what Vision would have produced if it classified
  // correctly upstream.
  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    cleanedLineItems: cleaned,
    reclassifiedFees: {
      delivery: round2(reclassified.delivery),
      shipping: round2(reclassified.shipping),
      processing: round2(reclassified.processing),
      other: round2(reclassified.other),
    },
    reclassifiedDescriptions,
  }
}

function normalizeVisionResponse(
  raw: RawVisionResponse,
  fileUrl: string
): ParsedInvoiceResult {
  void fileUrl // reserved for future use

  // Normalize line items
  const rawLineItems: ParsedLineItem[] = (raw.line_items ?? []).map((item, index) => ({
    line_number: Number(item.line_number ?? index + 1),
    description: String(item.description ?? 'Unknown Item').trim(),
    supplier_item_code: item.supplier_item_code ?? null,
    quantity: Math.max(0, Number(item.quantity ?? 0)),
    unit_price: Math.max(0, Number(item.unit_price ?? 0)),
    total_price: Math.max(0, Number(item.total_price ?? 0)),
    package_size: item.package_size ?? null,
    unit_type: item.unit_type ?? null,
    confidence: Math.min(1, Math.max(0, Number(item.confidence ?? 0.5))),
  }))

  // MOK-129: Vision occasionally classifies a fee row (e.g. Odeko's "Delivery
  // Fee") as a line_item instead of putting it in supplier_fees. Pre-MOK-129,
  // those rows survived into invoice_items and stage 4 raised a
  // no_item_match exception trying to match "Delivery Fee" against inventory.
  // Now we partition fee-shaped rows out before passing line_items downstream
  // and merge their totals into supplier_fees.
  const feeExtraction = extractFeesFromLineItems(rawLineItems)
  const lineItems = feeExtraction.cleanedLineItems
  if (feeExtraction.reclassifiedDescriptions.length > 0) {
    console.log(JSON.stringify({
      event: 'fees_reclassified_from_line_items',
      reclassified_descriptions: feeExtraction.reclassifiedDescriptions,
      delivery: feeExtraction.reclassifiedFees.delivery,
      shipping: feeExtraction.reclassifiedFees.shipping,
      processing: feeExtraction.reclassifiedFees.processing,
      other: feeExtraction.reclassifiedFees.other,
    }))
  }

  // Clamp overall confidence
  const overallConfidence = Math.min(
    1,
    Math.max(0, Number(raw.overall_confidence ?? 0.5))
  )

  // Normalize supplier fees — default missing keys to 0, clamp negatives to 0.
  // Type the empty fallback to match raw.supplier_fees so the property
  // accesses below type-check (Deno strict TS narrows `?? {}` to {} with
  // no fields).
  const rawFees: NonNullable<RawVisionResponse['supplier_fees']> =
    raw.supplier_fees ?? { delivery: null, shipping: null, processing: null, other: null }
  const supplierFees: SupplierFees = {
    // MOK-129: sum Vision's own supplier_fees with anything we reclassified
    // out of line_items above. If Vision somehow surfaced a fee in BOTH
    // places (rare), the sum here over-counts — accepted as a small noise
    // tradeoff vs. the bigger problem of fees being silently lost.
    delivery:   Math.max(0, Number(rawFees.delivery   ?? 0)) + feeExtraction.reclassifiedFees.delivery,
    shipping:   Math.max(0, Number(rawFees.shipping   ?? 0)) + feeExtraction.reclassifiedFees.shipping,
    processing: Math.max(0, Number(rawFees.processing ?? 0)) + feeExtraction.reclassifiedFees.processing,
    other:      Math.max(0, Number(rawFees.other      ?? 0)) + feeExtraction.reclassifiedFees.other,
  }
  const totalFees = Math.round(
    (supplierFees.delivery + supplierFees.shipping + supplierFees.processing + supplierFees.other) * 100
  ) / 100

  return {
    invoice_number: raw.invoice_number ?? null,
    invoice_date: raw.invoice_date ?? null,
    supplier_info: {
      name: raw.supplier_info?.name ?? null,
      address: raw.supplier_info?.address ?? null,
      phone: raw.supplier_info?.phone ?? null,
      email: raw.supplier_info?.email ?? null,
    },
    subtotal: raw.subtotal != null ? Number(raw.subtotal) : null,
    tax_amount: raw.tax_amount != null ? Number(raw.tax_amount) : null,
    total_amount: raw.total_amount != null ? Number(raw.total_amount) : null,
    supplier_fees: supplierFees,
    total_fees: totalFees,
    line_items: lineItems,
    overall_confidence: overallConfidence,
    extraction_method: 'vision',
  }
}
