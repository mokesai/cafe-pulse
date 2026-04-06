#!/usr/bin/env node

/**
 * Seed simulated drink recipes directly into cogs_product_recipes
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const TENANT_ID = '4fa1cbbe-49ff-4cde-a686-8d34252945b4'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// Map of drink → [{ inventory_item_id, quantity, unit }]
const RECIPES: Record<string, Array<{ name: string; qty: number; unit: string }>> = {
  'Latte': [
    { name: 'Whole Milk', qty: 10, unit: 'oz' },
    { name: 'Espresso Beans', qty: 2, unit: 'oz' },
  ],
  'Frappuccino': [
    { name: 'Whole Milk', qty: 8, unit: 'oz' },
    { name: 'Mocha Sauce', qty: 1.5, unit: 'oz' },
    { name: 'Whipped Cream Can', qty: 0.5, unit: 'oz' },
  ],
  'Double Espresso': [
    { name: 'Espresso Beans', qty: 3, unit: 'oz' },
  ],
  'Refresher': [
    { name: 'Strawberry Puree', qty: 2, unit: 'oz' },
    { name: 'Mango Puree', qty: 1, unit: 'oz' },
  ],
  'Iced Tea': [
    { name: 'Vanilla Syrup', qty: 1, unit: 'oz' },
  ],
  'Smoothie': [
    { name: 'Whole Milk', qty: 8, unit: 'oz' },
    { name: 'Strawberry Puree', qty: 2.5, unit: 'oz' },
  ],
  'Matcha Latte': [
    { name: 'Oat Milk', qty: 10, unit: 'oz' },
    { name: 'Matcha Powder', qty: 1.5, unit: 'oz' },
  ],
  'Chai Latte': [
    { name: 'Oat Milk', qty: 8, unit: 'oz' },
    { name: 'Chai Concentrate', qty: 2, unit: 'oz' },
  ],
  'Caramel Latte': [
    { name: 'Espresso Beans', qty: 2, unit: 'oz' },
    { name: 'Caramel Syrup', qty: 1.5, unit: 'oz' },
    { name: 'Whole Milk', qty: 10, unit: 'oz' },
  ],
  'Hazelnut Latte': [
    { name: 'Espresso Beans', qty: 2, unit: 'oz' },
    { name: 'Hazelnut Syrup', qty: 1.5, unit: 'oz' },
    { name: 'Whole Milk', qty: 10, unit: 'oz' },
  ],
}

async function main() {
  console.log('🥤 Seeding drink recipes...')
  console.log(`   Tenant: ${TENANT_ID}`)
  console.log()

  // Get all inventory items to map names to IDs
  const { data: items, error: itemErr } = await supabase
    .from('inventory_items')
    .select('id, item_name')
    .eq('tenant_id', TENANT_ID)

  if (itemErr) {
    console.error('❌ Failed to fetch inventory:', itemErr.message)
    process.exit(1)
  }

  const itemMap = new Map(items?.map(i => [i.item_name, i.id]) ?? [])
  console.log(`Found ${itemMap.size} inventory items`)
  console.log()

  // Get products
  const { data: products, error: prodErr } = await supabase
    .from('cogs_products')
    .select('id, name')
    .eq('tenant_id', TENANT_ID)

  if (prodErr) {
    console.error('❌ Failed to fetch products:', prodErr.message)
    process.exit(1)
  }

  const productMap = new Map(products?.map(p => [p.name, p.id]) ?? [])
  console.log(`Found ${productMap.size} products`)
  console.log()

  let created = 0

  for (const [drinkName, ingredients] of Object.entries(RECIPES)) {
    const productId = productMap.get(drinkName)
    if (!productId) {
      console.warn(`  ⚠️  ${drinkName}: product not found`)
      continue
    }

    // Build recipe lines
    const lines = ingredients
      .map(ing => {
        const itemId = itemMap.get(ing.name)
        if (!itemId) {
          console.warn(`    ⚠️  ${ing.name} not found`)
          return null
        }
        return { inventory_item_id: itemId, qty: ing.qty, unit: ing.unit, loss_pct: 0 }
      })
      .filter(l => l !== null)

    if (lines.length === 0) {
      console.warn(`  ❌ ${drinkName}: no ingredients found`)
      continue
    }

    // Create recipe
    const { data: recipe, error: recipeErr } = await supabase
      .from('cogs_product_recipes')
      .insert({
        tenant_id: TENANT_ID,
        product_id: productId,
        version: 1,
        effective_from: new Date().toISOString(),
        yield_qty: 1,
        yield_unit: 'drink',
        notes: 'Simulated recipe',
      })
      .select('id')
      .single()

    if (recipeErr) {
      console.error(`  ❌ ${drinkName}: ${recipeErr.message}`)
      continue
    }

    // Add recipe lines
    const lineRows = lines.map(l => ({
      recipe_id: recipe.id,
      inventory_item_id: l.inventory_item_id,
      qty: l.qty,
      unit: l.unit,
      loss_pct: l.loss_pct,
    }))

    const { error: lineErr } = await supabase
      .from('cogs_product_recipe_lines')
      .insert(lineRows)

    if (lineErr) {
      console.error(`  ❌ ${drinkName} lines: ${lineErr.message}`)
    } else {
      console.log(`  ✅ ${drinkName} (${lines.length} ingredients)`)
      created++
    }
  }

  console.log()
  console.log(`✅ ${created} recipes created`)
}

main().catch(err => {
  console.error('💥 Failed:', err)
  process.exit(1)
})
