#!/usr/bin/env node

/**
 * Square Webhooks Setup Tool
 * Configures webhook subscriptions in Square Developer Console
 * Usage: node scripts/setup-square-webhooks.js [--environment=sandbox|production]
 */

// Import fetch for Node.js environment
let fetch
if (typeof globalThis.fetch === 'undefined') {
  // Node.js < 18 or fetch not available
  fetch = require('node-fetch')
} else {
  // Use built-in fetch (Node.js 18+)
  fetch = globalThis.fetch
}

// Load environment variables
require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })

const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.com'

// Square API configuration
const SQUARE_VERSION = '2024-12-18'

function showUsage() {
  console.log('\n🔗 Square Webhooks Setup Tool')
  console.log('\nConfigures webhook subscriptions in Square for real-time inventory sync.')
  console.log('\nUsage:')
  console.log('  node scripts/setup-square-webhooks.js [options]')
  console.log('\nOptions:')
  console.log('  --environment=ENV    Square environment: sandbox or production (default: from .env)')
  console.log('  --list-existing      List existing webhook subscriptions')
  console.log('  --delete-all         Delete all existing webhook subscriptions')
  console.log('  --tenant-id=UUID     Target a specific tenant by UUID')
  console.log('  --tenant-slug=SLUG   Target a specific tenant by slug (resolved to UUID)')
  console.log('\nWebhook Endpoints:')
  console.log(`  Catalog:   ${siteUrl}/api/webhooks/square/catalog`)
  console.log(`  Inventory: ${siteUrl}/api/webhooks/square/inventory`)
  console.log('\nRequired Setup:')
  console.log('  1. ✅ Configure webhook endpoints in Square Developer Console')
  console.log('  2. ✅ Set SQUARE_WEBHOOK_SIGNATURE_KEY in environment')
  console.log('  3. ✅ Test webhook endpoints are publicly accessible')
  console.log('\nExamples:')
  console.log('  node scripts/setup-square-webhooks.js --list-existing')
  console.log('  node scripts/setup-square-webhooks.js --tenant-id=00000000-0000-0000-0000-000000000002')
  console.log('  node scripts/setup-square-webhooks.js --tenant-slug=demo-cafe')
  console.log('')
}

function parseArgs() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    showUsage()
    process.exit(0)
  }

  let environment = process.env.SQUARE_ENVIRONMENT || 'sandbox'
  const envArg = args.find(arg => arg.startsWith('--environment='))
  if (envArg) {
    environment = envArg.split('=')[1]
    if (!['sandbox', 'production'].includes(environment)) {
      console.error('❌ Invalid environment. Must be: sandbox or production')
      process.exit(1)
    }
  }

  const listExisting = args.includes('--list-existing')
  const deleteAll = args.includes('--delete-all')

  // Add tenant flag parsing
  let tenantId = null
  let tenantSlug = null
  const tenantIdArg = args.find(arg => arg.startsWith('--tenant-id='))
  if (tenantIdArg) tenantId = tenantIdArg.split('=')[1]
  const tenantSlugArg = args.find(arg => arg.startsWith('--tenant-slug='))
  if (tenantSlugArg) tenantSlug = tenantSlugArg.split('=')[1]

  return { environment, listExisting, deleteAll, tenantId, tenantSlug }
}

async function resolveTenantBySlug(supabase, slug) {
  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()
  if (error || !data) throw new Error(`Tenant not found for slug: ${slug}`)
  return data.id
}

async function loadTenantSquareCredentials(supabase, tenantId) {
  const { data, error } = await supabase.rpc('get_tenant_square_credentials_internal', {
    p_tenant_id: tenantId
  })
  if (error || !data || data.length === 0) {
    throw new Error(`Failed to load Square credentials for tenant ${tenantId}: ${error?.message || 'No data returned'}`)
  }
  return data[0]
}

async function validateEnvironment(squareAccessToken, squareEnvironment) {
  if (!supabaseUrl) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL in environment variables')
    process.exit(1)
  }

  if (!supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_SECRET_KEY in environment variables')
    process.exit(1)
  }

  if (!squareAccessToken) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN in environment variables or Vault')
    console.error('💡 Make sure this is set in your .env.local file or use --tenant-id/--tenant-slug')
    process.exit(1)
  }

  if (!siteUrl || siteUrl.includes('localhost')) {
    console.error('❌ NEXT_PUBLIC_SITE_URL must be a public HTTPS URL for webhooks')
    console.error('💡 Use ngrok, Vercel, or other public hosting for webhook testing')
    process.exit(1)
  }

  console.log('✅ Environment variables validated')
  console.log(`🌐 Environment: ${squareEnvironment}`)
  console.log(`🔗 Site URL: ${siteUrl}`)
}

