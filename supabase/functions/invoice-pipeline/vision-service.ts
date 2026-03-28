/**
 * Vision Service — GPT-4o Vision extraction via OpenRouter.
 *
 * Accepts image files and PDFs (via URL). For PDFs that Vision cannot
 * process directly, callers should use text extraction fallback.
 *
 * Architecture: §3.1, §3.2, §3.3
 * Runtime: Deno (Supabase Edge Function)
 * AI Provider: OpenRouter (https://openrouter.ai/api/v1)
 * Model: openai/gpt-4o
 */

import type { ParsedInvoiceResult, ParsedLineItem } from './context.ts'

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
 * Call GPT-4o Vision via OpenRouter with the invoice file URL.
 * Supports images (PNG/JPG/WEBP) and PDFs.
 *
 * For PDFs: passes URL directly. OpenRouter/GPT-4o will process
 * the document. If the model cannot handle the PDF format,
 * this will throw and the caller should fall back to text extraction.
 */
export async function extractInvoiceWithVision(
  input: VisionExtractionInput
): Promise<VisionExtractionOutput> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    throw new Error('[vision-service] OPENROUTER_API_KEY not set')
  }

  const baseUrl = 'https://openrouter.ai/api/v1'
  const model = 'openai/gpt-4o'

  // Build the content array for the Vision API call
  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: buildSystemPrompt(input.supplierName),
    },
  ]

  // Add the file as a vision input
  const fileType = input.fileType.toLowerCase()
  const mimeType = getMimeType(fileType)

  // Download the file from Supabase storage and convert to base64
  // This avoids issues with OpenRouter downloading from external URLs
  console.log(`[vision-service] Downloading file from ${input.fileUrl}`)
  
  let fileBase64: string
  try {
    const fileResponse = await fetch(input.fileUrl)
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: HTTP ${fileResponse.status}`)
    }
    const fileBuffer = await fileResponse.arrayBuffer()
    fileBase64 = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)))
  } catch (err) {
    throw new Error(`[vision-service] Failed to download file: ${String(err).slice(0, 200)}`)
  }

  // Pass file as base64 data URL to Vision API
  const dataUrl = `data:${mimeType};base64,${fileBase64}`
  
  content.push({
    type: 'image_url',
    image_url: {
      url: dataUrl,
      detail: 'high',
    },
  })

  const requestBody = {
    model,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
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
      `[vision-service] OpenRouter API error ${response.status}: ${errorText.slice(0, 300)}`
    )
  }

  const responseJson = await response.json()

  const rawContent = responseJson?.choices?.[0]?.message?.content
  if (!rawContent) {
    throw new Error('[vision-service] Empty response from OpenRouter Vision API')
  }

  // Parse and validate the JSON response
  let rawData: RawVisionResponse
  try {
    rawData = JSON.parse(rawContent) as RawVisionResponse
  } catch (e) {
    throw new Error(
      `[vision-service] Invalid JSON from Vision API: ${String(e).slice(0, 200)}. ` +
        `Raw: ${rawContent.slice(0, 300)}`
    )
  }

  // Normalize and validate the parsed data
  const parsed = normalizeVisionResponse(rawData, input.fileUrl)

  const tokenUsage = {
    promptTokens: responseJson?.usage?.prompt_tokens ?? 0,
    completionTokens: responseJson?.usage?.completion_tokens ?? 0,
    totalTokens: responseJson?.usage?.total_tokens ?? 0,
  }

  return { parsed, tokenUsage }
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
  usage: VisionExtractionOutput['tokenUsage']
): void {
  // Rough GPT-4o pricing: $5/1M prompt tokens, $15/1M completion tokens
  const estimatedCostUsd =
    usage.promptTokens * 0.000005 + usage.completionTokens * 0.000015

  console.log(
    JSON.stringify({
      event: 'vision_token_usage',
      invoice_id: invoiceId,
      tenant_id: tenantId,
      model: 'openai/gpt-4o',
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
  const nextjsBaseUrl = Deno.env.get('NEXTJS_BASE_URL')
  if (!nextjsBaseUrl) {
    throw new Error('[vision-service] NEXTJS_BASE_URL not set — cannot call text extraction route')
  }

  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')

  const url = `${nextjsBaseUrl}/api/admin/invoices/${invoiceId}/extract-text`

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
}`

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
      `[vision-service] OpenRouter text API error ${response.status}: ${errorText.slice(0, 300)}`
    )
  }

  const responseJson = await response.json()
  const rawContent = responseJson?.choices?.[0]?.message?.content
  if (!rawContent) {
    throw new Error('[vision-service] Empty response from OpenRouter text API')
  }

  const rawData = JSON.parse(rawContent) as RawVisionResponse
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
function normalizeVisionResponse(
  raw: RawVisionResponse,
  fileUrl: string
): ParsedInvoiceResult {
  void fileUrl // reserved for future use

  // Normalize line items
  const lineItems: ParsedLineItem[] = (raw.line_items ?? []).map((item, index) => ({
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

  // Clamp overall confidence
  const overallConfidence = Math.min(
    1,
    Math.max(0, Number(raw.overall_confidence ?? 0.5))
  )

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
    line_items: lineItems,
    overall_confidence: overallConfidence,
    extraction_method: 'vision',
  }
}
