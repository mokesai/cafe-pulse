#!/usr/bin/env node

/**
 * Estimate Sim Recipes
 *
 * Calls the AI recipe estimator for all cogs_products that lack an approved
 * recipe in cogs_product_recipes.
 *
 * This is the agentic alternative to manually seeding hardcoded recipes.
 * Results land in ai_recipe_estimates as 'pending' — a human reviews and approves
 * them via /admin/cogs before they affect COGS calculations.
 *
 * Usage:
 *   npx tsx scripts/estimate-sim-recipes.ts --dry-run
 *   npx tsx scripts/estimate-sim-recipes.ts
 *   npx tsx scripts/estimate-sim-recipes.ts --auto-approve   # test mode only
 *   npx tsx scripts/estimate-sim-recipes.ts --tenant <uuid>
 *
 * Flags:
 *   --dry-run           Print plan only; do not write anything
 *   --env <path>        Env file path (default: .env.local)
 *   --tenant <uuid>     Tenant ID (default: bigcafe — 4fa1cbbe-49ff-4cde-a686-8d34252945b4)
 *   --auto-approve      Auto-promote approved estimates to cogs_product_recipes (TEST ONLY)
 *   --force             Re-estimate products that already have a pending estimate
 *
 * Required env vars:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY
 *   OPENROUTER_API_KEY
 *
 * MOK-79
 */

import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  generateSingleRecipeEstimate,
  type SquareProductInput,
  type InventoryItemCandidate,
  type AiRecipeEstimate,
} from '../src/lib/cogs/ai-recipe-service'

// Bigcafe is the only tenant used for simulation
const BIGCAFE_TENANT_ID = '4fa1cbbe-49ff-4cde-a686-8d34252945b4'

// ============================================================
// CLI parsing
// ============================================================

type Options = {
  dryRun: boolean
  envPath: string
  tenantId: string
  autoApprove: boolean
  force: boolean
}

function parseArgs(argv: string[]): Options {
  const args = argv.slice(2)
  const flag = (name: string) => args.includes(name)
  const value = (name: string, fallback: string) => {
    const idx = args.indexOf(name)
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
  }

  return {
    dryRun: flag('--dry-run'),
    envPath: value('--env', '.env.local'),
    tenantId: value('--tenant', BIGCAFE_TENANT_ID),
    autoApprove: flag('--auto-approve'),
    force: flag('--force'),
  }
}

// ============================================================
// Supabase client
// ============================================================

function createSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY

  if (!url) throw new Error('Missing Supabase URL. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.')
  if (!key) throw new Error('Missing Supabase secret key. Set SUPABASE_SECRET_KEY.')

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ============================================================
// Helpers
// ============================================================

type CogsProduct = {
  id: string
  square_item_id: string
  name: string
  category: string | null
}

async function fetchProductsWithoutRecipes(
  supabase: SupabaseClient,
  tenantId: string,
  force: boolean,
): Promise<CogsProduct[]> {
  // All active products for this tenant
  const { data: products, error } = await supabase
    .from('cogs_products')
    .select('id, square_item_id, name, category')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (error) throw new Error(`Failed fetching cogs_products: ${error.message}`)
  if (!products || products.length === 0) return []

  const productIds = products.map(p => p.id as string)

  // Find products that already have an approved recipe
  const { data: existingRecipes, error: recipeError } = await supabase
    .from('cogs_product_recipes')
    .select('product_id')
    .eq('tenant_id', tenantId)
    .in('product_id', productIds)

  if (recipeError) throw new Error(`Failed fetching cogs_product_recipes: ${recipeError.message}`)

  const approvedProductIds = new Set((existingRecipes ?? []).map(r => r.product_id as string))

  // Unless --force, also skip products with existing pending estimates
  let pendingProductSquareIds = new Set<string>()
  if (!force) {
    const { data: existingEstimates, error: estimateError } = await supabase
      .from('ai_recipe_estimates')
      .select('square_product_id')
      .eq('tenant_id', tenantId)
      .in('review_status', ['pending', 'approved'])

    if (estimateError) throw new Error(`Failed fetching ai_recipe_estimates: ${estimateError.message}`)
    pendingProductSquareIds = new Set((existingEstimates ?? []).map(r => r.square_product_id as string))
  }

  const filtered = (products as CogsProduct[]).filter(p => {
    if (approvedProductIds.has(p.id)) return false  // already has approved recipe
    if (!force && pendingProductSquareIds.has(p.square_item_id)) return false  // already has estimate
    return true
  })

  return filtered
}

