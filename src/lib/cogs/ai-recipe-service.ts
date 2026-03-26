/**
 * AI Recipe Service
 *
 * Uses OpenRouter (openai/gpt-4o) to generate AI-estimated ingredient recipes
 * for Square catalog products based on product metadata and known inventory items.
 *
 * IMPORTANT: This service returns estimates only. It does NOT write to
 * cogs_product_recipes. Estimates require human approval via the approve endpoint
 * before being promoted to cogs_product_recipes.
 *
 * FR-16, FR-17 — P2 COGS
 */

// ============================================================
// Types
// ============================================================

export interface SquareProductInput {
  id: string           // Square product / cogs_products.id
  square_item_id: string
  name: string
  description?: string | null
  category?: string | null
  price_cents?: number | null  // price in cents for context
}

export interface InventoryItemCandidate {
  id: string           // inventory_items.id (UUID)
  item_name: string
  unit_type: string    // 'each' | 'lb' | 'oz' | 'gallon' | 'liter' | 'ml'
  unit_cost: number
  is_ingredient: boolean
  category?: string | null
}

export interface AiRecipeEstimate {
  inventory_item_id: string
  item_name: string
  quantity: number
  unit: string
  confidence: number           // 0.0–1.0 per ingredient
  is_ai_estimated: true        // always true; required by FR-17
  notes?: string
}

export interface AiRecipeEstimateResult {
  product_id: string
  product_name: string
  estimates: AiRecipeEstimate[]
  overall_confidence: number   // 0.0–1.0
  ai_reasoning?: string
  ai_model: string
  is_ai_estimated: true
}

// ============================================================
// OpenRouter client (Node.js/Next.js — NOT for Deno Edge Function)
// ============================================================

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_MODEL = 'openai/gpt-4o'

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

async function callOpenRouter(messages: OpenRouterMessage[]): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set')
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://cafe-pulse.mokesai.com',
      'X-Title': 'Cafe Pulse COGS AI Recipe Estimator',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,  // Low temperature for consistent structured output
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error')
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`)
  }

  return response.json() as Promise<OpenRouterResponse>
}

// ============================================================
// Recipe generation prompt
// ============================================================

function buildSystemPrompt(): string {
  return `You are an expert culinary cost analyst for cafe and restaurant operations.
Your task is to estimate the ingredients and quantities needed to produce menu items.
You will be given a menu item (name, description, category, price) and a list of available inventory items.
Return ONLY valid JSON matching the exact schema below. No markdown, no explanation.

OUTPUT SCHEMA:
{
  "estimates": [
    {
      "inventory_item_id": "<UUID from the provided inventory list>",
      "item_name": "<exact item_name from the provided inventory list>",
      "quantity": <number — how much of this ingredient per serving>,
      "unit": "<unit string — use the inventory item's unit_type or a sub-unit>",
      "confidence": <0.0–1.0 — how confident you are this ingredient is used>,
      "notes": "<optional brief note about why this ingredient was chosen>"
    }
  ],
  "overall_confidence": <0.0–1.0>,
  "reasoning": "<brief explanation of your ingredient choices>"
}

RULES:
- Only use inventory_item_id values from the provided candidate list.
- If an item clearly has no matching ingredients in the list, return an empty estimates array.
- Focus on ingredients with is_ingredient=true first.
- Use realistic cafe/coffee shop quantities (e.g., espresso ~18g, milk for latte ~180ml).
- overall_confidence reflects how well the product name/description maps to clear ingredients.
- Do NOT invent inventory_item_ids — they must match exactly from the provided candidates.`
}

function buildUserPrompt(
  product: SquareProductInput,
  candidates: InventoryItemCandidate[]
): string {
  const priceStr = product.price_cents != null
    ? `$${(product.price_cents / 100).toFixed(2)}`
    : 'unknown'

  const candidateList = candidates
    .map(c => `  - id: "${c.id}" | name: "${c.item_name}" | unit: ${c.unit_type} | cost: $${c.unit_cost.toFixed(4)} | is_ingredient: ${c.is_ingredient}${c.category ? ` | category: ${c.category}` : ''}`)
    .join('\n')

  return `MENU ITEM:
Name: ${product.name}
Description: ${product.description || 'none'}
Category: ${product.category || 'unknown'}
Price: ${priceStr}

AVAILABLE INVENTORY CANDIDATES:
${candidateList || '  (no candidates provided)'}

