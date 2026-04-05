/**
 * MOK-78: Seed drink ingredient inventory items for Cafe Operations Simulation
 * 
 * This script is ONLY for simulation/testing purposes.
 * It adds drink ingredients (milks, syrups, toppers) needed for the 2-month
 * cafe operations simulation (Feb-Mar 2026).
 * 
 * Usage:
 *   SIMULATION_MODE=true npx tsx scripts/seed-drink-ingredients.ts
 * 
 * Safety: Exits early if SIMULATION_MODE is not set to 'true'
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Safety gate - only run in simulation mode
if (process.env.SIMULATION_MODE !== 'true') {
  console.error('❌ SIMULATION_MODE must be set to "true" to run this script')
  console.error('   This prevents accidental data pollution in production.')
  process.exit(1)
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// Bigcafe tenant ID
const TENANT_ID = '4fa1cbbe-49ff-4cde-a686-8d34252945b4'

// Supplier IDs
const SUPPLIERS = {
  walmart: '1461623f-bbfd-4faf-820c-3205cf4a0db8',
  odeko: '69f88f11-53fc-4dff-9e00-88e396d6a21a',
  samsClub: '2dde7eab-9db7-4d91-a86c-03adfb4e3f04'
}

// Drink ingredient items for simulation
const DRINK_INGREDIENTS = [
  // Walmart Business - dairy & basic syrups
  { supplier_id: SUPPLIERS.walmart, item_name: 'Whole Milk', unit_type: 'gallon', unit_cost: 4.29, square_item_id: 'SEED-WM-MILK-WHOLE' },
  { supplier_id: SUPPLIERS.walmart, item_name: '2% Milk', unit_type: 'gallon', unit_cost: 3.99, square_item_id: 'SEED-WM-MILK-2PCT' },
  { supplier_id: SUPPLIERS.walmart, item_name: 'Oat Milk', unit_type: 'gallon', unit_cost: 7.99, square_item_id: 'SEED-WM-MILK-OAT' },
  { supplier_id: SUPPLIERS.walmart, item_name: 'Almond Milk', unit_type: 'gallon', unit_cost: 6.49, square_item_id: 'SEED-WM-MILK-ALMOND' },
  { supplier_id: SUPPLIERS.walmart, item_name: 'Heavy Cream', unit_type: 'quart', unit_cost: 4.99, square_item_id: 'SEED-WM-CREAM-HEAVY' },
  { supplier_id: SUPPLIERS.walmart, item_name: 'Whipped Cream Can', unit_type: 'can', unit_cost: 3.49, square_item_id: 'SEED-WM-WHIP-CAN' },
  { supplier_id: SUPPLIERS.walmart, item_name: 'Vanilla Syrup', unit_type: 'bottle', unit_cost: 6.99, square_item_id: 'SEED-WM-SYRUP-VANILLA' },
  
  // Odeko - specialty syrups & toppers
  { supplier_id: SUPPLIERS.odeko, item_name: 'Caramel Syrup', unit_type: 'bottle', unit_cost: 8.50, square_item_id: 'SEED-ODEKO-SYRUP-CARAMEL' },
  { supplier_id: SUPPLIERS.odeko, item_name: 'Hazelnut Syrup', unit_type: 'bottle', unit_cost: 8.50, square_item_id: 'SEED-ODEKO-SYRUP-HAZELNUT' },
  { supplier_id: SUPPLIERS.odeko, item_name: 'Mocha Sauce', unit_type: 'bottle', unit_cost: 9.25, square_item_id: 'SEED-ODEKO-MOCHA' },
  { supplier_id: SUPPLIERS.odeko, item_name: 'Strawberry Puree', unit_type: 'bottle', unit_cost: 11.00, square_item_id: 'SEED-ODEKO-PUREE-STRAWB' },
  { supplier_id: SUPPLIERS.odeko, item_name: 'Mango Puree', unit_type: 'bottle', unit_cost: 11.00, square_item_id: 'SEED-ODEKO-PUREE-MANGO' },
  { supplier_id: SUPPLIERS.odeko, item_name: 'Chai Concentrate', unit_type: 'bottle', unit_cost: 12.00, square_item_id: 'SEED-ODEKO-CHAI' },
  { supplier_id: SUPPLIERS.odeko, item_name: 'Matcha Powder', unit_type: 'oz', unit_cost: 1.85, square_item_id: 'SEED-ODEKO-MATCHA' },
  { supplier_id: SUPPLIERS.odeko, item_name: 'Coconut Flakes Topper', unit_type: 'lb', unit_cost: 4.50, square_item_id: 'SEED-ODEKO-COCONUT' },
  { supplier_id: SUPPLIERS.odeko, item_name: 'Caramel Drizzle Topper', unit_type: 'bottle', unit_cost: 7.25, square_item_id: 'SEED-ODEKO-DRIZZLE' },
  
  // Sam's Club - bulk coffee
  { supplier_id: SUPPLIERS.samsClub, item_name: 'Espresso Beans', unit_type: 'lb', unit_cost: 9.50, square_item_id: 'SEED-SC-ESPRESSO' },
  { supplier_id: SUPPLIERS.samsClub, item_name: 'Cold Brew Concentrate', unit_type: 'gallon', unit_cost: 18.00, square_item_id: 'SEED-SC-COLDBREW' },
]

async function seedDrinkIngredients() {
  console.log('🌱 Seeding drink ingredients for Cafe Operations Simulation...')
  console.log(`   Tenant: ${TENANT_ID}`)
  console.log(`   Items to add: ${DRINK_INGREDIENTS.length}`)
  console.log()

  // First, check/expand unit_type constraint if needed
  console.log('🔧 Checking unit_type constraint...')
  const { data: constraintCheck, error: constraintError } = await supabase.rpc(
    'exec_sql',
    { sql: `
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'inventory_items'::regclass
      AND conname LIKE '%unit_type%'
    `}
  )
  
  if (constraintError) {
    console.log('   ⚠️ Could not check constraint (exec_sql may not exist), continuing...')
  } else {
    console.log('   Constraint found, may need expansion for bottle/quart/can')
  }

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const item of DRINK_INGREDIENTS) {
    const { data, error } = await supabase
      .from('inventory_items')
      .upsert({
        tenant_id: TENANT_ID,
        supplier_id: item.supplier_id,
        item_name: item.item_name,
        unit_type: item.unit_type,
        unit_cost: item.unit_cost,
        square_item_id: item.square_item_id,
        is_ingredient: true,
        item_type: 'ingredient',
        current_stock: 0,
        minimum_threshold: 5,
        reorder_point: 10,
        pack_size: 1,
        location: 'main',
      }, {
        onConflict: 'tenant_id,supplier_id,square_item_id,pack_size',
        ignoreDuplicates: true
      })
      .select('id, item_name')

    if (error) {
      console.error(`   ❌ ${item.item_name}: ${error.message}`)
      errors++
    } else if (data && data.length > 0) {
      console.log(`   ✅ ${item.item_name} (${item.unit_type}) - $${item.unit_cost}`)
      inserted++
    } else {
      console.log(`   ⏭️  ${item.item_name} (already exists)`)
      skipped++
    }
  }

  console.log()
  console.log('📊 Summary:')
  console.log(`   Inserted: ${inserted}`)
  console.log(`   Skipped:  ${skipped}`)
  console.log(`   Errors:   ${errors}`)
  
  if (errors > 0) {
    console.error('\n❌ Seeding completed with errors')
    process.exit(1)
  }
  
  console.log('\n✅ Drink ingredients seeded successfully!')
  console.log('   Next: Run MOK-79 to define drink recipes.')
}

seedDrinkIngredients().catch(err => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})