async function fetchInventoryCandidates(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<InventoryItemCandidate[]> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, item_name, unit_type, unit_cost, is_ingredient, category')
    .eq('tenant_id', tenantId)
    .order('item_name', { ascending: true })

  if (error) throw new Error(`Failed fetching inventory_items: ${error.message}`)

  return (data ?? []).map(item => ({
    id: item.id as string,
    item_name: item.item_name as string,
    unit_type: (item.unit_type as string) || 'each',
    unit_cost: typeof item.unit_cost === 'number' ? item.unit_cost : 0,
    is_ingredient: Boolean(item.is_ingredient),
    category: typeof item.category === 'string' ? item.category : undefined,
  }))
}

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

  if (error) throw new Error(`Failed saving estimate for "${product.name}": ${error.message}`)
  return (data?.[0]?.id as string) ?? null
}

async function promoteEstimateToRecipe(
  supabase: SupabaseClient,
  tenantId: string,
  estimateId: string,
  estimates: AiRecipeEstimate[],
  productId: string,
  productName: string,
  aiModel: string,
): Promise<string | null> {
  // Find or verify cogs_products entry
  const { data: product, error: productError } = await supabase
    .from('cogs_products')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .maybeSingle()

  if (productError || !product) {
    console.error(`  ⚠️  Could not find cogs_products entry for "${productName}"`)
    return null
  }

  const now = new Date().toISOString()
  const { data: recipe, error: recipeError } = await supabase
    .from('cogs_product_recipes')
    .insert({
      tenant_id: tenantId,
      product_id: productId,
      version: 1,
      effective_from: now,
      yield_qty: 1,
      yield_unit: 'each',
      notes: `AI-estimated recipe (auto-approved via estimate-sim-recipes --auto-approve). Model: ${aiModel}`,
    })
    .select('id')
    .single()

  if (recipeError || !recipe) {
    console.error(`  ⚠️  Failed creating recipe for "${productName}":`, recipeError?.message)
    return null
  }

  const recipeId = recipe.id as string

  const recipeLines = estimates.map(e => ({
    recipe_id: recipeId,
    inventory_item_id: e.inventory_item_id,
    qty: e.quantity,
    unit: e.unit,
    loss_pct: 0,
  }))

  const { error: linesError } = await supabase
    .from('cogs_product_recipe_lines')
    .insert(recipeLines)

  if (linesError) {
    // Rollback recipe
    await supabase.from('cogs_product_recipes').delete().eq('id', recipeId)
    console.error(`  ⚠️  Failed creating recipe lines for "${productName}":`, linesError.message)
    return null
  }

  // Mark estimate as approved
  await supabase
    .from('ai_recipe_estimates')
    .update({ review_status: 'approved', reviewed_at: now, promoted_recipe_id: recipeId })
    .eq('id', estimateId)

  return recipeId
}

// ============================================================
// Main
// ============================================================

