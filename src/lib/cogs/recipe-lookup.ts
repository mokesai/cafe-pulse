/**
 * Recipe Lookup Service
 *
 * Implements the lookup → estimate → create flow for COGS recipe resolution.
 *
 * When a product needs a recipe:
 *  1. Check cogs_product_recipes — return approved recipe if found
 *  2. Check ai_recipe_estimates (pending/approved) — return if exists (avoid duplicate AI calls)
 *  3. Call AI via generateSingleRecipeEstimate() — save to ai_recipe_estimates as 'pending'
 *
 * Does NOT write to cogs_product_recipes directly.
 * Human reviews estimates in /admin/cogs and approves via POST /api/admin/cogs/recipes/[id]/approve.
 *
 * MOK-79
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  generateSingleRecipeEstimate,
  type SquareProductInput,
  type InventoryItemCandidate,
  type AiRecipeEstimate,
} from './ai-recipe-service'

// ============================================================
// Types
// ============================================================

export type RecipeSource = 'approved' | 'ai_estimate_existing' | 'ai_estimate_new' | 'no_recipe'

export interface ApprovedRecipeLine {
  inventory_item_id: string
  item_name?: string
  qty: number
  unit: string
  loss_pct: number
}

export interface RecipeLookupResult {
  source: RecipeSource

  // Set when source === 'approved'
  recipe_id?: string
  recipe_lines?: ApprovedRecipeLine[]

  // Set when source includes 'ai_estimate'
  estimate_id?: string
  ai_estimates?: AiRecipeEstimate[]
  ai_confidence?: number
  ai_reasoning?: string

  // Always set
  product_id: string
  product_name: string
}

// ============================================================
// Helpers
// ============================================================

/**
 * Check if an approved recipe exists for a product.
 * Returns the most recent effective recipe, or null if none.
 */
async function lookupApprovedRecipe(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
): Promise<{ recipe_id: string; recipe_lines: ApprovedRecipeLine[] } | null> {
  const { data: recipes, error } = await supabase
    .from('cogs_product_recipes')
    .select('id, effective_from')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .order('effective_from', { ascending: false })
    .limit(1)

  if (error || !recipes || recipes.length === 0) return null

  const recipeId = recipes[0].id as string

  const { data: lines, error: linesError } = await supabase
    .from('cogs_product_recipe_lines')
    .select('inventory_item_id, qty, unit, loss_pct')
    .eq('recipe_id', recipeId)

  if (linesError) return null

  return {
    recipe_id: recipeId,
    recipe_lines: (lines ?? []).map(l => ({
      inventory_item_id: l.inventory_item_id as string,
      qty: Number(l.qty ?? 0),
      unit: String(l.unit ?? 'each'),
      loss_pct: Number(l.loss_pct ?? 0),
    })),
  }
}

type ExistingEstimate = {
  id: string
  estimated_ingredients: AiRecipeEstimate[]
  ai_confidence: number | null
  ai_reasoning: string | null
}

/**
 * Check if an AI estimate already exists for a product (pending or approved).
 */