function getSquareBaseUrl(environment) {
  return environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
}

function getHeaders(accessToken) {
  return {
    'Square-Version': SQUARE_VERSION,
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
}

async function listWebhookSubscriptions(accessToken, environment) {
  try {
    console.log('📋 Listing existing webhook subscriptions...')

    const baseUrl = getSquareBaseUrl(environment)
    const response = await fetch(`${baseUrl}/v2/webhooks/subscriptions`, {
      method: 'GET',
      headers: getHeaders(accessToken)
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square API error: ${response.status} ${errorData}`)
    }

    const data = await response.json()
    const subscriptions = data.subscriptions || []

    if (subscriptions.length === 0) {
      console.log('📭 No webhook subscriptions found')
      return []
    }

    console.log(`📬 Found ${subscriptions.length} webhook subscriptions:`)
    subscriptions.forEach((sub, index) => {
      console.log(`\n${index + 1}. ID: ${sub.id}`)
      console.log(`   📍 URL: ${sub.notification_url}`)
      console.log(`   📨 Events: ${sub.event_types?.join(', ') || 'None'}`)
      console.log(`   📅 Created: ${sub.created_at}`)
      console.log(`   ✅ Enabled: ${sub.enabled}`)
    })

    return subscriptions
  } catch (error) {
    console.error('❌ Error listing webhook subscriptions:', error.message)
    return []
  }
}

async function deleteWebhookSubscription(subscriptionId, accessToken, environment) {
  try {
    const baseUrl = getSquareBaseUrl(environment)
    const response = await fetch(`${baseUrl}/v2/webhooks/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
      headers: getHeaders(accessToken)
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square API error: ${response.status} ${errorData}`)
    }

    return true
  } catch (error) {
    console.error(`❌ Error deleting subscription ${subscriptionId}:`, error.message)
    return false
  }
}

async function createWebhookSubscription(notificationUrl, eventTypes, name, accessToken, environment) {
  try {
    console.log(`🔗 Creating webhook subscription for ${name}...`)
    console.log(`📍 URL: ${notificationUrl}`)
    console.log(`📨 Events: ${eventTypes.join(', ')}`)

    const baseUrl = getSquareBaseUrl(environment)
    const response = await fetch(`${baseUrl}/v2/webhooks/subscriptions`, {
      method: 'POST',
      headers: getHeaders(accessToken),
      body: JSON.stringify({
        idempotency_key: `webhook-${name}-${Date.now()}`,
        subscription: {
          name: `Cafe Inventory ${name} Webhook`,
          notification_url: notificationUrl,
          event_types: eventTypes,
          enabled: true
        }
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square API error: ${response.status} ${errorData}`)
    }

    const data = await response.json()
    console.log(`✅ Created webhook subscription: ${data.subscription.id}`)
    return data.subscription
  } catch (error) {
    console.error(`❌ Error creating ${name} webhook:`, error.message)
    return null
  }
}

async function testWebhookEndpoint(url) {
  try {
    console.log(`🧪 Testing webhook endpoint: ${url}`)
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })

    if (response.ok) {
      console.log(`✅ Endpoint is accessible`)
      return true
    } else {
      console.log(`⚠️  Endpoint returned ${response.status}`)
      return false
    }
  } catch (error) {
    console.error(`❌ Endpoint test failed: ${error.message}`)
    return false
  }
}

