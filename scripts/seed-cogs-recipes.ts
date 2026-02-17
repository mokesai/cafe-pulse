#!/usr/bin/env node

/**
 * Seeds realistic base recipes and modifier recipes for COGS testing.
 *
 * - Base recipes: cogs_product_recipes + cogs_product_recipe_lines
 * - Modifier recipes: cogs_modifier_sets/options + cogs_modifier_option_recipes + lines
 *
 * Usage:
 *  node scripts/seed-cogs-recipes.js --dry-run
 *  node scripts/seed-cogs-recipes.js
 *  node scripts/seed-cogs-recipes.js --seed default --products-only
 *  node scripts/seed-cogs-recipes.js --modifiers-only --force
 *
 * Flags:
 *  --dry-run              Print plan only (no writes)
 *  --env <path>           Env file path (default: .env.local)
 *  --seed <string>        Seed namespace for SIM-COGS items (default: default)
 *  --strict               Fail if required inventory items are missing
 *  --force                Insert a new version even if one exists
 *  --products-only        Only seed product base recipes
 *  --modifiers-only       Only seed modifier option recipes
 *
 * Required env vars:
 *  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *  SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY
 */

import crypto from 'crypto'
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

type Unit = 'each' | 'lb' | 'oz' | 'gallon' | 'liter' | 'ml'

type Options = {
  dryRun: boolean
  envPath: string
  seed: string
  strict: boolean
  force: boolean
  productsOnly: boolean
  modifiersOnly: boolean
}

type InventoryItem = {
  id: string
  item_name: string
  unit_type: Unit
  unit_cost: number
}

type CogsProduct = {
  id: string
  square_item_id: string
  name: string
}

type RecipeLineSpec = {
  label: string
  candidates: string[]
  amount: { qty: number; unit: Unit }
  loss_pct: number
}

type ModifierSpec = {
  setKey: string
  setName: string
  options: Array<{
    square_modifier_id: string
    name: string
    recipeLines: RecipeLineSpec[]
  }>
}

function parseString(value: string | undefined, fallback: string) {
  if (!value) return fallback
  return value
}

function parseArgs(argv: string[]): Options {
  const args = argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const envPath = parseString(args.includes('--env') ? args[args.indexOf('--env') + 1] : undefined, '.env.local')
  const seed = parseString(args.includes('--seed') ? args[args.indexOf('--seed') + 1] : undefined, 'default')
  const strict = args.includes('--strict')
  const force = args.includes('--force')
  const productsOnly = args.includes('--products-only')
  const modifiersOnly = args.includes('--modifiers-only')

  if (productsOnly && modifiersOnly) {
    throw new Error('Use at most one of --products-only or --modifiers-only')
  }

  return {
    dryRun,
    envPath,
    seed,
    strict,
    force,
    productsOnly,
    modifiersOnly,
  }
}

function toUnit(value: unknown): Unit | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v === 'each' || v === 'lb' || v === 'oz' || v === 'gallon' || v === 'liter' || v === 'ml') return v
  return null
}

