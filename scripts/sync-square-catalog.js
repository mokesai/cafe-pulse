#!/usr/bin/env node

/**
 * Square Catalog Synchronization Tool
 * Fetches items from Square catalog and creates inventory records
 * Usage: node scripts/sync-square-catalog.js [--dry-run] [--admin-email=email]
 */

const { createClient } = require('@supabase/supabase-js')

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY

const adminEmail = process.env.ADMIN_EMAIL || 'jerry.mccommas@gmail.com'

// Square API configuration
const SQUARE_VERSION = '2024-12-18'

function showUsage() {
  console.log('\n🔄 Square Catalog Synchronization Tool')
  console.log('\nUsage:')
  console.log('  node scripts/sync-square-catalog.js [options]')
  console.log('\nOptions:')
  console.log('  --dry-run           Show what would be synchronized without making changes')
  console.log('  --admin-email=EMAIL Admin email for verification (default: jerry.mccommas@gmail.com)')
  console.log('  --tenant-id=UUID    Target a specific tenant by UUID')
  console.log('  --tenant-slug=SLUG  Target a specific tenant by slug (resolved to UUID)')
  console.log('\nExamples:')
  console.log('  node scripts/sync-square-catalog.js --dry-run')
  console.log('  node scripts/sync-square-catalog.js')
  console.log('  node scripts/sync-square-catalog.js --admin-email=admin@example.com')
  console.log('  node scripts/sync-square-catalog.js --tenant-id=00000000-0000-0000-0000-000000000002')
  console.log('  node scripts/sync-square-catalog.js --tenant-slug=demo-cafe')
  console.log('')
}

function parseArgs() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    showUsage()
    process.exit(0)
  }

  const dryRun = args.includes('--dry-run')

  let adminEmailArg = adminEmail
  const emailArg = args.find(arg => arg.startsWith('--admin-email='))
  if (emailArg) {
    adminEmailArg = emailArg.split('=')[1]
  }

  // Add tenant flag parsing
  let tenantId = null
  let tenantSlug = null
  const tenantIdArg = args.find(arg => arg.startsWith('--tenant-id='))
  if (tenantIdArg) tenantId = tenantIdArg.split('=')[1]
  const tenantSlugArg = args.find(arg => arg.startsWith('--tenant-slug='))
  if (tenantSlugArg) tenantSlug = tenantSlugArg.split('=')[1]

  return { dryRun, adminEmail: adminEmailArg, tenantId, tenantSlug }
}

async function validateEnvironment(squareAccessToken, squareLocationId, squareEnvironment) {
  const missing = []

  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!supabaseServiceKey) missing.push('SUPABASE_SECRET_KEY')

  // Only validate Square env vars if no tenant is specified
  if (!squareAccessToken) missing.push('SQUARE_ACCESS_TOKEN (or use --tenant-id/--tenant-slug)')
  if (!squareLocationId) missing.push('SQUARE_LOCATION_ID (or use --tenant-id/--tenant-slug)')

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:')
    missing.forEach(varName => console.error(`   - ${varName}`))
    console.error('\n💡 Make sure these are set in your .env.local file')
    process.exit(1)
  }

  console.log('✅ Environment variables loaded')
  console.log(`🏪 Square Environment: ${squareEnvironment || 'sandbox'}`)
  console.log(`📍 Location ID: ${squareLocationId}`)
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

async function validateAdminAccess(supabase, email) {
  console.log(`🔐 Verifying admin access for: ${email}`)

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, role')
      .eq('email', email)
      .single()

    if (error) {
      console.error('❌ Error checking admin profile:', error.message)
      console.error('💡 Make sure the admin email exists in the profiles table with role="admin"')
      process.exit(1)
    }

    if (!profile || profile.role !== 'admin') {
      console.error('❌ Access denied: User is not an admin')
      console.error('💡 Make sure the user has role="admin" in the profiles table')
      process.exit(1)
    }

    console.log('✅ Admin access verified')
    return profile
  } catch (error) {
    console.error('❌ Failed to verify admin access:', error.message)
    process.exit(1)
  }
}

