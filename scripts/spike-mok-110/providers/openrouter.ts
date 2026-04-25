/**
 * Thin OpenRouter client for the spike harness.
 *
 * Two entry points:
 *   - chatText: send a text-only prompt (used by workflow A and the text-fallback step)
 *   - chatPdf:  send a PDF as base64 (used by workflows B/C/D)
 *
 * For PDF requests, OpenRouter's file-parser plugin auto-rasterizes PDFs for
 * vision models that don't natively accept them (GPT-4o, Pixtral). Native-PDF
 * models (Claude, Gemini) consume the PDF directly without rasterization.
 *
 * Reference: https://openrouter.ai/docs/features/multimodal/pdfs
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { buildCacheKey, readCache, writeCache } from '../cache'
import { MODEL_PDF_NATIVE, MODEL_PRICING } from '../config'
import type { ModelSlug, TokenUsage } from '../types'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface OpenRouterCallResult {
  /** Parsed JSON content from the model (already JSON-parsed). */
  parsed: unknown
  /** Raw response body for caching. */
  raw: unknown
  tokenUsage: TokenUsage
  costUsd: number
  latencyMs: number
  /** True if served from disk cache (cost/latency reflect the original cold call). */
  cached?: boolean
}

export interface ChatTextInput {
  model: ModelSlug
  systemPrompt: string
  userText: string
}

export interface ChatPdfInput {
  model: ModelSlug
  systemPrompt: string
  pdfPath: string
  /**
   * Engine the file-parser plugin uses. If unset, picks 'native' for models
   * with native PDF support (Claude, Gemini) and 'mistral-ocr' otherwise.
   * 'pdf-text' is cheapest but only handles text-based PDFs (fails on scans).
   */
  parserEngine?: 'pdf-text' | 'mistral-ocr' | 'native'
}

function defaultParserEngine(model: ModelSlug): 'native' | 'mistral-ocr' {
  return MODEL_PDF_NATIVE[model] ? 'native' : 'mistral-ocr'
}

export async function chatText(input: ChatTextInput): Promise<OpenRouterCallResult> {
  const cacheKey = buildCacheKey({
    model: input.model,
    mode: 'text',
    systemPrompt: input.systemPrompt,
    userPayload: input.userText,
  })
  const cached = await readCache<OpenRouterCallResult>(cacheKey)
  if (cached) return { ...cached, cached: true }

  const result = await callOpenRouter({
    model: input.model,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.userText },
    ],
  })
  await writeCache(cacheKey, result)
  return result
}

export async function chatPdf(input: ChatPdfInput): Promise<OpenRouterCallResult> {
  const buffer = await readFile(input.pdfPath)
  const fileHash = createHash('sha256').update(buffer).digest('hex')
  const engine = input.parserEngine ?? defaultParserEngine(input.model)

  const cacheKey = buildCacheKey({
    model: input.model,
    mode: `pdf:${engine}`,
    systemPrompt: input.systemPrompt,
    userPayload: fileHash,
  })
  const cached = await readCache<OpenRouterCallResult>(cacheKey)
  if (cached) return { ...cached, cached: true }

  const base64 = buffer.toString('base64')
  const filename = basename(input.pdfPath)
  const dataUrl = `data:application/pdf;base64,${base64}`

  const result = await callOpenRouter({
    model: input.model,
    messages: [
      { role: 'system', content: input.systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract structured data from this invoice. Return only the JSON object per the system schema.' },
          { type: 'file', file: { filename, file_data: dataUrl } },
        ],
      },
    ],
    plugins: [
      {
        id: 'file-parser',
        pdf: { engine },
      },
    ],
  })
  await writeCache(cacheKey, result)
  return result
}

interface OpenRouterRequestBody {
  model: ModelSlug
  messages: Array<Record<string, unknown>>
  temperature?: number
  max_tokens?: number
  response_format?: { type: 'json_object' }
  plugins?: Array<Record<string, unknown>>
}

async function callOpenRouter(
  body: Omit<OpenRouterRequestBody, 'temperature' | 'max_tokens' | 'response_format'>
): Promise<OpenRouterCallResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set in environment')
  }

  const requestBody: OpenRouterRequestBody = {
    ...body,
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  }

  const startedAt = Date.now()
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://cafe-pulse.mokesai.com',
      'X-Title': 'CafePulse Invoice Pipeline Spike (MOK-110)',
    },
    body: JSON.stringify(requestBody),
  })
  const latencyMs = Date.now() - startedAt

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `OpenRouter error ${response.status}: ${errorText.slice(0, 500)}`
    )
  }

  const responseJson = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }

  const rawContent = responseJson?.choices?.[0]?.message?.content
  if (!rawContent) {
    throw new Error(`Empty response from OpenRouter (model=${body.model})`)
  }

  // Strip markdown code fences — Claude (and sometimes Gemini) ignore
  // response_format and wrap JSON in ```json ... ``` blocks.
  const stripped = stripCodeFences(rawContent)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (e) {
    throw new Error(
      `Invalid JSON from OpenRouter (model=${body.model}): ${String(e).slice(0, 200)}. ` +
        `Raw: ${rawContent.slice(0, 300)}`
    )
  }

  const tokenUsage: TokenUsage = {
    promptTokens: responseJson.usage?.prompt_tokens ?? 0,
    completionTokens: responseJson.usage?.completion_tokens ?? 0,
    totalTokens: responseJson.usage?.total_tokens ?? 0,
  }

  const pricing = MODEL_PRICING[body.model as ModelSlug]
  const costUsd = pricing
    ? (tokenUsage.promptTokens * pricing.promptUsdPer1M
        + tokenUsage.completionTokens * pricing.completionUsdPer1M) / 1_000_000
    : 0

  return {
    parsed,
    raw: responseJson,
    tokenUsage,
    costUsd,
    latencyMs,
  }
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim()
  // Match ```json\n...\n``` or ```\n...\n```
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  return m ? m[1].trim() : trimmed
}
