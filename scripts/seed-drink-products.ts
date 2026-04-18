#!/usr/bin/env node

/**
 * Seed drink products for COGS catalog (simulation only)
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

const DRINKS = [
  { name: 'Latte', catalogId: 'SIM-DRINK-LATTE' },
  { name: 'Frappuccino', catalogId: 'SIM-DRINK-FRAP' },
  { name: 'Double Espresso', catalogId: 'SIM-DRINK-ESPRESSO' },
  { name: 'Refresher', catalogId: 'SIM-DRINK-REFRESHER' },
  { name: 'Iced Tea', catalogId: 'SIM-DRINK-ICEDTEA' },
  { name: 'Smoothie', catalogId: 'SIM-DRINK-SMOOTHIE' },
  { name: 'Matcha Latte', catalogId: 'SIM-DRINK-MATCHA' },
  { name: 'Chai Latte', catalogId: 'SIM-DRINK-CHAI' },
  { name: 'Caramel Latte', catalogId: 'SIM-DRINK-CARAMEL' },
  { name: 'Hazelnut Latte', catalogId: 'SIM-DRINK-HAZELNUT' },
]

async function main() {
  console.log('📦 Seeding drink products...')
  console.log(`   Tenant: ${TENANT_ID}`)
  console.log(`   Products: ${DRINKS.length}`)
  console.log()

  let inserted = 0
  let skipped = 0

  for (const drink of DRINKS) {
    // Check if exists
    const { data: existing } = await supabase
      .from('cogs_products')
      .select('id')
      .eq('tenant_id', TENANT_ID)
      .eq('square_item_id', drink.catalogId)
      .single()

    if (existing) {
      console.log(`   ⏭️  ${drink.name} (already exists)`)
      skipped++
      continue
    }

    // Insert
    const { error } = await supabase
      .from('cogs_products')
      .insert({
        tenant_id: TENANT_ID,
        name: drink.name,
        square_item_id: drink.catalogId,
        category: 'Beverages',
        is_active: true,
      })

    if (error) {
      console.error(`   ❌ ${drink.name}: ${error.message}`)
    } else {
      console.log(`   ✅ ${drink.name}`)
      inserted++
    }
  }

  console.log()
  console.log(`📊 Summary:`)
  console.log(`   Inserted: ${inserted}`)
  console.log(`   Skipped:  ${skipped}`)
  console.log()
  console.log(`✅ Products seeded. Refresh the UI and you should see them in Catalog.`)
}

main().catch(err => {
  console.error('💥 Failed:', err)
  process.exit(1)
})
