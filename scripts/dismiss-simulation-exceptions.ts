#!/usr/bin/env node

/**
 * Quick script to dismiss all simulation invoice exceptions
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
  console.log('🗑️ Dismissing simulation invoice exceptions...')

  // Get open exceptions
  const { data: exceptions, error: getErr } = await supabase
    .from('invoice_exceptions')
    .select('id')
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'open')

  if (getErr) {
    console.error('❌ Query failed:', getErr.message)
    process.exit(1)
  }

  const count = exceptions?.length ?? 0
  console.log(`Found ${count} open exceptions`)

  if (count === 0) {
    console.log('✅ No exceptions to dismiss')
    return
  }

  // Dismiss in batches
  const batchSize = 100
  let dismissed = 0

  for (let i = 0; i < count; i += batchSize) {
    const batch = exceptions!.slice(i, i + batchSize)
    const ids = batch.map(e => e.id)

    const { error: updateErr } = await supabase
      .from('invoice_exceptions')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolution_notes: 'Dismissed by simulation script'
      })
      .in('id', ids)

    if (updateErr) {
      console.error(`❌ Batch ${i / batchSize + 1} failed:`, updateErr.message)
    } else {
      dismissed += batch.length
      console.log(`  ✅ Dismissed ${batch.length} exceptions (total: ${dismissed})`)
    }
  }

  console.log(`\n✅ All ${dismissed} exceptions dismissed`)
}

main().catch(err => {
  console.error('💥 Failed:', err)
  process.exit(1)
})
