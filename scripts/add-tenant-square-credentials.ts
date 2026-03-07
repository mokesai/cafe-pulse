#!/usr/bin/env tsx
/**
 * Manually add Square credentials to a tenant for testing
 * Usage: npx tsx scripts/add-tenant-square-credentials.ts <tenant-slug> <access-token> <location-id>
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables')
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.length !== 3) {
  console.error('Usage: npx tsx scripts/add-tenant-square-credentials.ts <tenant-slug> <access-token> <location-id>')
  console.error('Example: npx tsx scripts/add-tenant-square-credentials.ts test-cafe EAAA... L123...')
  process.exit(1)
}

const [tenantSlug, accessToken, locationId] = args

async function addSquareCredentials() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // 1. Find tenant by slug
  console.log(`🔍 Looking up tenant: ${tenantSlug}`)
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('slug', tenantSlug)
    .single()

  if (tenantError || !tenant) {
    console.error(`❌ Tenant not found: ${tenantSlug}`)
    process.exit(1)
  }

  console.log(`✓ Found tenant: ${tenant.name} (${tenant.id})`)

  // 2. For Test Accounts, store credentials directly in tenant table
  // (Test Account tokens don't expire, so we don't need vault/refresh tokens)
  console.log(`📝 Storing Square test credentials...`)
  const { error: updateError } = await supabase
    .from('tenants')
    .update({
      square_access_token: accessToken, // Store directly for test accounts
      square_location_id: locationId,
      square_environment: 'sandbox',
      square_merchant_id: null, // Will be populated on first API call
    })
    .eq('id', tenant.id)

  if (updateError) {
    console.error(`❌ Failed to update tenant:`, updateError)
    console.error(`Details:`, updateError.message)
    process.exit(1)
  }

  console.log(`\n✅ Square credentials configured successfully!\n`)
  console.log(`Tenant: ${tenant.name}`)
  console.log(`Location ID: ${locationId}`)
  console.log(`Environment: sandbox`)
  console.log(`\nYou can now test menu rendering at:`)
  console.log(`- Customer menu: http://${tenantSlug}.localhost:3000/menu`)
  console.log(`- KDS drinks: http://${tenantSlug}.localhost:3000/kds/drinks`)
  console.log(`- KDS food: http://${tenantSlug}.localhost:3000/kds/food`)
}

addSquareCredentials().catch(console.error)