function getSquareHeaders(accessToken) {
  return {
    'Square-Version': SQUARE_VERSION,
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
}

function getSquareBaseUrl(environment) {
  return environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
}

async function fetchSquareCatalog(accessToken, environment) {
  console.log('📦 Fetching Square catalog...')

  try {
    const baseUrl = getSquareBaseUrl(environment)
    const response = await fetch(`${baseUrl}/v2/catalog/search`, {
      method: 'POST',
      headers: getSquareHeaders(accessToken),
      body: JSON.stringify({
        object_types: ['ITEM', 'CATEGORY'],
        include_related_objects: true
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square API error: ${response.status} ${errorData}`)
    }

    const data = await response.json()
    console.log(`✅ Retrieved ${data.objects?.length || 0} catalog objects`)

    return data
  } catch (error) {
    console.error('❌ Error fetching Square catalog:', error.message)
    process.exit(1)
  }
}

async function getSupplierMappings(supabase) {
  try {
    const { data: suppliers, error } = await supabase
      .from('suppliers')
      .select('id, name')

    if (error) {
      console.error('❌ Error fetching suppliers:', error.message)
      process.exit(1)
    }

    const supplierMap = {}
    suppliers.forEach(supplier => {
      supplierMap[supplier.name] = supplier.id
    })

    console.log(`✅ Found ${suppliers.length} suppliers for mapping`)
    return { supplierMap, suppliers }
  } catch (error) {
    console.error('❌ Error getting supplier mappings:', error.message)
    process.exit(1)
  }
}

async function getExistingInventoryItems(supabase) {
  try {
    const { data: items, error } = await supabase
      .from('inventory_items')
      .select('square_item_id, item_name')

    if (error) {
      console.error('❌ Error fetching existing inventory:', error.message)
      return new Set()
    }

    const existingSquareIds = new Set(items.map(item => item.square_item_id))
    console.log(`📋 Found ${existingSquareIds.size} existing inventory items`)
    return existingSquareIds
  } catch (error) {
    console.error('⚠️  Warning: Could not fetch existing inventory items')
    return new Set()
  }
}

// Intelligent supplier mapping based on category and item name patterns
// Maps to your actual suppliers: Aspen Bakery, Odeko Inc, Gold Seal Distributing, Sam's Club, Walmart
function mapItemToSupplier(item, category, suppliers) {
  const itemName = item.item_data?.name?.toLowerCase() || ''
  const categoryName = category?.category_data?.name?.toLowerCase() || ''
  
  // Item name pattern mapping for specific suppliers
  const itemPatterns = {
    // Aspen Bakery: Croissants, Danish, Coffee Cakes, Baked goods
    'croissant': ['Aspen Bakery'],
    'danish': ['Aspen Bakery'],
    'coffee cake': ['Aspen Bakery'],
    'scone': ['Aspen Bakery'],
    'bear claw': ['Aspen Bakery'],
    'cinnamon roll': ['Aspen Bakery'],
    'apple turnover': ['Aspen Bakery'],
    'muffin': ['Aspen Bakery'],
    'bread': ['Aspen Bakery'],
    
    // Odeko Inc: Burritos, Sammies (Sandwiches), Savory items
    'burrito': ['Odeko, Inc.'],
    'sammies': ['Odeko, Inc.'],
    'sandwich': ['Odeko, Inc.'],
    'salad': ['Odeko, Inc.'],
    'soup': ['Odeko, Inc.'],
    'egg bites': ['Odeko, Inc.'],
    'oatmeal': ['Odeko, Inc.'],
    'quinoa': ['Odeko, Inc.'],
    'cookie': ['Odeko, Inc.'],
    
    // Little Man Creamery: Ice Cream
    'ice cream': ['Little Man Creamery'],

    // Gold Seal Distributing: Cake Pops, Brownies, Patter Bars, Specialty treats
    'cake pop': ['Gold Seal Distributing, LLC'],
    'brownie': ['Gold Seal Distributing, LLC'],
    'patter bar': ['Gold Seal Distributing, LLC'],
    'chocolate dipped strawberries': ['Gold Seal Distributing, LLC'],
    
    // Aurora Sam's Club / Walmart: Pre-packaged goods, beverages, snacks
    'bubble tea': ['Walmart Business, Aurora Supercenter'],
    'rice krispy': ['Aurora Sam\'s Club'],
    'fig bar': ['Aurora Sam\'s Club'],
    'gatorade': ['Aurora Sam\'s Club'],
    'red bull': ['Aurora Sam\'s Club'],
    'celsius': ['Aurora Sam\'s Club'],
    'smart water': ['Aurora Sam\'s Club'],
    'pure life': ['Aurora Sam\'s Club'],
    'hint water': ['Aurora Sam\'s Club'],
    'coconut water': ['Aurora Sam\'s Club'],
    'waterloo': ['Aurora Sam\'s Club'],
    'bubly': ['Aurora Sam\'s Club'],
    'coke': ['Aurora Sam\'s Club'],
    'izze': ['Aurora Sam\'s Club'],
    'honest kids': ['Aurora Sam\'s Club'],
    'v8': ['Aurora Sam\'s Club'],
    'kind bar': ['Aurora Sam\'s Club'],
    'trail mix': ['Aurora Sam\'s Club'],
    'pistachios': ['Aurora Sam\'s Club'],
    'edamame': ['Aurora Sam\'s Club'],
    'chips': ['Aurora Sam\'s Club'],
    'boulder canyon': ['Aurora Sam\'s Club'],
    'beef stick': ['Aurora Sam\'s Club'],
    'chocolate coated almonds': ['Aurora Sam\'s Club'],
    'granola bar': ['Aurora Sam\'s Club'],
    'chobani': ['Aurora Sam\'s Club'],
    'topo chico': ['Aurora Sam\'s Club'],
    'bagel': ['Aurora Sam\'s Club'],
    'cream cheese': ['Aurora Sam\'s Club']
  }

  // Beverage patterns - all beverages should go to Aurora Sam's Club
  const beveragePatterns = {
    'juice': ['Aurora Sam\'s Club'],
    'smoothie': ['Aurora Sam\'s Club'],
    'drink': ['Aurora Sam\'s Club'],
    'water': ['Aurora Sam\'s Club'],
    'milk': ['Aurora Sam\'s Club'],
    'soda': ['Aurora Sam\'s Club'],
    'energy': ['Aurora Sam\'s Club'],
    'sparkling': ['Aurora Sam\'s Club'],
    'lemonade': ['Aurora Sam\'s Club'],
    'acai': ['Aurora Sam\'s Club']
  }

  // Coffee ingredients only (not drinks) - for Nestle Professional Solutions
  const coffeeIngredientPatterns = {
    'coffee beans': ['Nestle Professional Solutions'],
    'espresso beans': ['Nestle Professional Solutions'],
    'ground coffee': ['Nestle Professional Solutions']
  }

  // Combine all patterns - order matters for precedence
  const allPatterns = { ...itemPatterns, ...beveragePatterns, ...coffeeIngredientPatterns }

  // Try item name pattern mapping - check longest matches first
  const sortedPatterns = Object.keys(allPatterns).sort((a, b) => b.length - a.length)
  
  for (const pattern of sortedPatterns) {
    if (itemName.includes(pattern)) {
      const supplierNames = allPatterns[pattern]
      const supplier = suppliers.find(s => supplierNames.includes(s.name))
      if (supplier) return supplier.id
    }
  }

  // Default fallback to Aurora Sam's Club (handles most packaged goods)
  const defaultSupplier = suppliers.find(s => s.name === 'Aurora Sam\'s Club')
  return defaultSupplier ? defaultSupplier.id : (suppliers.length > 0 ? suppliers[0].id : null)
}

// Generate intelligent defaults for inventory fields
function generateInventoryDefaults(item, category) {
  const itemName = item.item_data?.name?.toLowerCase() || ''
  const categoryName = category?.category_data?.name?.toLowerCase() || ''
  
  // Default stock levels based on item type
  let defaultStock = 10
  let minThreshold = 5
  let reorderPoint = 10
  let unitType = 'each'
  let location = 'main'
  let isIngredient = true

  // Coffee and beverage ingredients
  if (itemName.includes('coffee') || itemName.includes('espresso') || itemName.includes('syrup')) {
    if (itemName.includes('bean')) {
      defaultStock = 25
      minThreshold = 5
      reorderPoint = 10
      unitType = 'lb'
      location = 'Coffee Storage'
    } else if (itemName.includes('syrup')) {
      defaultStock = 8
      minThreshold = 2
      reorderPoint = 4
      location = 'Beverage Station'
    }
  }
  
  // Dairy products
  else if (itemName.includes('milk') || itemName.includes('cream') || itemName.includes('dairy')) {
    if (itemName.includes('milk')) {
      defaultStock = 20
      minThreshold = 5
      reorderPoint = 10
      unitType = 'gallon'
    } else {
      defaultStock = 12
      minThreshold = 3
      reorderPoint = 6
    }
    location = 'Refrigerator'
  }
  
  // Food ingredients
  else if (itemName.includes('egg') || itemName.includes('bacon') || itemName.includes('tortilla')) {
    if (itemName.includes('egg')) {
      defaultStock = 48
      minThreshold = 12
      reorderPoint = 24
    } else if (itemName.includes('tortilla')) {
      defaultStock = 100
      minThreshold = 20
      reorderPoint = 40
    } else {
      defaultStock = 10
      minThreshold = 2
      reorderPoint = 5
      unitType = 'lb'
    }
    location = itemName.includes('egg') || itemName.includes('bacon') ? 'Refrigerator' : 'Dry Storage'
  }
  
  // Finished baked goods
  else if (itemName.includes('muffin') || itemName.includes('cookie') || itemName.includes('croissant')) {
    defaultStock = 24
    minThreshold = 6
    reorderPoint = 12
    location = 'Display Case'
    isIngredient = false
  }
  
  // Beverages and bottled items
  else if (itemName.includes('juice') || itemName.includes('water') || itemName.includes('soda')) {
    defaultStock = 24
    minThreshold = 6
    reorderPoint = 12
    location = 'Refrigerated Cooler'
    isIngredient = false
  }
  
  // Packaging supplies
  else if (itemName.includes('cup') || itemName.includes('lid') || itemName.includes('bag')) {
    if (itemName.includes('cup')) {
      defaultStock = 500
      minThreshold = 100
      reorderPoint = 200
    } else if (itemName.includes('lid')) {
      defaultStock = 1000
      minThreshold = 200
      reorderPoint = 400
    }
    location = 'Storage Room'
    isIngredient = false
  }

  return {
    current_stock: defaultStock,
    minimum_threshold: minThreshold,
    reorder_point: reorderPoint,
    unit_type: unitType,
    location: location,
    is_ingredient: isIngredient
  }
}

// Determine if a Square item should be tracked as inventory (ingredient) or is a finished menu item
function shouldTrackAsInventory(item, category) {
  const itemName = item.item_data?.name?.toLowerCase() || ''
  const categoryName = category?.category_data?.name?.toLowerCase() || ''
  
  // Raw ingredients that should be tracked in inventory
  const ingredientPatterns = [
    // Coffee ingredients
    'coffee beans', 'espresso beans', 'ground coffee',
    // Dairy and eggs
    'milk', 'cream', 'half and half', 'cream cheese', 'cheese', 'egg',
    // Syrups and flavorings
    'syrup', 'sauce', 'flavoring', 'powder',
    // Baking ingredients
    'flour', 'sugar', 'butter', 'vanilla', 'cocoa',
    // Raw proteins
    'chicken breast', 'bacon strips', 'sausage links', 'turkey slices',
    // Vegetables and produce
    'lettuce', 'tomato', 'onion', 'avocado', 'spinach', 'cucumber',
    // Grains and bases
    'tortilla', 'bread', 'bagel', 'quinoa', 'rice',
    // Packaging and supplies
    'cup', 'lid', 'straw', 'napkin', 'bag', 'sleeve'
  ]
  
  // Pre-made items that ARE inventory (wholesale/retail items sold as-is)
  const wholesaleInventoryPatterns = [
    // Pre-packaged beverages
    'gatorade', 'red bull', 'celsius', 'smart water', 'coconut water', 'izze', 'honest kids',
    'bubble tea', 'bubly', 'waterloo', 'pure life purified water', 'apple juice', 'coke zero', 'mini soda',
    'cold pressed juice', 'coke bottle', 'hintwater', 'orange juice', 'topo chico', 'dubai drink',
    'energy drink',
    // Pre-packaged snacks
    'kind bar', 'trail mix', 'pistachios', 'chips', 'granola bar', 'chobani',
    'fig bar', 'patter bar', 'edamame beans', 'beef stick', 'apply turnover',
    // Pre-made baked goods (delivered daily)
    'croissant', 'danish', 'muffin', 'scone', 'bear claw', 'cinnamon roll', 'brownie',
    'snickerdoodle cookie', 'chocolate chip cookie', 'coffee cake',
    // Pre-made food items (delivered ready-to-sell)
    'sammies', 'egg bites', 'burrito', 'quinoa salad', 'oatmeal',
    // Ice cream products
    'ice cream', 'quart',
    // Cake pops and decorated items
    'cake pop', 'chocolate coated almonds'
  ]
  
  // Finished menu items that should NOT be tracked as inventory
  const finishedProductPatterns = [
    // All coffee and espresso drinks are finished products
    'latte', 'cappuccino', 'mocha', 'frappuccino', 'macchiato', 'cortado',
    'americano', 'flat white', 'espresso shot', 'cold brew', 'nitro', 'shaken espresso',
    'affogato', 'medicine ball', 'dirty chai',
    // Specialty drinks and chai
    'chai latte', 'chai creme', 'matcha latte', 'matcha creme', 'hot chocolate', 
    'steamed milk', 'tea lemonade',
    // All drinks with cream, foam, or flavor additions  
    'w/ vanilla', 'w/ cold foam', 'cream cold brew', 'cream chai', 'creamsicle',
    'pumpkin cream', 'apple crisp', 'ribbon crunch', 'cookie crumble',
    // Smoothies and blended drinks  
    'smoothie', 'dragon drink', 'pink drink', 'lotus', 'refresher', 'mango dragonfruit',
    'strawberry acai', 'pineapple passionfruit', 'peach green tea lemonade',
    // Made-to-order food items (assembled from ingredients)
    'avacado toast'
  ]
  
  // Check if it's explicitly an ingredient
  for (const pattern of ingredientPatterns) {
    if (itemName.includes(pattern)) {
      return { shouldTrack: true, reason: `Raw ingredient: ${pattern}` }
    }
  }
  
  // Check if it's a wholesale/retail item
  for (const pattern of wholesaleInventoryPatterns) {
    if (itemName.includes(pattern)) {
      return { shouldTrack: true, reason: `Wholesale/retail item: ${pattern}` }
    }
  }
  
  // Check if it's a finished menu item
  for (const pattern of finishedProductPatterns) {
    if (itemName.includes(pattern)) {
      return { shouldTrack: false, reason: `Finished menu item: ${pattern}` }
    }
  }
  
  // Default: if unclear, don't track (menu items are more common than raw ingredients)
  return { shouldTrack: false, reason: 'Default: likely finished menu item' }
}

function processSquareCatalog(catalogData, suppliers, existingSquareIds) {
  if (!catalogData.objects || catalogData.objects.length === 0) {
    console.log('⚠️  No objects found in Square catalog')
    return { newItems: [], categories: [], stats: { total: 0, new: 0, existing: 0 } }
  }

  const categories = catalogData.objects
    .filter(obj => obj.type === 'CATEGORY')
    .reduce((acc, cat) => {
      acc[cat.id] = cat
      return acc
    }, {})

  const items = catalogData.objects.filter(obj => obj.type === 'ITEM')
  const newItems = []
  const stats = {
    total: items.length,
    new: 0,
    existing: 0,
    categories: Object.keys(categories).length,
    skippedFinished: 0
  }

  console.log('\n📊 Processing Square catalog items...')
  console.log(`Found ${stats.total} items in ${stats.categories} categories`)

  items.forEach(item => {
    if (existingSquareIds.has(item.id)) {
      stats.existing++
      console.log(`⏩ Skipping existing item: ${item.item_data?.name}`)
      return
    }

    const category = categories[item.item_data?.category_id]
    
    // Check if this item should be tracked as inventory
    const inventoryCheck = shouldTrackAsInventory(item, category)
    if (!inventoryCheck.shouldTrack) {
      stats.skippedFinished++
      console.log(`🍽️  Skipping finished product: ${item.item_data?.name} (${inventoryCheck.reason})`)
      return
    }

    const defaults = generateInventoryDefaults(item, category)
    const supplierId = mapItemToSupplier(item, category, suppliers)
    
    const inventoryItem = {
      square_item_id: item.id,
      item_name: item.item_data?.name || 'Unknown Item',
      current_stock: defaults.current_stock,
      minimum_threshold: defaults.minimum_threshold,
      reorder_point: defaults.reorder_point,
      unit_cost: 0, // Will need to be set manually
      unit_type: defaults.unit_type,
      is_ingredient: defaults.is_ingredient,
      supplier_id: supplierId,
      location: defaults.location,
      notes: `Synced from Square catalog${category ? ` - Category: ${category.category_data?.name}` : ''}`,
      // Store additional Square metadata for future reference
      square_category_id: item.item_data?.category_id,
      square_category_name: category?.category_data?.name
    }

    newItems.push(inventoryItem)
    stats.new++
    
    console.log(`✨ New inventory item: ${inventoryItem.item_name} → ${defaults.location} (${suppliers.find(s => s.id === supplierId)?.name || 'No supplier'})`)
  })

  return { newItems, categories: Object.values(categories), stats }
}

async function syncInventoryItems(supabase, items, dryRun) {
  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No changes will be made')
    return { inserted: items, movements: [] }
  }

  if (items.length === 0) {
    console.log('ℹ️  No new items to sync')
    return { inserted: [], movements: [] }
  }

  console.log(`\n💾 Inserting ${items.length} new inventory items...`)
  
  try {
    // Remove Square metadata fields before inserting
    const dbItems = items.map(({ square_category_id, square_category_name, ...item }) => item)

    const { data, error } = await supabase
      .from('inventory_items')
      .insert(dbItems)
      .select('id, item_name, current_stock')

    if (error) {
      console.error('❌ Error inserting inventory items:', error.message)
      process.exit(1)
    }

    console.log('✅ Inventory items inserted successfully')
    
    // Create stock movements for items with stock
    const stockMovements = data
      .filter(item => item.current_stock > 0)
      .map(item => ({
        inventory_item_id: item.id,
        movement_type: 'purchase',
        quantity_change: item.current_stock,
        previous_stock: 0,
        new_stock: item.current_stock,
        reference_id: 'SQUARE_SYNC',
        notes: 'Initial stock from Square catalog sync'
      }))

    if (stockMovements.length > 0) {
      const { error: movementError } = await supabase
        .from('stock_movements')
        .insert(stockMovements)

      if (movementError) {
        console.error('⚠️  Warning: Could not create stock movements:', movementError.message)
      } else {
        console.log(`✅ Created ${stockMovements.length} stock movement records`)
      }
    }

    return { inserted: data, movements: stockMovements }
  } catch (error) {
    console.error('❌ Error syncing inventory items:', error.message)
    process.exit(1)
  }
}

function displaySyncSummary(stats, syncResult, dryRun, suppliers) {
  console.log('\n🎉 Square catalog synchronization completed!')
  console.log('\n📋 Sync Summary:')
  console.log(`   📦 Total Square Items: ${stats.total}`)
  console.log(`   🛒 Inventory Items Found: ${stats.new}`)
  console.log(`   🍽️  Finished Products Skipped: ${stats.skippedFinished}`)
  console.log(`   ✅ Existing Items Skipped: ${stats.existing}`)
  console.log(`   📁 Categories Available: ${stats.categories}`)
  console.log(`   🏢 Suppliers Used: ${suppliers.length}`)
  
  if (!dryRun) {
    console.log(`   💾 Items Inserted: ${syncResult.inserted.length}`)
    console.log(`   📊 Stock Movements Created: ${syncResult.movements.length}`)
  } else {
    console.log('   🔍 Mode: DRY RUN (no changes made)')
  }

  console.log('\n📝 Item Classification:')
  console.log('   🛒 Inventory Items: Raw ingredients, pre-packaged goods, supplies')
  console.log('   🍽️  Finished Products: Made-to-order drinks, prepared food (not tracked)')

  console.log('\n💡 Next steps:')
  console.log('   1. Review inventory items at /admin/inventory')
  console.log('   2. Add missing raw ingredients manually if needed')
  console.log('   3. Update unit costs for accurate inventory valuation')
  console.log('   4. Adjust stock levels and thresholds based on usage')
  if (dryRun) {
    console.log('   5. Run without --dry-run to apply changes')
  }
}

async function main() {
  const { dryRun, adminEmail: userEmail, tenantId: parsedTenantId, tenantSlug } = parseArgs()

  console.log('🔄 Square Catalog Synchronization Tool')
  console.log(`👤 Admin: ${userEmail}`)
  console.log(`🔍 Mode: ${dryRun ? 'DRY RUN' : 'SYNC'}`)
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
  let squareAccessToken, squareEnvironment, squareLocationId
  if (tenantId) {
    // Load from Vault
    const creds = await loadTenantSquareCredentials(supabase, tenantId)
    squareAccessToken = creds.access_token
    squareEnvironment = creds.environment
    squareLocationId = creds.location_id
    console.log(`Loaded Square credentials for tenant ${tenantId} from Vault`)
  } else {
    // Default: use env vars (backward compatible)
    squareAccessToken = process.env.SQUARE_ACCESS_TOKEN
    squareEnvironment = process.env.SQUARE_ENVIRONMENT || 'sandbox'
    squareLocationId = process.env.SQUARE_LOCATION_ID
  }

  // Validate environment
  await validateEnvironment(squareAccessToken, squareLocationId, squareEnvironment)

  // Validate admin access
  await validateAdminAccess(supabase, userEmail)

  // Get supplier mappings
  const { supplierMap, suppliers } = await getSupplierMappings(supabase)

  // Get existing inventory items
  const existingSquareIds = await getExistingInventoryItems(supabase)

  // Fetch Square catalog
  const catalogData = await fetchSquareCatalog(squareAccessToken, squareEnvironment)

  // Process catalog and generate inventory items
  const { newItems, categories, stats } = processSquareCatalog(catalogData, suppliers, existingSquareIds)

  // Sync items to database
  const syncResult = await syncInventoryItems(supabase, newItems, dryRun)

  // Display summary
  displaySyncSummary(stats, syncResult, dryRun, suppliers)
}

// Run the tool
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Fatal error:', error.message)
    process.exit(1)
  })
}

module.exports = { main }
