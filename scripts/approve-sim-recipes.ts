#!/usr/bin/env node

/**
 * Promote pending AI recipe estimates to approved cogs_product_recipes
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

async function main() {
  console.log('✅ Approving pending AI recipe estimates...')
  console.log(`   Tenant: ${TENANT_ID}`)
  console.log()

  // Get pending estimates
  const { data: estimates, error: getErr } = await supabase
    .from('ai_recipe_estimates')
    .select('id, square_product_id, product_name')
    .eq('tenant_id', TENANT_ID)
    .eq('review_status', 'pending')

  if (getErr) {
    console.error('❌ Query failed:', getErr.message)
    process.exit(1)
  }

  const pending = estimates ?? []
  console.log(`Found ${pending.length} pending estimates\n`)

  if (pending.length === 0) {
    console.log('✅ No pending estimates to approve')
    return
  }

  // Approve each
  let approved = 0
  for (const est of pending) {
    const productName = est.product_name || 'Unknown'

    // Mark as approved
    const { error: approveErr } = await supabase
      .from('ai_recipe_estimates')
      .update({
        review_status: 'approved',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', est.id)

    if (approveErr) {
      console.error(`  ❌ ${productName}: ${approveErr.message}`)
      continue
    }

    console.log(`  ✅ ${productName} approved`)
    approved++
  }

  console.log(`\n✅ ${approved} recipes approved`)
  console.log('\nRefresh the UI — Base Recipes should now show the approved recipes.')
}

main().catch(err => {
  console.error('💥 Failed:', err)
  process.exit(1)
})
