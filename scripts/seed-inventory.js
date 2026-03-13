#!/usr/bin/env node

/**
 * Inventory Seeding Script
 * Seeds the database with inventory items that match the Square menu items
 * Run with: node scripts/seed-inventory.js
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)

  let tenantId = null
  let tenantSlug = null
  const tenantIdArg = args.find(arg => arg.startsWith('--tenant-id='))
  if (tenantIdArg) tenantId = tenantIdArg.split('=')[1]
  const tenantSlugArg = args.find(arg => arg.startsWith('--tenant-slug='))
  if (tenantSlugArg) tenantSlug = tenantSlugArg.split('=')[1]

  return { tenantId, tenantSlug }
}

// Resolve tenant by slug
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

// First get supplier IDs
async function getSuppliers() {
  const { data: suppliers, error } = await supabase
    .from('suppliers')
    .select('id, name')

  if (error) {
    console.error('Error fetching suppliers:', error)
    return {}
  }

  return suppliers.reduce((acc, supplier) => {
    acc[supplier.name] = supplier.id
    return acc
  }, {})
}

async function seedInventoryItems(tenantId = null) {
  console.log('🌱 Starting inventory seeding process...')
  if (tenantId) {
    console.log(`🏢 Targeting tenant: ${tenantId}`)
  } else {
    console.log('🏢 Using default tenant (backward compatible)')
  }

  // Get supplier mappings
  const suppliers = await getSuppliers()
  console.log('📋 Found suppliers:', Object.keys(suppliers))

  // Define inventory items that map to menu items
  const inventoryItems = [
    // Coffee & Espresso Ingredients
    {
      square_item_id: 'GIFJJEPR5MRJGOCUPJI3K5Y3',
      item_name: 'Pike Place® Roast Coffee Beans',
      current_stock: 50,
      minimum_threshold: 10,
      reorder_point: 15,
      unit_cost: 8.50,
      unit_type: 'lb',
      supplier_id: suppliers['Local Coffee Roasters'],
      location: 'Coffee Storage',
      notes: 'Premium coffee beans for Pike Place Roast'
    },
    {
      square_item_id: 'UCT6VD4RATXRQS3WRAQ7FHQT',
      item_name: 'Espresso Beans',
      current_stock: 30,
      minimum_threshold: 8,
      reorder_point: 12,
      unit_cost: 12.00,
      unit_type: 'lb',
      supplier_id: suppliers['Local Coffee Roasters'],
      location: 'Coffee Storage',
      notes: 'High-quality espresso beans for americano and lattes'
    },
    {
      square_item_id: 'R3QHCZDAVPYIR4KNUW4HIYOC',
      item_name: 'Whole Milk',
      current_stock: 120,
      minimum_threshold: 20,
      reorder_point: 30,
      unit_cost: 4.50,
      unit_type: 'gallon',
      supplier_id: suppliers['Mile High Dairy'],
      location: 'Refrigerator',
      notes: 'Fresh whole milk for lattes and drinks'
    },

    // Frappuccino & Specialty Drinks
    {
      square_item_id: 'KGKM2UDBHOWTQ3SWR2HAHF23',
      item_name: 'Caramel Syrup',
      current_stock: 15,
      minimum_threshold: 3,
      reorder_point: 5,
      unit_cost: 6.25,
      unit_type: 'each',
      supplier_id: suppliers['Denver Bakery Supply'],
      location: 'Beverage Station',
      notes: 'Caramel syrup for frappuccinos'
    },
    {
      square_item_id: 'USUVWEFRWCV2KPXH65LURMXQ',
      item_name: 'Chocolate Syrup',
      current_stock: 12,
      minimum_threshold: 3,
      reorder_point: 5,
      unit_cost: 5.75,
      unit_type: 'each',
      supplier_id: suppliers['Denver Bakery Supply'],
      location: 'Beverage Station',
      notes: 'Rich chocolate syrup for mocha drinks'
    },
    {
      square_item_id: 'WHIPPED_CREAM_SUPPLY',
      item_name: 'Whipped Cream',
      current_stock: 8,
      minimum_threshold: 2,
      reorder_point: 4,
      unit_cost: 3.50,
      unit_type: 'each',
      supplier_id: suppliers['Mile High Dairy'],
      location: 'Refrigerator',
      notes: 'Fresh whipped cream for specialty drinks'
    },

    // Tea & Specialty Beverages
    {
      square_item_id: 'DRS7SJAHFVFT2FTSUARI6FMP',
      item_name: 'Chai Tea Concentrate',
      current_stock: 6,
      minimum_threshold: 2,
      reorder_point: 3,
      unit_cost: 8.99,
      unit_type: 'each',
      supplier_id: suppliers['Local Coffee Roasters'],
      location: 'Beverage Station',
      notes: 'Spiced chai concentrate for tea lattes'
    },
    {
      square_item_id: '3UMOIH5JVKGDJ2P44PKLYRHN',
      item_name: 'Matcha Powder',
      current_stock: 4,
      minimum_threshold: 1,
      reorder_point: 2,
      unit_cost: 15.99,
      unit_type: 'each',
      supplier_id: suppliers['Local Coffee Roasters'],
      location: 'Beverage Station',
      notes: 'Premium matcha powder for green tea lattes'
    },

    // Refreshers
    {
      square_item_id: 'ZIEPIYGFGVFI3UOC57GOKQD5',
      item_name: 'Mango Dragonfruit Base',
      current_stock: 5,
      minimum_threshold: 1,
      reorder_point: 2,
      unit_cost: 12.50,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Beverage Station',
      notes: 'Tropical fruit base for refreshers'
    },
    {
      square_item_id: 'AJ67PWKON3PS27RMBSYRHVEY',
      item_name: 'Strawberry Acai Base',
      current_stock: 5,
      minimum_threshold: 1,
      reorder_point: 2,
      unit_cost: 12.50,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Beverage Station',
      notes: 'Berry fruit base for refreshers'
    },

    // Food Items
    {
      square_item_id: 'MIFVY5ZOCGQRUSEZDJL6RXCU',
      item_name: 'Breakfast Burrito Tortillas',
      current_stock: 200,
      minimum_threshold: 30,
      reorder_point: 50,
      unit_cost: 0.35,
      unit_type: 'each',
      supplier_id: suppliers['Denver Bakery Supply'],
      location: 'Dry Storage',
      notes: 'Large flour tortillas for breakfast burritos'
    },
    {
      square_item_id: 'EGGS_SUPPLY',
      item_name: 'Eggs',
      current_stock: 60,
      minimum_threshold: 12,
      reorder_point: 20,
      unit_cost: 0.25,
      unit_type: 'each',
      supplier_id: suppliers['Mile High Dairy'],
      location: 'Refrigerator',
      notes: 'Fresh eggs for breakfast items'
    },
    {
      square_item_id: 'BACON_SUPPLY',
      item_name: 'Bacon',
      current_stock: 15,
      minimum_threshold: 3,
      reorder_point: 5,
      unit_cost: 8.50,
      unit_type: 'lb',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Refrigerator',
      notes: 'Premium bacon for breakfast items'
    },
    {
      square_item_id: 'ENGLISH_MUFFINS_SUPPLY',
      item_name: 'English Muffins',
      current_stock: 48,
      minimum_threshold: 10,
      reorder_point: 15,
      unit_cost: 0.45,
      unit_type: 'each',
      supplier_id: suppliers['Denver Bakery Supply'],
      location: 'Dry Storage',
      notes: 'Artisan English muffins for breakfast sandwiches'
    },
    {
      square_item_id: 'TURKEY_SLICES_SUPPLY',
      item_name: 'Turkey Slices',
      current_stock: 8,
      minimum_threshold: 2,
      reorder_point: 4,
      unit_cost: 12.99,
      unit_type: 'lb',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Refrigerator',
      notes: 'Sliced turkey for wraps'
    },
    {
      square_item_id: 'AVOCADOS_SUPPLY',
      item_name: 'Avocados',
      current_stock: 24,
      minimum_threshold: 6,
      reorder_point: 10,
      unit_cost: 1.25,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Produce Area',
      notes: 'Fresh avocados for wraps'
    },

    // Baked Goods
    {
      square_item_id: 'KUINOEOULKH4LVGGN6IUNJET',
      item_name: 'Blueberry Muffins',
      current_stock: 24,
      minimum_threshold: 6,
      reorder_point: 10,
      unit_cost: 1.95,
      unit_type: 'each',
      supplier_id: suppliers['Denver Bakery Supply'],
      location: 'Display Case',
      notes: 'Fresh baked blueberry muffins'
    },
    {
      square_item_id: 'HSTJS72WEGI4GLKAOZ645GJJ',
      item_name: 'Chocolate Chip Cookies',
      current_stock: 36,
      minimum_threshold: 8,
      reorder_point: 12,
      unit_cost: 1.45,
      unit_type: 'each',
      supplier_id: suppliers['Denver Bakery Supply'],
      location: 'Display Case',
      notes: 'Classic chocolate chip cookies'
    },
    {
      square_item_id: 'XT6W4DBLAEOCURYEFI2DZPAN',
      item_name: 'Butter Croissants',
      current_stock: 18,
      minimum_threshold: 4,
      reorder_point: 8,
      unit_cost: 1.75,
      unit_type: 'each',
      supplier_id: suppliers['Denver Bakery Supply'],
      location: 'Display Case',
      notes: 'Flaky European-style croissants'
    },

    // Snacks & Packaged Items
    {
      square_item_id: 'ZEZM7EQWC42CHRYI2L6PLN54',
      item_name: 'Mixed Nuts',
      current_stock: 25,
      minimum_threshold: 5,
      reorder_point: 10,
      unit_cost: 2.45,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Retail Display',
      notes: 'Premium mixed nuts'
    },
    {
      square_item_id: 'GVLFCBZQAM47VUHKWW2XGYX2',
      item_name: 'Protein Bars',
      current_stock: 30,
      minimum_threshold: 8,
      reorder_point: 15,
      unit_cost: 1.95,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Retail Display',
      notes: 'High-protein energy bars'
    },
    {
      square_item_id: 'LMADXAKD5XVJRPKXLNPFS7AP',
      item_name: 'Granola Bars',
      current_stock: 40,
      minimum_threshold: 10,
      reorder_point: 20,
      unit_cost: 1.75,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Retail Display',
      notes: 'Wholesome granola bars'
    },

    // Beverages
    {
      square_item_id: 'GA7UHTGKKADID3MQNUPKWK7X',
      item_name: 'Simply Lemonade',
      current_stock: 24,
      minimum_threshold: 6,
      reorder_point: 12,
      unit_cost: 1.15,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Refrigerated Cooler',
      notes: 'Bottled lemonade'
    },
    {
      square_item_id: '26VLTEHPTJHOVXVMFQOERNZ5',
      item_name: 'Clearly Canadian Sparkling Water',
      current_stock: 48,
      minimum_threshold: 12,
      reorder_point: 24,
      unit_cost: 0.75,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Retail Display',
      notes: 'Sparkling water bottles'
    },
    {
      square_item_id: '5OGTYJIU7K6YXVCE3CQIEGP5',
      item_name: 'Humankind Orange Juice',
      current_stock: 18,
      minimum_threshold: 4,
      reorder_point: 8,
      unit_cost: 1.95,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Refrigerated Cooler',
      notes: 'Premium orange juice'
    },
    {
      square_item_id: '4ZWQDCUPX65EJ6H7YQ246MMG',
      item_name: 'Pressed Juice - Raspberry',
      current_stock: 12,
      minimum_threshold: 3,
      reorder_point: 6,
      unit_cost: 1.95,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Refrigerated Cooler',
      notes: 'Fresh pressed raspberry juice'
    },
    {
      square_item_id: 'VYBGXODVDR22BNIWHH2WINXJ',
      item_name: 'Pressed Juice - Mango',
      current_stock: 12,
      minimum_threshold: 3,
      reorder_point: 6,
      unit_cost: 1.95,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Refrigerated Cooler',
      notes: 'Fresh pressed mango juice'
    },
    {
      square_item_id: 'DLUVZNCJM3CV34X3DROK74QA',
      item_name: 'Pressed Juice - Pineapple',
      current_stock: 12,
      minimum_threshold: 3,
      reorder_point: 6,
      unit_cost: 1.95,
      unit_type: 'each',
      supplier_id: suppliers['Fresh Produce Co'],
      location: 'Refrigerated Cooler',
      notes: 'Fresh pressed pineapple juice'
    },

    // Additional Seasonal
    {
      square_item_id: 'YRWALRYMLF4XIHJMQ75YOS3V',
      item_name: 'Pumpkin Spice Syrup',
      current_stock: 8,
      minimum_threshold: 2,
      reorder_point: 4,
      unit_cost: 7.50,
      unit_type: 'each',
      supplier_id: suppliers['Denver Bakery Supply'],
      location: 'Beverage Station',
      notes: 'Seasonal pumpkin spice syrup'
    },

    // Vanilla Bean Items
    {
      square_item_id: '4VSR2Y5DJIFVZB5SAW6W4ZDV',
      item_name: 'Vanilla Bean Syrup',
      current_stock: 10,
      minimum_threshold: 2,
      reorder_point: 4,
      unit_cost: 6.75,
      unit_type: 'each',
      supplier_id: suppliers['Denver Bakery Supply'],
      location: 'Beverage Station',
      notes: 'Premium vanilla bean syrup'
    },

    // Supplies & Packaging
    {
      square_item_id: 'PACKAGING_CUPS_TALL',
      item_name: 'Paper Cups - Tall (12oz)',
      current_stock: 500,
      minimum_threshold: 100,
      reorder_point: 200,
      unit_cost: 0.08,
      unit_type: 'each',
      supplier_id: suppliers['Paper & Packaging Plus'],
      location: 'Storage Room',
      notes: 'Tall size disposable cups',
      is_ingredient: false
    },
    {
      square_item_id: 'PACKAGING_CUPS_GRANDE',
      item_name: 'Paper Cups - Grande (16oz)',
      current_stock: 500,
      minimum_threshold: 100,
      reorder_point: 200,
      unit_cost: 0.10,
      unit_type: 'each',
      supplier_id: suppliers['Paper & Packaging Plus'],
      location: 'Storage Room',
      notes: 'Grande size disposable cups',
      is_ingredient: false
    },
    {
      square_item_id: 'PACKAGING_CUPS_VENTI',
      item_name: 'Paper Cups - Venti (20oz)',
      current_stock: 300,
      minimum_threshold: 75,
      reorder_point: 150,
      unit_cost: 0.12,
      unit_type: 'each',
      supplier_id: suppliers['Paper & Packaging Plus'],
      location: 'Storage Room',
      notes: 'Venti size disposable cups',
      is_ingredient: false
    },
    {
      square_item_id: 'PACKAGING_LIDS',
      item_name: 'Cup Lids - All Sizes',
      current_stock: 1000,
      minimum_threshold: 200,
      reorder_point: 400,
      unit_cost: 0.04,
      unit_type: 'each',
      supplier_id: suppliers['Paper & Packaging Plus'],
      location: 'Storage Room',
      notes: 'Universal fit cup lids',
      is_ingredient: false
    }
  ]

  try {
    console.log(`📦 Attempting to insert ${inventoryItems.length} inventory items...`)
    
    const { data, error } = await supabase
      .from('inventory_items')
      .insert(inventoryItems)
      .select()

    if (error) {
      console.error('❌ Error inserting inventory items:', error)
      return
    }

    console.log(`✅ Successfully inserted ${data.length} inventory items!`)

    // Add some stock movements to create history
    console.log('📊 Creating initial stock movement records...')
    
    const stockMovements = data.map(item => ({
      inventory_item_id: item.id,
      movement_type: 'purchase',
      quantity_change: item.current_stock,
      previous_stock: 0,
      new_stock: item.current_stock,
      unit_cost: item.unit_cost,
      reference_id: 'INITIAL_STOCK',
      notes: 'Initial inventory seeding'
    }))

    const { data: movements, error: movementError } = await supabase
      .from('stock_movements')
      .insert(stockMovements)

    if (movementError) {
      console.error('⚠️  Warning: Could not create stock movements:', movementError)
    } else {
      console.log(`✅ Created ${movements?.length || stockMovements.length} stock movement records`)
    }

    console.log('\n🎉 Inventory seeding completed successfully!')
    console.log('\n📋 Summary:')
    console.log(`   • ${data.length} inventory items added`)
    console.log(`   • Linked to ${Object.keys(suppliers).length} suppliers`)
    console.log(`   • Covers all major menu categories`)
    console.log(`   • Includes packaging and supplies`)
    console.log('\n💡 You can now view and manage inventory at /admin/inventory')

  } catch (error) {
    console.error('💥 Unexpected error during seeding:', error)
    process.exit(1)
  }
}

// Run the seeding process
async function main() {
  const { tenantId: parsedTenantId, tenantSlug } = parseArgs()

  // Resolve tenant
  let tenantId = parsedTenantId
  if (tenantSlug) {
    tenantId = await resolveTenantBySlug(supabase, tenantSlug)
    console.log(`Resolved tenant slug "${tenantSlug}" to ID: ${tenantId}`)
  }

  await seedInventoryItems(tenantId)
}

main()
  .then(() => {
    console.log('\n✨ Inventory seeding process completed!')
    process.exit(0)
  })
  .catch(error => {
    console.error('💥 Fatal error:', error)
    process.exit(1)
  })