async function setupWebhooks(accessToken, environment) {
  console.log('🔗 Setting up Square webhook subscriptions...')

  // Test webhook endpoints
  const catalogUrl = `${siteUrl}/api/webhooks/square/catalog`
  const inventoryUrl = `${siteUrl}/api/webhooks/square/inventory`

  const catalogOk = await testWebhookEndpoint(catalogUrl)
  const inventoryOk = await testWebhookEndpoint(inventoryUrl)

  if (!catalogOk || !inventoryOk) {
    console.error('⚠️  Some webhook endpoints are not accessible')
    console.error('💡 Make sure your application is deployed and publicly accessible')
    return
  }

  const results = []

  // Create catalog webhook
  const catalogWebhook = await createWebhookSubscription(
    catalogUrl,
    ['catalog.version.updated'],
    'Catalog',
    accessToken,
    environment
  )
  results.push({ name: 'Catalog', webhook: catalogWebhook, success: !!catalogWebhook })

  // Create inventory webhook
  const inventoryWebhook = await createWebhookSubscription(
    inventoryUrl,
    ['inventory.count.updated'],
    'Inventory',
    accessToken,
    environment
  )
  results.push({ name: 'Inventory', webhook: inventoryWebhook, success: !!inventoryWebhook })

  return results
}

function displaySetupSummary(results) {
  console.log('\n🎉 Webhook setup completed!')
  console.log('=' .repeat(50))
  
  const successful = results.filter(r => r.success).length
  const failed = results.length - successful

  console.log(`\n📊 Setup Results:`)
  console.log(`   ✅ Successful: ${successful}`)
  console.log(`   ❌ Failed: ${failed}`)

  results.forEach(result => {
    const status = result.success ? '✅' : '❌'
    console.log(`   ${status} ${result.name}: ${result.success ? result.webhook.id : 'Failed'}`)
  })

  if (successful > 0) {
    console.log('\n🔐 Next Steps:')
    console.log('   1. Set SQUARE_WEBHOOK_SIGNATURE_KEY in your environment variables')
    console.log('   2. Test webhooks by making changes in Square Dashboard')
    console.log('   3. Monitor webhook logs in your application')
    console.log('   4. Check /api/webhooks/square/catalog and /inventory for status')
  }

  console.log('\n📚 Webhook Documentation:')
  console.log('   Square Webhooks: https://developer.squareup.com/docs/webhooks/overview')
  console.log('   Testing: Make changes in Square Dashboard to trigger webhooks')
}

async function main() {
  const { environment, listExisting, deleteAll, tenantId: parsedTenantId, tenantSlug } = parseArgs()

  console.log('🔗 Square Webhooks Setup Tool')
  console.log(`🌐 Environment: ${environment}`)
  console.log('')

  // Initialize Supabase client
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Resolve tenant
  let tenantId = parsedTenantId
  if (tenantSlug) {
    tenantId = await resolveTenantBySlug(supabase, tenantSlug)
    console.log(`Resolved tenant slug "${tenantSlug}" to ID: ${tenantId}`)
  }

  // Load Square credentials
  let squareAccessToken, squareEnvironment
  if (tenantId) {
    // Load from Vault
    const creds = await loadTenantSquareCredentials(supabase, tenantId)
    squareAccessToken = creds.access_token
    squareEnvironment = creds.environment || environment
    console.log(`Loaded Square credentials for tenant ${tenantId} from Vault`)
  } else {
    // Default: use env vars (backward compatible)
    squareAccessToken = process.env.SQUARE_ACCESS_TOKEN
    squareEnvironment = environment
  }

  // Validate environment
  await validateEnvironment(squareAccessToken, squareEnvironment)

  if (listExisting) {
    await listWebhookSubscriptions(squareAccessToken, squareEnvironment)
    return
  }

  if (deleteAll) {
    const subscriptions = await listWebhookSubscriptions(squareAccessToken, squareEnvironment)
    if (subscriptions.length > 0) {
      console.log('\n🗑️  Deleting all webhook subscriptions...')
      for (const sub of subscriptions) {
        const deleted = await deleteWebhookSubscription(sub.id, squareAccessToken, squareEnvironment)
        if (deleted) {
          console.log(`✅ Deleted: ${sub.id}`)
        }
      }
    }
    return
  }

  // Main setup flow
  const existingSubscriptions = await listWebhookSubscriptions(squareAccessToken, squareEnvironment)

  if (existingSubscriptions.length > 0) {
    console.log('\n⚠️  Found existing webhook subscriptions')
    console.log('💡 Use --delete-all to remove them first, or configure manually in Square Dashboard')
    return
  }

  const results = await setupWebhooks(squareAccessToken, squareEnvironment)
  displaySetupSummary(results)
}

// Run the tool
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Fatal error:', error.message)
    process.exit(1)
  })
}

module.exports = { main }