Estimate the recipe ingredients for ONE SERVING of this menu item using only the inventory candidates listed above.`
}

// ============================================================
// Parsing / validation
// ============================================================

interface RawEstimate {
  inventory_item_id?: unknown
  item_name?: unknown
  quantity?: unknown
  unit?: unknown
  confidence?: unknown
  notes?: unknown
}

interface RawAiResponse {
  estimates?: RawEstimate[]
  overall_confidence?: unknown
  reasoning?: unknown
}

function parseAndValidateEstimates(
  raw: RawAiResponse,
  candidates: InventoryItemCandidate[]
): AiRecipeEstimate[] {
  if (!Array.isArray(raw.estimates)) return []

  const candidateMap = new Map(candidates.map(c => [c.id, c]))
  const results: AiRecipeEstimate[] = []

  for (const e of raw.estimates) {
    if (e == null || typeof e !== 'object') continue

    const rawEstimate = e as RawEstimate
    const itemId = typeof rawEstimate.inventory_item_id === 'string'
      ? rawEstimate.inventory_item_id.trim()
      : null
    if (!itemId || !candidateMap.has(itemId)) continue  // reject hallucinated IDs

    const candidate = candidateMap.get(itemId)!
    const quantity = typeof rawEstimate.quantity === 'number' && rawEstimate.quantity > 0
      ? rawEstimate.quantity
      : null
    if (!quantity) continue

    const confidence = typeof rawEstimate.confidence === 'number'
      ? Math.max(0, Math.min(1, rawEstimate.confidence))
      : 0.5

    const notes = typeof rawEstimate.notes === 'string' && rawEstimate.notes.trim()
      ? rawEstimate.notes.trim()
      : undefined

    results.push({
      inventory_item_id: itemId,
      item_name: candidate.item_name,
      quantity,
      unit: typeof rawEstimate.unit === 'string' && rawEstimate.unit.trim()
        ? rawEstimate.unit.trim()
        : candidate.unit_type,
      confidence,
      is_ai_estimated: true,
      notes,
    })
  }

  return results
}

// ============================================================
// Main export — generateRecipeEstimates
// ============================================================

/**
 * Generate AI recipe estimates for a batch of products.
 *
 * @param products - Square products to estimate recipes for
 * @param candidates - Available inventory items (ingredient candidates)
 * @returns Array of recipe estimate results (one per product)
 *
 * NOTE: Does NOT write to any database. Returns estimates only.
 *       Human must approve via POST /api/admin/cogs/recipes/[id]/approve.
 */
export async function generateRecipeEstimates(
  products: SquareProductInput[],
  candidates: InventoryItemCandidate[]
): Promise<AiRecipeEstimateResult[]> {
  const results: AiRecipeEstimateResult[] = []

  // Process products sequentially to avoid rate limit bursts
  for (const product of products) {
    const result = await generateSingleRecipeEstimate(product, candidates)
    results.push(result)
  }

  return results
}

/**
 * Generate AI recipe estimate for a single product.
 */
export async function generateSingleRecipeEstimate(
  product: SquareProductInput,
  candidates: InventoryItemCandidate[]
): Promise<AiRecipeEstimateResult> {
  const messages: OpenRouterMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(product, candidates) },
  ]

  let raw: RawAiResponse = {}
  let aiReasoning: string | undefined

  try {
    const response = await callOpenRouter(messages)
    const content = response.choices?.[0]?.message?.content ?? '{}'

    try {
      raw = JSON.parse(content) as RawAiResponse
    } catch {
      console.warn('[ai-recipe-service] Failed to parse JSON response for product', product.id, content.slice(0, 200))
      raw = {}
    }

    if (response.usage) {
      console.log(JSON.stringify({
        event: 'ai_recipe_token_usage',
        product_id: product.id,
        product_name: product.name,
        model: OPENROUTER_MODEL,
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
        timestamp: new Date().toISOString(),
      }))
    }

    aiReasoning = typeof raw.reasoning === 'string' ? raw.reasoning.trim() : undefined
  } catch (err) {
    console.error('[ai-recipe-service] OpenRouter call failed for product', product.id, err)
    // Return empty result on error rather than throwing — let caller handle
    return {
      product_id: product.id,
      product_name: product.name,
      estimates: [],
      overall_confidence: 0,
      ai_reasoning: `Error generating estimate: ${err instanceof Error ? err.message : String(err)}`,
      ai_model: OPENROUTER_MODEL,
      is_ai_estimated: true,
    }
  }

  const estimates = parseAndValidateEstimates(raw, candidates)
  const overallConfidence = typeof raw.overall_confidence === 'number'
    ? Math.max(0, Math.min(1, raw.overall_confidence))
    : estimates.length > 0
      ? estimates.reduce((sum, e) => sum + e.confidence, 0) / estimates.length
      : 0

  return {
    product_id: product.id,
    product_name: product.name,
    estimates,
    overall_confidence: overallConfidence,
    ai_reasoning: aiReasoning,
    ai_model: OPENROUTER_MODEL,
    is_ai_estimated: true,
  }
}