async function lookupExistingEstimate(
  supabase: SupabaseClient,
  tenantId: string,
  squareProductId: string,
): Promise<ExistingEstimate | null> {
  const { data, error } = await supabase
    .from('ai_recipe_estimates')
    .select('id, estimated_ingredients, ai_confidence, ai_reasoning, review_status')
    .eq('tenant_id', tenantId)
    .eq('square_product_id', squareProductId)
    .in('review_status', ['pending', 'approved'])
    .order('generated_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null

  const row = data[0]
  return {
    id: row.id as string,
    estimated_ingredients: (row.estimated_ingredients as AiRecipeEstimate[]) ?? [],
    ai_confidence: row.ai_confidence != null ? Number(row.ai_confidence) : null,
    ai_reasoning: typeof row.ai_reasoning === 'string' ? row.ai_reasoning : null,
  }
}

/**
 * Save a new AI estimate to ai_recipe_estimates table.
 */
async function saveEstimate(
  supabase: SupabaseClient,
  tenantId: string,
  product: SquareProductInput,
  estimates: AiRecipeEstimate[],
  aiConfidence: number,
  aiReasoning: string | undefined,
  aiModel: string,
): Promise<string | null> {
  const ingredientRows = estimates.map(e => ({
    inventory_item_id: e.inventory_item_id,
    item_name: e.item_name,
    quantity: e.quantity,
    unit: e.unit,
    confidence: e.confidence,
    notes: e.notes,
  }))

  const { data, error } = await supabase
    .from('ai_recipe_estimates')
    .upsert(
      {
        tenant_id: tenantId,
        square_product_id: product.id,
        product_name: product.name,
        estimated_ingredients: ingredientRows,
        ai_model: aiModel,
        ai_confidence: aiConfidence,
        ai_reasoning: aiReasoning ?? null,
        review_status: 'pending',
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,square_product_id', ignoreDuplicates: false },
    )
    .select('id')

  if (error || !data || data.length === 0) {
    console.error('[recipe-lookup] Failed to save estimate:', error?.message)
    return null
  }

  return data[0].id as string
}

// ============================================================
// Main export
// ============================================================

/**
 * Fetch or estimate a recipe for a product.
 *
 * Lookup order:
 *  1. cogs_product_recipes (approved) → return immediately
 *  2. ai_recipe_estimates (pending/approved) → return without new AI call
 *  3. Call AI → save to ai_recipe_estimates → return estimate
 *
 * @param supabase     Service-role Supabase client (bypasses RLS)
 * @param tenantId     Tenant UUID
 * @param product      Product metadata (id = cogs_products.id, not square_item_id)
 * @param candidates   Available inventory items for AI to choose from
 */
export async function fetchOrEstimateRecipe(
  supabase: SupabaseClient,
  tenantId: string,
  product: SquareProductInput,
  candidates: InventoryItemCandidate[],
): Promise<RecipeLookupResult> {
  // Step 1: Check for approved recipe
  const approved = await lookupApprovedRecipe(supabase, tenantId, product.id)
  if (approved) {
    return {
      source: 'approved',
      recipe_id: approved.recipe_id,
      recipe_lines: approved.recipe_lines,
      product_id: product.id,
      product_name: product.name,
    }
  }

  // Step 2: Check for existing AI estimate (avoid duplicate calls)
  const existing = await lookupExistingEstimate(supabase, tenantId, product.square_item_id)
  if (existing) {
    return {
      source: 'ai_estimate_existing',
      estimate_id: existing.id,
      ai_estimates: existing.estimated_ingredients,
      ai_confidence: existing.ai_confidence ?? undefined,
      ai_reasoning: existing.ai_reasoning ?? undefined,
      product_id: product.id,
      product_name: product.name,
    }
  }

  // Step 3: No recipe or estimate — call AI
  const aiResult = await generateSingleRecipeEstimate(product, candidates)

  if (aiResult.estimates.length === 0) {
    // AI couldn't find ingredients — log and return no_recipe
    console.warn('[recipe-lookup] AI returned no estimates for', product.name, '—', aiResult.ai_reasoning)
    return {
      source: 'no_recipe',
      product_id: product.id,
      product_name: product.name,
      ai_reasoning: aiResult.ai_reasoning,
    }
  }

  // Save estimate to DB
  const estimateId = await saveEstimate(
    supabase,
    tenantId,
    product,
    aiResult.estimates,
    aiResult.overall_confidence,
    aiResult.ai_reasoning,
    aiResult.ai_model,
  )

  return {
    source: 'ai_estimate_new',
    estimate_id: estimateId ?? undefined,
    ai_estimates: aiResult.estimates,
    ai_confidence: aiResult.overall_confidence,
    ai_reasoning: aiResult.ai_reasoning,
    product_id: product.id,
    product_name: product.name,
  }
}

/**
 * Batch version: fetch or estimate recipes for multiple products.
 * Processes sequentially to avoid rate limit bursts.
 */
export async function fetchOrEstimateRecipes(
  supabase: SupabaseClient,
  tenantId: string,
  products: SquareProductInput[],
  candidates: InventoryItemCandidate[],
): Promise<RecipeLookupResult[]> {
  const results: RecipeLookupResult[] = []

  for (const product of products) {
    const result = await fetchOrEstimateRecipe(supabase, tenantId, product, candidates)
    results.push(result)
  }

  return results
}