function convert(qty: number, from: Unit, to: Unit): number | null {
  if (!Number.isFinite(qty)) return null
  if (from === to) return qty

  if (from === 'lb' && to === 'oz') return qty * 16
  if (from === 'oz' && to === 'lb') return qty / 16

  // volume conversions via ml
  const toMl: Record<Unit, number | null> = {
    each: null,
    lb: null,
    oz: 29.5735295625,
    gallon: 3785.411784,
    liter: 1000,
    ml: 1,
  }
  const fromFactor = toMl[from]
  const toFactor = toMl[to]
  if (fromFactor && toFactor) {
    const inMl = qty * fromFactor
    return inMl / toFactor
  }

  return null
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function scoreMatch(name: string, candidates: string[]) {
  const hay = normalize(name)
  let score = 0
  for (const needleRaw of candidates) {
    const needle = normalize(needleRaw)
    if (!needle) continue
    if (hay === needle) score += 30
    if (hay.includes(needle)) score += 20
    for (const token of needle.split(' ')) {
      if (!token) continue
      if (hay.includes(token)) score += 4
    }
  }
  return score
}

function findBestInventoryItem(items: InventoryItem[], candidates: string[]) {
  let best: InventoryItem | null = null
  let bestScore = 0
  for (const item of items) {
    const score = scoreMatch(item.item_name, candidates)
    if (score > bestScore) {
      best = item
      bestScore = score
    }
  }
  return bestScore >= 12 ? best : null
}

function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

  if (!url) {
    throw new Error('Missing Supabase URL. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).')
  }
  if (!key) {
    throw new Error('Missing Supabase secret key. Set SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY.')
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function loadSimulatorConfig() {
  const require = createRequire(__filename)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const mod = require('./config/square-simulator-config') as { simulatorConfig: { items: Array<{ key: string; name: string; category?: string }> } }
  return mod.simulatorConfig
}

function getRecipeSpecsForProductKey(productKey: string): RecipeLineSpec[] {
  const key = productKey.toLowerCase()

  if (key.includes('latte')) {
    const isGrande = key.includes('grande')
    const milkOz = isGrande ? 14 : 10
    const espressoOz = isGrande ? 0.9 : 0.6
    return [
      {
        label: 'Espresso beans',
        candidates: ['espresso beans', 'coffee beans', 'espresso', 'beans'],
        amount: { qty: espressoOz, unit: 'oz' },
        loss_pct: 2,
      },
      {
        label: 'Milk',
        candidates: ['whole milk', 'milk', 'dairy milk'],
        amount: { qty: milkOz, unit: 'oz' },
        loss_pct: 1,
      },
      {
        label: 'Cup',
        candidates: ['cup', 'hot cup', 'paper cup'],
        amount: { qty: 1, unit: 'each' },
        loss_pct: 0,
      },
      {
        label: 'Lid',
        candidates: ['lid', 'cup lid'],
        amount: { qty: 1, unit: 'each' },
        loss_pct: 0,
      },
    ]
  }

  if (key.includes('breakfast') || key.includes('burrito')) {
    return [
      {
        label: 'Tortilla',
        candidates: ['tortilla', 'flour tortilla'],
        amount: { qty: 1, unit: 'each' },
        loss_pct: 1,
      },
      {
        label: 'Eggs',
        candidates: ['egg', 'eggs'],
        amount: { qty: 2, unit: 'each' },
        loss_pct: 2,
      },
      {
        label: 'Bacon',
        candidates: ['bacon'],
        amount: { qty: 2, unit: 'oz' },
        loss_pct: 3,
      },
      {
        label: 'Cheese',
        candidates: ['cheddar', 'cheese'],
        amount: { qty: 1, unit: 'oz' },
        loss_pct: 2,
      },
      {
        label: 'Wrap / foil',
        candidates: ['foil', 'wrap', 'paper wrap'],
        amount: { qty: 1, unit: 'each' },
        loss_pct: 0,
      },
    ]
  }

  if (key.includes('granola')) {
    return [
      {
        label: 'Oats',
        candidates: ['oats', 'rolled oats', 'oat'],
        amount: { qty: 2.2, unit: 'oz' },
        loss_pct: 2,
      },
      {
        label: 'Honey / sweetener',
        candidates: ['honey', 'maple syrup', 'agave', 'sweetener'],
        amount: { qty: 0.6, unit: 'oz' },
        loss_pct: 1,
      },
      {
        label: 'Nuts / add-ins',
        candidates: ['almond', 'nuts', 'walnut', 'pecan'],
        amount: { qty: 0.8, unit: 'oz' },
        loss_pct: 3,
      },
      {
        label: 'Wrapper',
        candidates: ['wrapper', 'packaging', 'plastic wrap', 'bag'],
        amount: { qty: 1, unit: 'each' },
        loss_pct: 0,
      },
    ]
  }

  if (key.includes('muffin') || key.includes('blueberry')) {
    return [
      {
        label: 'Flour',
        candidates: ['flour', 'all purpose flour', 'ap flour'],
        amount: { qty: 3, unit: 'oz' },
        loss_pct: 3,
      },
      {
        label: 'Sugar',
        candidates: ['sugar', 'granulated sugar'],
        amount: { qty: 1.2, unit: 'oz' },
        loss_pct: 1,
      },
      {
        label: 'Butter / oil',
        candidates: ['butter', 'vegetable oil', 'oil'],
        amount: { qty: 1, unit: 'oz' },
        loss_pct: 1,
      },
      {
        label: 'Egg',
        candidates: ['egg', 'eggs'],
        amount: { qty: 1, unit: 'each' },
        loss_pct: 1,
      },
      {
        label: 'Blueberries',
        candidates: ['blueberry', 'blueberries'],
        amount: { qty: 1.5, unit: 'oz' },
        loss_pct: 4,
      },
      {
        label: 'Muffin liner',
        candidates: ['liner', 'muffin liner', 'cupcake liner'],
        amount: { qty: 1, unit: 'each' },
        loss_pct: 0,
      },
    ]
  }

  return []
}

function getModifierSpecs(seed: string, milkOz: number): ModifierSpec[] {
  const specs: ModifierSpec[] = [
    {
      setKey: 'milk',
      setName: 'Milk Options',
      options: [
        {
          square_modifier_id: 'SIM-MOD-OAT-MILK',
          name: 'Oat Milk',
          recipeLines: [
            {
              label: 'Oat milk',
              candidates: ['oat milk', 'oatly', 'oat beverage'],
              amount: { qty: milkOz, unit: 'oz' as Unit },
              loss_pct: 1,
            },
          ],
        },
        {
          square_modifier_id: 'SIM-MOD-ALMOND-MILK',
          name: 'Almond Milk',
          recipeLines: [
            {
              label: 'Almond milk',
              candidates: ['almond milk', 'almond beverage'],
              amount: { qty: milkOz, unit: 'oz' as Unit },
              loss_pct: 1,
            },
          ],
        },
      ],
    },
    {
      setKey: 'coffee_addons',
      setName: 'Coffee Add-ons',
      options: [
        {
          square_modifier_id: 'SIM-MOD-EXTRA-SHOT',
          name: 'Extra Espresso Shot',
          recipeLines: [
            {
              label: 'Espresso beans',
              candidates: ['espresso beans', 'coffee beans', 'espresso', 'beans'],
              amount: { qty: 0.3, unit: 'oz' as Unit },
              loss_pct: 2,
            },
          ],
        },
        {
          square_modifier_id: 'SIM-MOD-VANILLA',
          name: 'Vanilla Syrup',
          recipeLines: [
            {
              label: 'Vanilla syrup',
              candidates: ['vanilla syrup', 'vanilla'],
              amount: { qty: 0.5, unit: 'oz' as Unit },
              loss_pct: 0,
            },
          ],
        },
        {
          square_modifier_id: 'SIM-MOD-CARAMEL',
          name: 'Caramel Syrup',
          recipeLines: [
            {
              label: 'Caramel syrup',
              candidates: ['caramel syrup', 'caramel'],
              amount: { qty: 0.5, unit: 'oz' as Unit },
              loss_pct: 0,
            },
          ],
        },
      ],
    },
  ]

  // `seed` is still used in how we create the modifier set IDs in the DB.
  void seed
  return specs
}

async function seedProductRecipes(
  supabase: SupabaseClient,
  inventoryItems: InventoryItem[],
  products: CogsProduct[],
  options: Options
) {
  const prefix = `SIM-COGS-ITEM-${options.seed}-`
  const simulator = loadSimulatorConfig()
  const configNameByKey = new Map((simulator.items ?? []).map((item: { key: string; name: string }) => [item.key, item.name]))

  const targets = products
    .filter(p => p.square_item_id.startsWith(prefix))
    .map(p => {
      const key = p.square_item_id.slice(prefix.length)
      return { ...p, productKey: key, displayName: configNameByKey.get(key) ?? p.name }
    })

  if (targets.length === 0) {
    console.log('No SIM-COGS products found to seed base recipes.')
    return
  }

  console.log(`\nBase recipes: ${targets.length} product(s) in scope`)

  const existingByProduct = new Map<string, number>()
  {
    const { data, error } = await supabase
      .from('cogs_product_recipes')
      .select('product_id, version')
      .in('product_id', targets.map(t => t.id))
    if (error) throw new Error(`Failed reading existing product recipes: ${error.message}`)
    for (const row of data ?? []) {
      const prev = existingByProduct.get(row.product_id) ?? 0
      const version = Number(row.version ?? 0)
      if (version > prev) existingByProduct.set(row.product_id, version)
    }
  }

  const effectiveFrom = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  for (const product of targets) {
    const existingVersion = existingByProduct.get(product.id) ?? 0
    if (existingVersion > 0 && !options.force) {
      console.log(`- Skip ${product.displayName} (recipe exists)`)
      continue
    }

    const lines = getRecipeSpecsForProductKey(product.productKey)
    if (lines.length === 0) {
      console.log(`- Skip ${product.displayName} (no template)`)
      continue
    }

    const plannedLines: Array<{ inventory_item_id: string; qty: number; unit: Unit; loss_pct: number; label: string }> = []
    const missing: string[] = []

    for (const spec of lines) {
      const match = findBestInventoryItem(inventoryItems, spec.candidates)
      if (!match) {
        missing.push(spec.label)
        continue
      }
      const converted = convert(spec.amount.qty, spec.amount.unit, match.unit_type)
      if (converted === null) {
        missing.push(`${spec.label} (unit ${spec.amount.unit}→${match.unit_type} unsupported)`)
        continue
      }
      plannedLines.push({
        inventory_item_id: match.id,
        qty: Math.round(converted * 10000) / 10000,
        unit: match.unit_type,
        loss_pct: spec.loss_pct,
        label: spec.label,
      })
    }

    if (missing.length > 0 && options.strict) {
      throw new Error(`Missing required inventory items for ${product.displayName}: ${missing.join(', ')}`)
    }

    const nextVersion = existingVersion > 0 ? existingVersion + 1 : 1
    console.log(`- ${product.displayName} v${nextVersion}: ${plannedLines.length} line(s)${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`)

    if (options.dryRun) continue

    const { data: inserted, error: insertError } = await supabase
      .from('cogs_product_recipes')
      .insert([{
        product_id: product.id,
        version: nextVersion,
        effective_from: effectiveFrom,
        effective_to: null,
        yield_qty: 1,
        yield_unit: 'each',
        notes: `seed-cogs-recipes:${options.seed}:${crypto.randomUUID()}`,
      }])
      .select('id')
      .single()

    if (insertError || !inserted) throw new Error(`Failed inserting base recipe for ${product.displayName}: ${insertError?.message ?? 'unknown error'}`)

    if (plannedLines.length === 0) continue

    const { error: linesError } = await supabase
      .from('cogs_product_recipe_lines')
      .insert(plannedLines.map(line => ({
        recipe_id: inserted.id,
        inventory_item_id: line.inventory_item_id,
        qty: line.qty,
        unit: line.unit,
        loss_pct: line.loss_pct,
      })))

    if (linesError) throw new Error(`Failed inserting recipe lines for ${product.displayName}: ${linesError.message}`)
  }
}

async function seedModifierRecipes(
  supabase: SupabaseClient,
  inventoryItems: InventoryItem[],
  options: Options,
  tenantId: string = DEFAULT_TENANT_ID
) {
  const effectiveFrom = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  const milkOz = 10
  const modifierSets = getModifierSpecs(options.seed, milkOz)

  console.log(`\nModifier recipes: ${modifierSets.reduce((acc, s) => acc + s.options.length, 0)} option(s) planned`)

  if (options.dryRun) {
    for (const set of modifierSets) {
      console.log(`- Set: ${set.setName}`)
      for (const opt of set.options) {
        console.log(`  - ${opt.name} (${opt.square_modifier_id}) lines=${opt.recipeLines.length}`)
      }
    }
    return
  }

  for (const set of modifierSets) {
    const setId = `SIM-MODSET-${options.seed}-${set.setKey}`
    const { data: setRow, error: setError } = await supabase
      .from('cogs_modifier_sets')
      .upsert([{
        tenant_id: tenantId,
        square_modifier_list_id: setId,
        name: set.setName,
      }], { onConflict: 'tenant_id,square_modifier_list_id' })
      .select('id')
      .single()

    if (setError || !setRow) throw new Error(`Failed upserting modifier set ${set.setName}: ${setError?.message ?? 'unknown error'}`)

    for (const opt of set.options) {
      const { data: optionRow, error: optionError } = await supabase
        .from('cogs_modifier_options')
        .upsert([{
          tenant_id: tenantId,
          modifier_set_id: setRow.id,
          square_modifier_id: opt.square_modifier_id,
          name: opt.name,
        }], { onConflict: 'tenant_id,square_modifier_id' })
        .select('id')
        .single()

      if (optionError || !optionRow) throw new Error(`Failed upserting modifier option ${opt.name}: ${optionError?.message ?? 'unknown error'}`)

      const { data: existing, error: existingError } = await supabase
        .from('cogs_modifier_option_recipes')
        .select('version')
        .eq('modifier_option_id', optionRow.id)
        .order('version', { ascending: false })
        .limit(1)
      if (existingError) throw new Error(`Failed reading modifier recipes for ${opt.name}: ${existingError.message}`)

      const existingVersion = existing?.[0]?.version ? Number(existing[0].version) : 0
      if (existingVersion > 0 && !options.force) {
        console.log(`- Skip modifier ${opt.name} (recipe exists)`)
        continue
      }

      const plannedLines: Array<{ inventory_item_id: string; qty: number; unit: Unit; loss_pct: number }> = []
      const missing: string[] = []

      for (const spec of opt.recipeLines) {
        const match = findBestInventoryItem(inventoryItems, spec.candidates)
        if (!match) {
          missing.push(spec.label)
          continue
        }
        const converted = convert(spec.amount.qty, spec.amount.unit, match.unit_type)
        if (converted === null) {
          missing.push(`${spec.label} (unit ${spec.amount.unit}→${match.unit_type} unsupported)`)
          continue
        }
        plannedLines.push({
          inventory_item_id: match.id,
          qty: Math.round(converted * 10000) / 10000,
          unit: match.unit_type,
          loss_pct: spec.loss_pct,
        })
      }

      if (missing.length > 0 && options.strict) {
        throw new Error(`Missing required inventory items for modifier ${opt.name}: ${missing.join(', ')}`)
      }

      const nextVersion = existingVersion > 0 ? existingVersion + 1 : 1
      console.log(`- Modifier ${opt.name} v${nextVersion}: ${plannedLines.length} line(s)${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`)

      const { data: inserted, error: insertError } = await supabase
        .from('cogs_modifier_option_recipes')
        .insert([{
          modifier_option_id: optionRow.id,
          version: nextVersion,
          effective_from: effectiveFrom,
          effective_to: null,
          notes: `seed-cogs-recipes:${options.seed}:${crypto.randomUUID()}`,
        }])
        .select('id')
        .single()

      if (insertError || !inserted) throw new Error(`Failed inserting modifier recipe for ${opt.name}: ${insertError?.message ?? 'unknown error'}`)

      if (plannedLines.length === 0) continue

      const { error: linesError } = await supabase
        .from('cogs_modifier_option_recipe_lines')
        .insert(plannedLines.map(line => ({
          recipe_id: inserted.id,
          inventory_item_id: line.inventory_item_id,
          qty: line.qty,
          unit: line.unit,
          loss_pct: line.loss_pct,
        })))

      if (linesError) throw new Error(`Failed inserting modifier recipe lines for ${opt.name}: ${linesError.message}`)
    }
  }
}

async function main() {
  const options = parseArgs(process.argv)
  dotenv.config({ path: options.envPath })

  const supabase = createSupabaseServiceClient()

  const { data: inventoryRaw, error: inventoryError } = await supabase
    .from('inventory_items')
    .select('id,item_name,unit_type,unit_cost,deleted_at')
    .is('deleted_at', null)

  if (inventoryError) throw new Error(`Failed loading inventory items: ${inventoryError.message}`)

  const inventoryItems: InventoryItem[] = []
  for (const row of inventoryRaw ?? []) {
    const unit = toUnit(row.unit_type)
    if (!unit) continue
    inventoryItems.push({
      id: row.id,
      item_name: row.item_name,
      unit_type: unit,
      unit_cost: Number(row.unit_cost ?? 0),
    })
  }

  const { data: products, error: productsError } = await supabase
    .from('cogs_products')
    .select('id,square_item_id,name')
    .eq('is_active', true)

  if (productsError) throw new Error(`Failed loading cogs_products: ${productsError.message}`)

  console.log('\nCOGS Recipe Seeder')
  console.log('-----------------')
  console.log(`Seed: ${options.seed}`)
  console.log(`Dry run: ${options.dryRun ? 'yes' : 'no'}`)
  console.log(`Strict: ${options.strict ? 'yes' : 'no'}`)
  console.log(`Force: ${options.force ? 'yes' : 'no'}`)

  if (!options.modifiersOnly) {
    await seedProductRecipes(supabase, inventoryItems, (products ?? []) as CogsProduct[], options)
  }

  if (!options.productsOnly) {
    await seedModifierRecipes(supabase, inventoryItems, options)
  }

  console.log('\nDone.')
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('\nSeed failed:', message)
  if (error instanceof Error && error.stack) console.error(error.stack)
  process.exit(1)
})
