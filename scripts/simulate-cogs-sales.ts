#!/usr/bin/env node

/**
 * COGS Sales Simulator
 *
 * Generates recent sales data for testing the /admin/cogs dashboard.
 *
 * Modes:
 *  - db: Insert synthetic orders directly into Supabase tables.
 *  - square: Create real Square sandbox orders (then run the existing sales sync).
 *
 * Usage:
 *  node scripts/simulate-cogs-sales.js --mode db --dry-run
 *  node scripts/simulate-cogs-sales.js --mode db --days 14 --orders-per-day 10 --include-modifiers
 *  node scripts/simulate-cogs-sales.js --mode square --orders 10 --scenario morningRush --include-modifiers
 *
 * Flags:
 *  --mode <db|square>            Default: db
 *  --dry-run                    Print plan only; do not write anywhere
 *  --seed <string>              Deterministic seed for repeatable runs (default: default)
 *  --env <path>                 Env file path (default: .env.local)
 *
 * db mode:
 *  --days <n>                    Days back from now (default: 14)
 *  --orders-per-day <n>          Orders per day (default: 10)
 *  --start-date <iso>            Optional start (inclusive); overrides --days
 *  --location <squareLocationId> Used for sales_transactions.location_id
 *  --scenario <name>             Default: morningRush (from scripts/config/square-simulator-config.js)
 *  --modifiers-file <path>       JSON file providing modifier pool
 *  --include-modifiers           Include modifiers in sales_transaction_items.metadata.modifiers
 *  --seed-cogs-only              Only seed cogs_products/cogs_sellables, no sales inserts
 *  --skip-seed-cogs              Do not seed cogs_products/cogs_sellables
 *  --estimate-recipes            After seeding cogs_products, call AI to estimate recipes for
 *                                products lacking one. Saves to ai_recipe_estimates (pending).
 *                                Requires OPENROUTER_API_KEY in env.
 *  --auto-approve-recipes        Auto-promote AI estimates to cogs_product_recipes (TEST ONLY)
 *
 * square mode:
 *  --orders <n>                  Number of orders to create (default: 8)
 *  --location <squareLocationId> Override Square location ID
 *  --scenario <name>             Default: morningRush
 *  --modifiers-file <path>       JSON file providing modifier pool (must contain real Square IDs)
 *  --include-modifiers           Include modifiers on Square line items (requires modifiers-file)
 *
 * Required env vars:
 *  db mode:
 *    SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *    SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY
 *    Note: DB inserts require the secret/service-role key due to RLS.
 *  square mode:
 *    SQUARE_ACCESS_TOKEN
 *    SQUARE_LOCATION_ID (or --location)
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createRequire } from 'module'
import { Client as SquareClient, Environment as SquareEnvironment } from 'square/legacy'
import {
  generateSingleRecipeEstimate,
  type SquareProductInput,
  type InventoryItemCandidate,
  type AiRecipeEstimate,
} from '../src/lib/cogs/ai-recipe-service'

// Bigcafe is the only tenant used for simulation
const BIGCAFE_TENANT_ID = '4fa1cbbe-49ff-4cde-a686-8d34252945b4'

type Mode = 'db' | 'square'

type SimulatorItem = {
  key: string
  name: string
  variationId: string
  category?: string
  inventoryImpact: 'manual' | 'auto'
}

type SimulatorScenario = {
  label: string
  description: string
  mix: Record<string, number>
}

type SimulatorConfig = {
  locationId: string
  currency: string
  items: SimulatorItem[]
  scenarios: Record<string, SimulatorScenario>
}

type ModifierPoolEntry = {
  catalog_object_id: string
  name: string
  chance?: number
}

type DbOptions = {
  mode: 'db'
  dryRun: boolean
  seed: string
  envPath: string
  days: number
  ordersPerDay: number
  startDate: string | null
  locationId: string
  scenario: string
  includeModifiers: boolean
  modifiersFile: string | null
  seedCogs: boolean
  seedCogsOnly: boolean
  estimateRecipes: boolean
  autoApproveRecipes: boolean
}

type SquareOptions = {
  mode: 'square'
  dryRun: boolean
  seed: string
  envPath: string
  scenario: string
  orders: number
  locationId: string
  includeModifiers: boolean
  modifiersFile: string | null
}

type Options = DbOptions | SquareOptions

type PlannedOrder = {
  squareOrderId: string
  orderedAt: string
  lineItems: PlannedLineItem[]
}

type PlannedLineItem = {
  catalogObjectId: string
  name: string
  quantity: number
  impactType: 'manual' | 'auto'
  modifiers: { catalog_object_id: string; name: string }[]
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function parseString(value: string | undefined, fallback: string) {
  if (!value) return fallback
  return value
}

function parseArgs(argv: string[]): Options {
  const args = argv.slice(2)
  const mode = (args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'db') as Mode

  const dryRun = args.includes('--dry-run')
  const seed = parseString(args.includes('--seed') ? args[args.indexOf('--seed') + 1] : undefined, 'default')
  const envPath = parseString(args.includes('--env') ? args[args.indexOf('--env') + 1] : undefined, '.env.local')
  const scenario = parseString(args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : undefined, 'morningRush')
  const locationId = parseString(args.includes('--location') ? args[args.indexOf('--location') + 1] : undefined, process.env.SQUARE_LOCATION_ID || '')
  const includeModifiers = args.includes('--include-modifiers')
  const modifiersFile = args.includes('--modifiers-file') ? args[args.indexOf('--modifiers-file') + 1] : null

  if (mode === 'square') {
    const orders = parsePositiveInt(args.includes('--orders') ? args[args.indexOf('--orders') + 1] : undefined, 8)
    return {
      mode,
      dryRun,
      seed,
      envPath,
      scenario,
      orders,
      locationId,
      includeModifiers,
      modifiersFile,
    }
  }

  const days = parsePositiveInt(args.includes('--days') ? args[args.indexOf('--days') + 1] : undefined, 14)
  const ordersPerDay = parsePositiveInt(
    args.includes('--orders-per-day') ? args[args.indexOf('--orders-per-day') + 1] : undefined,
    10,
  )
  const startDate = args.includes('--start-date') ? args[args.indexOf('--start-date') + 1] : null
  const seedCogs = !args.includes('--skip-seed-cogs')
  const seedCogsOnly = args.includes('--seed-cogs-only')
  const estimateRecipes = args.includes('--estimate-recipes')
  const autoApproveRecipes = args.includes('--auto-approve-recipes')

  return {
    mode: 'db',
    dryRun,
    seed,
    envPath,
    days,
    ordersPerDay,
    startDate,
    locationId,
    scenario,
    includeModifiers,
    modifiersFile,
    seedCogs,
    seedCogsOnly,
    estimateRecipes,
    autoApproveRecipes,
  }
}

function createSeededRng(seed: string) {
  const digest = crypto.createHash('sha256').update(seed).digest()
  const initial = digest.readUInt32LE(0)
  let state = initial

  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickWeightedKey(rng: () => number, mix: Record<string, number>) {
  const entries = Object.entries(mix)
  if (entries.length === 0) return null
  const total = entries.reduce((acc, [, weight]) => acc + weight, 0)
  if (total <= 0) return entries[0]?.[0] ?? null

  const target = rng() * total
  let cumulative = 0
  for (const [key, weight] of entries) {
    cumulative += weight
    if (target <= cumulative) return key
  }
  return entries[entries.length - 1]?.[0] ?? null
}

function loadSimulatorConfig(): SimulatorConfig {
  const require = createRequire(__filename)
  const { simulatorConfig } = require('./config/square-simulator-config') as { simulatorConfig: SimulatorConfig }
  return simulatorConfig
}

function loadModifierPool(modifiersFile: string | null): ModifierPoolEntry[] {
  if (!modifiersFile) return []
  const resolved = path.isAbsolute(modifiersFile)
    ? modifiersFile
    : path.join(process.cwd(), modifiersFile)
  const raw = fs.readFileSync(resolved, 'utf8')
  const parsed = JSON.parse(raw) as unknown

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid modifiers JSON: expected object')
  }

  const obj = parsed as Record<string, unknown>
  const list = obj.modifiers
  if (!Array.isArray(list)) {
    throw new Error('Invalid modifiers JSON: expected { "modifiers": [...] }')
  }

  const entries: ModifierPoolEntry[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const catalogObjectId = typeof e.catalog_object_id === 'string' ? e.catalog_object_id : null
    const name = typeof e.name === 'string' ? e.name : null
    if (!catalogObjectId || !name) continue
    const chance = typeof e.chance === 'number' && Number.isFinite(e.chance) ? e.chance : undefined
    entries.push({ catalog_object_id: catalogObjectId, name, chance })
  }

  return entries
}

function getDefaultModifierPool(): ModifierPoolEntry[] {
  return [
    { catalog_object_id: 'SIM-MOD-OAT-MILK', name: 'Oat Milk', chance: 0.25 },
    { catalog_object_id: 'SIM-MOD-ALMOND-MILK', name: 'Almond Milk', chance: 0.12 },
    { catalog_object_id: 'SIM-MOD-EXTRA-SHOT', name: 'Extra Espresso Shot', chance: 0.18 },
    { catalog_object_id: 'SIM-MOD-VANILLA', name: 'Vanilla Syrup', chance: 0.15 },
    { catalog_object_id: 'SIM-MOD-CARAMEL', name: 'Caramel Syrup', chance: 0.1 },
  ]
}

function planModifiersForLineItem(
  rng: () => number,
  includeModifiers: boolean,
  pool: ModifierPoolEntry[],
): { catalog_object_id: string; name: string }[] {
  if (!includeModifiers) return []
  if (pool.length === 0) return []

  const selected: { catalog_object_id: string; name: string }[] = []
  for (const entry of pool) {
    const chance = entry.chance ?? 0.15
    if (rng() <= chance) {
      selected.push({ catalog_object_id: entry.catalog_object_id, name: entry.name })
    }
  }

  return selected.slice(0, 3)
}

function buildPlannedOrdersForDb(options: DbOptions, config: SimulatorConfig, pool: ModifierPoolEntry[]) {
  const rng = createSeededRng(`db:${options.seed}:${options.scenario}`)
  const scenario = config.scenarios[options.scenario]
  if (!scenario) {
    const available = Object.keys(config.scenarios).sort().join(', ')
    throw new Error(`Unknown scenario "${options.scenario}". Available: ${available}`)
  }

  const itemsByKey = new Map(config.items.map(item => [item.key, item]))
  const start = options.startDate ? new Date(options.startDate) : new Date(Date.now() - options.days * 24 * 60 * 60 * 1000)
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid --start-date "${options.startDate}"`)
  }

  const orders: PlannedOrder[] = []
  const totalOrders = options.days * options.ordersPerDay
  for (let index = 0; index < totalOrders; index += 1) {
    const dayOffset = Math.floor(index / options.ordersPerDay)
    const day = new Date(start.getTime() + dayOffset * 24 * 60 * 60 * 1000)
    day.setHours(7 + Math.floor(rng() * 10), Math.floor(rng() * 60), Math.floor(rng() * 60), 0)

    const orderId = `SIM-COGS-${options.seed}-${day.toISOString().slice(0, 10)}-${String(index + 1).padStart(4, '0')}`
    const lineCount = 1 + Math.floor(rng() * 3)

    const lineItems: PlannedLineItem[] = []
    for (let li = 0; li < lineCount; li += 1) {
      const key = pickWeightedKey(rng, scenario.mix)
      if (!key) continue
      const template = itemsByKey.get(key)
      if (!template?.variationId) continue

      const quantity = 1 + Math.floor(rng() * 3)
      const modifiers = planModifiersForLineItem(rng, options.includeModifiers, pool)

      lineItems.push({
        catalogObjectId: template.variationId,
        name: template.name,
        quantity,
        impactType: template.inventoryImpact,
        modifiers,
      })
    }

    if (lineItems.length === 0) continue
    orders.push({
      squareOrderId: orderId,
      orderedAt: day.toISOString(),
      lineItems,
    })
  }

  return { orders, scenario }
}

function summarizePlannedOrders(orders: PlannedOrder[]) {
  const orderCount = orders.length
  const itemCount = orders.reduce((acc, order) => acc + order.lineItems.length, 0)
  const modifierCount = orders.reduce((acc, order) => acc + order.lineItems.reduce((a, li) => a + li.modifiers.length, 0), 0)
  const sampleOrder = orders[0]

  console.log('\nSimulation Summary')
  console.log('------------------')
  console.log(`Orders: ${orderCount}`)
  console.log(`Line items: ${itemCount}`)
  console.log(`Modifiers attached: ${modifierCount}`)

  if (sampleOrder) {
    console.log('\nSample order:')
    console.log(`  squareOrderId: ${sampleOrder.squareOrderId}`)
    console.log(`  orderedAt: ${sampleOrder.orderedAt}`)
    console.log(`  lineItems: ${sampleOrder.lineItems.length}`)
  }
}

function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY

  if (!url) {
    throw new Error('Missing Supabase URL. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).')
  }
  if (!serviceKey) {
    throw new Error(
      'Missing Supabase secret key. Set SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY.',
    )
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

async function fetchExistingOrderIds(supabase: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return new Set<string>()
  const existing = new Set<string>()

  const chunkSize = 200
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const { data, error } = await supabase
      .from('sales_transactions')
      .select('square_order_id')
      .in('square_order_id', chunk)

    if (error) throw new Error(`Failed checking existing sales_transactions: ${error.message}`)
    for (const row of data ?? []) {
      if (row.square_order_id) existing.add(row.square_order_id)
    }
  }

  return existing
}

async function seedCogsCatalogForSimulator(supabase: SupabaseClient, config: SimulatorConfig, seed: string, tenantId: string = BIGCAFE_TENANT_ID) {
  const templates = config.items.filter(item => item.variationId && item.key && item.name)
  if (templates.length === 0) return

  const productRows = templates.map(item => ({
    tenant_id: tenantId,
    square_item_id: `SIM-COGS-ITEM-${seed}-${item.key}`,
    name: item.name,
    category: item.category ?? null,
    is_active: true,
  }))

  const { data: upsertedProducts, error: productError } = await supabase
    .from('cogs_products')
    .upsert(productRows, { onConflict: 'tenant_id,square_item_id' })
    .select('id,square_item_id')

  if (productError) throw new Error(`Failed seeding cogs_products: ${productError.message}`)

  const productIdBySquareItemId = new Map<string, string>()
  for (const row of upsertedProducts ?? []) {
    if (row.square_item_id && row.id) productIdBySquareItemId.set(row.square_item_id, row.id)
  }

  const sellableRows = templates.flatMap(item => {
    const squareItemId = `SIM-COGS-ITEM-${seed}-${item.key}`
    const productId = productIdBySquareItemId.get(squareItemId)
    if (!productId) return []
    return [
      {
        tenant_id: tenantId,
        square_variation_id: item.variationId,
        product_id: productId,
        name: item.name,
        is_active: true,
      },
    ]
  })

  const { error: sellableError } = await supabase
    .from('cogs_sellables')
    .upsert(sellableRows, { onConflict: 'tenant_id,square_variation_id' })

  if (sellableError) throw new Error(`Failed seeding cogs_sellables: ${sellableError.message}`)
}

// ============================================================
// AI Recipe Estimation (MOK-79)
// ============================================================

async function estimateRecipesForSimulatedProducts(
  supabase: SupabaseClient,
  config: SimulatorConfig,
  seed: string,
  autoApprove: boolean,
  tenantId: string = BIGCAFE_TENANT_ID,
) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('\n⚠️  --estimate-recipes skipped: OPENROUTER_API_KEY is not set.')
    return
  }

  if (autoApprove) {
    console.warn('\n⚠️  --auto-approve-recipes: estimates will be promoted to cogs_product_recipes (TEST ONLY).')
  }

  console.log('\nEstimating recipes for simulated products...')

  // Find all cogs_products seeded for this simulation run
  const squareItemIds = config.items.map(item => `SIM-COGS-ITEM-${seed}-${item.key}`)

  const { data: products, error: productError } = await supabase
    .from('cogs_products')
    .select('id, square_item_id, name, category')
    .eq('tenant_id', tenantId)
    .in('square_item_id', squareItemIds)

  if (productError) {
    console.error('  Failed to fetch products for estimation:', productError.message)
    return
  }

  if (!products || products.length === 0) {
    console.log('  No products found for estimation.')
    return
  }

  // Find products already covered by a recipe
  const productIds = products.map(p => p.id as string)
  const { data: existingRecipes } = await supabase
    .from('cogs_product_recipes')
    .select('product_id')
    .eq('tenant_id', tenantId)
    .in('product_id', productIds)

  const coveredIds = new Set((existingRecipes ?? []).map(r => r.product_id as string))

  // Skip products with pending estimates too (avoid duplicate AI calls)
  const { data: existingEstimates } = await supabase
    .from('ai_recipe_estimates')
    .select('square_product_id')
    .eq('tenant_id', tenantId)
    .in('review_status', ['pending', 'approved'])

  const estimatedIds = new Set((existingEstimates ?? []).map(r => r.square_product_id as string))

  const toEstimate = (products as Array<{ id: string; square_item_id: string; name: string; category: string | null }>)
    .filter(p => !coveredIds.has(p.id) && !estimatedIds.has(p.square_item_id))

  if (toEstimate.length === 0) {
    console.log('  All products already have recipes or pending estimates.')
    return
  }

  console.log(`  ${toEstimate.length} product(s) need recipe estimation.`)

  // Fetch inventory candidates
  const { data: inventoryItems, error: invError } = await supabase
    .from('inventory_items')
    .select('id, item_name, unit_type, unit_cost, is_ingredient, category')
    .eq('tenant_id', tenantId)
    .order('item_name', { ascending: true })

  if (invError) {
    console.error('  Failed to fetch inventory items:', invError.message)
    return
  }

  const candidates: InventoryItemCandidate[] = (inventoryItems ?? []).map(item => ({
    id: item.id as string,
    item_name: item.item_name as string,
    unit_type: (item.unit_type as string) || 'each',
    unit_cost: typeof item.unit_cost === 'number' ? item.unit_cost : 0,
    is_ingredient: Boolean(item.is_ingredient),
    category: typeof item.category === 'string' ? item.category : undefined,
  }))

  if (candidates.length === 0) {
    console.warn('  ⚠️  No inventory items found as candidates. Skipping estimation.')
    console.warn('     Run seed-inventory first, or set is_ingredient=true on inventory items.')
    return
  }

  console.log(`  ${candidates.length} inventory candidates (${candidates.filter(c => c.is_ingredient).length} flagged as ingredients)`)

  let estimated = 0
  let promoted = 0
  let empty = 0

  for (const product of toEstimate) {
    const productInput: SquareProductInput = {
      id: product.id,
      square_item_id: product.square_item_id,
      name: product.name,
      category: product.category,
    }

    process.stdout.write(`  ${product.name}... `)

    let aiResult
    try {
      aiResult = await generateSingleRecipeEstimate(productInput, candidates)
    } catch (err) {
      console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    if (aiResult.estimates.length === 0) {
      console.log(`no estimates (conf: ${aiResult.overall_confidence.toFixed(2)})`)
      empty++
      continue
    }

    // Save to ai_recipe_estimates
    const ingredientRows = aiResult.estimates.map(e => ({
      inventory_item_id: e.inventory_item_id,
      item_name: e.item_name,
      quantity: e.quantity,
      unit: e.unit,
      confidence: e.confidence,
      notes: e.notes,
    }))

    const { data: saved, error: saveError } = await supabase
      .from('ai_recipe_estimates')
      .upsert(
        {
          tenant_id: tenantId,
          square_product_id: product.id,
          product_name: product.name,
          estimated_ingredients: ingredientRows,
          ai_model: aiResult.ai_model,
          ai_confidence: aiResult.overall_confidence,
          ai_reasoning: aiResult.ai_reasoning ?? null,
          review_status: 'pending',
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,square_product_id', ignoreDuplicates: false },
      )
      .select('id')

    if (saveError || !saved || saved.length === 0) {
      console.error(`SAVE ERROR: ${saveError?.message}`)
      continue
    }

    const estimateId = saved[0].id as string
    console.log(`✓ conf:${aiResult.overall_confidence.toFixed(2)} ingredients:${aiResult.estimates.length}`)
    estimated++

    // Auto-approve if requested (test mode only)
    if (autoApprove) {
      const now = new Date().toISOString()
      const { data: recipe, error: recipeError } = await supabase
        .from('cogs_product_recipes')
        .insert({
          tenant_id: tenantId,
          product_id: product.id,
          version: 1,
          effective_from: now,
          yield_qty: 1,
          yield_unit: 'each',
          notes: `AI-estimated (auto-approved via --auto-approve-recipes). Model: ${aiResult.ai_model}`,
        })
        .select('id')
        .single()

      if (recipeError || !recipe) {
        console.error(`  ⚠️  Recipe insert failed: ${recipeError?.message}`)
        continue
      }

      const recipeId = recipe.id as string
      const recipeLines = aiResult.estimates.map((e: AiRecipeEstimate) => ({
        recipe_id: recipeId,
        inventory_item_id: e.inventory_item_id,
        qty: e.quantity,
        unit: e.unit,
        loss_pct: 0,
      }))

      const { error: linesError } = await supabase.from('cogs_product_recipe_lines').insert(recipeLines)

      if (linesError) {
        await supabase.from('cogs_product_recipes').delete().eq('id', recipeId)
        console.error(`  ⚠️  Recipe lines insert failed: ${linesError.message}`)
        continue
      }

      await supabase
        .from('ai_recipe_estimates')
        .update({ review_status: 'approved', reviewed_at: now, promoted_recipe_id: recipeId })
        .eq('id', estimateId)

      console.log(`    → auto-promoted to cogs_product_recipes (${recipeId})`)
      promoted++
    }
  }

  console.log(`\n  Recipe estimation complete: ${estimated} estimated, ${promoted} auto-promoted, ${empty} empty.`)

  if (!autoApprove && estimated > 0) {
    console.log('  → Review estimates in /admin/cogs to approve and include in COGS calculations.')
  }
}

async function insertDbSimulation(options: DbOptions, config: SimulatorConfig, pool: ModifierPoolEntry[]) {
  if (!options.locationId) {
    throw new Error('Missing Square location ID. Provide SQUARE_LOCATION_ID or --location.')
  }

  const { orders, scenario } = buildPlannedOrdersForDb(options, config, pool)
  console.log(`\nMode: db`)
  console.log(`Scenario: ${scenario.label}`)
  console.log(`Location: ${options.locationId}`)
  summarizePlannedOrders(orders)

  if (options.dryRun) {
    console.log('\nDry run complete. Remove --dry-run to insert into Supabase.')
    return
  }

  const supabase = createSupabaseServiceClient()

  if (options.seedCogs) {
    console.log('\nSeeding cogs_products + cogs_sellables from simulator config...')
    await seedCogsCatalogForSimulator(supabase, config, options.seed)
    console.log('COGS catalog seeded.')

    // If --estimate-recipes, trigger AI estimation for products without recipes
    if (options.estimateRecipes) {
      await estimateRecipesForSimulatedProducts(supabase, config, options.seed, options.autoApproveRecipes)
    }

    if (options.seedCogsOnly) {
      console.log('\nSeed-only mode complete. (No sales inserted.)')
      return
    }
  }

  const existing = await fetchExistingOrderIds(supabase, orders.map(order => order.squareOrderId))
  const newOrders = orders.filter(order => !existing.has(order.squareOrderId))

  if (newOrders.length === 0) {
    console.log('\nNo new orders to insert (all already exist).')
    return
  }

  console.log(`\nInserting ${newOrders.length} sales_transactions...`)

  const insertedTx = new Map<string, string>()
  const txChunkSize = 50
  for (let i = 0; i < newOrders.length; i += txChunkSize) {
    const chunk = newOrders.slice(i, i + txChunkSize)
    const rows = chunk.map(order => ({
      square_order_id: order.squareOrderId,
      location_id: options.locationId,
      ordered_at: order.orderedAt,
      raw_payload: {
        source: 'simulate-cogs-sales',
        square_order_id: order.squareOrderId,
        ordered_at: order.orderedAt,
        line_items: order.lineItems.map(li => ({
          catalog_object_id: li.catalogObjectId,
          name: li.name,
          quantity: li.quantity,
          modifiers: li.modifiers,
        })),
      },
    }))

    const { data, error } = await supabase.from('sales_transactions').insert(rows).select('id,square_order_id')
    if (error) throw new Error(`Failed inserting sales_transactions: ${error.message}`)

    for (const row of data ?? []) {
      if (row.square_order_id && row.id) insertedTx.set(row.square_order_id, row.id)
    }
  }

  const itemsToInsert = newOrders.flatMap(order => {
    const transactionId = insertedTx.get(order.squareOrderId)
    if (!transactionId) return []

    return order.lineItems.map(li => ({
      transaction_id: transactionId,
      inventory_item_id: null,
      square_catalog_object_id: li.catalogObjectId,
      name: li.name,
      quantity: li.quantity,
      impact_type: li.impactType,
      impact_reason: 'simulated',
      metadata: {
        source: 'simulate-cogs-sales',
        modifiers: li.modifiers,
      },
      created_at: order.orderedAt,
    }))
  })

  console.log(`Inserting ${itemsToInsert.length} sales_transaction_items...`)
  const itemChunkSize = 250
  for (let i = 0; i < itemsToInsert.length; i += itemChunkSize) {
    const chunk = itemsToInsert.slice(i, i + itemChunkSize)
    const { error } = await supabase.from('sales_transaction_items').insert(chunk)
    if (error) throw new Error(`Failed inserting sales_transaction_items: ${error.message}`)
  }

  console.log('\nDB simulation inserted successfully.')
}

async function createSquareClient() {
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    throw new Error('SQUARE_ACCESS_TOKEN missing in environment')
  }

  const env = (process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox

  return new SquareClient({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: env,
  })
}

async function squareCreateOrder(options: SquareOptions, config: SimulatorConfig, pool: ModifierPoolEntry[]) {
  if (!options.locationId) {
    throw new Error('Missing Square location ID. Provide SQUARE_LOCATION_ID or --location.')
  }

  const scenario = config.scenarios[options.scenario]
  if (!scenario) {
    const available = Object.keys(config.scenarios).sort().join(', ')
    throw new Error(`Unknown scenario "${options.scenario}". Available: ${available}`)
  }

  if (options.includeModifiers && pool.length === 0) {
    throw new Error('--include-modifiers requires --modifiers-file in square mode (real Square modifier IDs).')
  }

  const rng = createSeededRng(`square:${options.seed}:${options.scenario}`)
  const itemsByKey = new Map(config.items.map(item => [item.key, item]))

  console.log(`\nMode: square`)
  console.log(`Scenario: ${scenario.label}`)
  console.log(`Location: ${options.locationId}`)
  console.log(`Orders planned: ${options.orders}`)
  console.log(`Dry run: ${options.dryRun ? 'yes' : 'no'}`)

  const plannedOrders: PlannedOrder[] = []
  for (let index = 0; index < options.orders; index += 1) {
    const orderId = `SIM-COGS-SQUARE-${options.seed}-${String(index + 1).padStart(4, '0')}`
    const lineCount = 1 + Math.floor(rng() * 3)

    const lineItems: PlannedLineItem[] = []
    for (let li = 0; li < lineCount; li += 1) {
      const key = pickWeightedKey(rng, scenario.mix)
      if (!key) continue
      const template = itemsByKey.get(key)
      if (!template?.variationId) continue
      const quantity = 1 + Math.floor(rng() * 3)
      const modifiers = planModifiersForLineItem(rng, options.includeModifiers, pool)

      lineItems.push({
        catalogObjectId: template.variationId,
        name: template.name,
        quantity,
        impactType: template.inventoryImpact,
        modifiers,
      })
    }

    if (lineItems.length === 0) continue
    plannedOrders.push({
      squareOrderId: orderId,
      orderedAt: new Date().toISOString(),
      lineItems,
    })
  }

  summarizePlannedOrders(plannedOrders)

  if (options.dryRun) {
    console.log('\nDry run complete. Remove --dry-run to create orders in Square.')
    return
  }

  const client = await createSquareClient()
  const ordersApi = client.ordersApi
  const paymentsApi = client.paymentsApi

  for (const [idx, order] of plannedOrders.entries()) {
    const number = idx + 1
    console.log(`\nCreating Square order ${number}/${plannedOrders.length}...`)

    const lineItems = order.lineItems.map(li => ({
      catalogObjectId: li.catalogObjectId,
      quantity: String(li.quantity),
      modifiers: li.modifiers.map(mod => ({
        catalogObjectId: mod.catalog_object_id,
        name: mod.name,
      })),
      name: li.name,
    }))

    const { result } = await ordersApi.createOrder({
      idempotencyKey: crypto.randomUUID(),
      order: {
        locationId: options.locationId,
        referenceId: order.squareOrderId,
        lineItems,
      },
    })

    const createdOrderId = result.order?.id
    if (!createdOrderId) {
      throw new Error('Square createOrder succeeded but order ID was missing')
    }

    console.log(`   Order ID: ${createdOrderId}`)

    const total = result.order?.netAmountDueMoney?.amount ?? result.order?.totalMoney?.amount
    if (!total) throw new Error(`Unable to determine order total for order ${createdOrderId}`)

    const paymentResult = await paymentsApi.createPayment({
      idempotencyKey: crypto.randomUUID(),
      sourceId: 'CASH',
      amountMoney: {
        amount: total,
        currency: config.currency,
      },
      orderId: createdOrderId,
      cashDetails: {
        buyerSuppliedMoney: {
          amount: total,
          currency: config.currency,
        },
      },
    })

    const paymentId = paymentResult.result.payment?.id
    if (paymentId) console.log(`   Payment ID: ${paymentId}`)
  }

  console.log('\nSquare simulation finished successfully. Now run /admin/inventory → sync-square-sales to ingest.')
}

async function main() {
  const options = parseArgs(process.argv)
  dotenv.config({ path: options.envPath })

  const config = loadSimulatorConfig()
  let pool = loadModifierPool(options.modifiersFile)
  if (options.mode === 'db' && options.includeModifiers && pool.length === 0) {
    pool = getDefaultModifierPool()
  }

  if (options.mode === 'db') {
    await insertDbSimulation(options, config, pool)
    return
  }

  await squareCreateOrder(options, config, pool)
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('\nSimulation failed:', message)
  if (error instanceof Error && error.stack) {
    console.error(error.stack)
  }
  process.exit(1)
})