async function main() {
  const options = parseArgs(process.argv)
  dotenv.config({ path: options.envPath })

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set. Cannot call AI for recipe estimation.')
  }

  if (options.autoApprove) {
    console.warn('\n⚠️  --auto-approve is active. Estimates will be promoted to cogs_product_recipes.')
    console.warn('   This flag is for TEST environments only. Do not use in production.\n')
  }

  const supabase = createSupabaseClient()

  console.log(`\nTenant: ${options.tenantId}`)
  console.log(`Mode: ${options.dryRun ? 'dry-run' : options.autoApprove ? 'estimate + auto-approve' : 'estimate only'}`)
  console.log(`Force re-estimate: ${options.force ? 'yes' : 'no'}`)

  // Step 1: Find products that need recipes
  console.log('\nFetching products without approved recipes...')
  const products = await fetchProductsWithoutRecipes(supabase, options.tenantId, options.force)

  if (products.length === 0) {
    console.log('All products already have approved recipes or pending estimates. Nothing to do.')
    console.log('Use --force to re-estimate products with pending estimates.')
    return
  }

  console.log(`Found ${products.length} product(s) needing recipe estimation:`)
  for (const p of products) {
    console.log(`  - ${p.name} (${p.square_item_id})`)
  }

  if (options.dryRun) {
    console.log('\nDry run complete. Remove --dry-run to generate estimates.')
    return
  }

  // Step 2: Fetch inventory candidates
  console.log('\nFetching inventory items as ingredient candidates...')
  const candidates = await fetchInventoryCandidates(supabase, options.tenantId)
  console.log(`  ${candidates.length} inventory items found (${candidates.filter(c => c.is_ingredient).length} flagged as ingredients)`)

  if (candidates.length === 0) {
    console.warn('⚠️  No inventory items found. AI will have no candidates to choose from.')
    console.warn('   Run seed-inventory first, or ensure inventory_items.is_ingredient = true on relevant items.')
  }

  // Step 3: Estimate recipes
  const summary = {
    estimated: 0,
    promoted: 0,
    empty: 0,
    errors: 0,
  }

  console.log('\nGenerating AI recipe estimates...')
  for (const product of products) {
    process.stdout.write(`  ${product.name}... `)

    const productInput: SquareProductInput = {
      id: product.id,
      square_item_id: product.square_item_id,
      name: product.name,
      category: product.category,
    }

    let aiResult
    try {
      aiResult = await generateSingleRecipeEstimate(productInput, candidates)
    } catch (err) {
      console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
      summary.errors++
      continue
    }

    if (aiResult.estimates.length === 0) {
      console.log(`NO ESTIMATES (confidence: ${aiResult.overall_confidence.toFixed(2)})`)
      if (aiResult.ai_reasoning) console.log(`    Reasoning: ${aiResult.ai_reasoning}`)
      summary.empty++
      continue
    }

    // Save to ai_recipe_estimates
    let estimateId: string | null = null
    try {
      estimateId = await saveEstimate(
        supabase,
        options.tenantId,
        productInput,
        aiResult.estimates,
        aiResult.overall_confidence,
        aiResult.ai_reasoning,
        aiResult.ai_model,
      )
    } catch (err) {
      console.error(`SAVE ERROR: ${err instanceof Error ? err.message : String(err)}`)
      summary.errors++
      continue
    }

    const ingredientSummary = aiResult.estimates
      .map(e => `${e.quantity}${e.unit} ${e.item_name}`)
      .join(', ')

    console.log(`✓ (confidence: ${aiResult.overall_confidence.toFixed(2)}, ingredients: ${aiResult.estimates.length})`)
    console.log(`    → ${ingredientSummary}`)

    summary.estimated++

    // Auto-approve if flag is set
    if (options.autoApprove && estimateId) {
      const recipeId = await promoteEstimateToRecipe(
        supabase,
        options.tenantId,
        estimateId,
        aiResult.estimates,
        product.id,
        product.name,
        aiResult.ai_model,
      )

      if (recipeId) {
        console.log(`    ✓ Auto-approved → cogs_product_recipes (${recipeId})`)
        summary.promoted++
      }
    }
  }

  // Summary
  console.log('\n────────────────────────────────')
  console.log('Recipe Estimation Summary')
  console.log('────────────────────────────────')
  console.log(`Products processed:   ${products.length}`)
  console.log(`Estimates created:    ${summary.estimated}`)
  if (options.autoApprove) {
    console.log(`Auto-promoted:        ${summary.promoted}`)
  }
  console.log(`No estimates (empty): ${summary.empty}`)
  console.log(`Errors:               ${summary.errors}`)

  if (!options.autoApprove && summary.estimated > 0) {
    console.log('\nNext steps:')
    console.log('  1. Go to /admin/cogs → Recipe queue to review AI estimates')
    console.log('  2. Approve recipes to include them in COGS calculations')
    console.log('  3. Or re-run with --auto-approve (test environments only)')
  }
}

main().catch(err => {
  console.error('\nFailed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
