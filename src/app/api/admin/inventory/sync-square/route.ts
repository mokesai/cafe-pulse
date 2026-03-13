import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import type { SquareConfig } from '@/lib/square/types'

const SQUARE_VERSION = '2024-12-18'

interface SquareSyncRequest {
  dryRun?: boolean
}

interface InventoryItemInput {
  square_item_id: string
  item_name: string
  current_stock: number
  minimum_threshold: number
  reorder_point: number
  unit_cost: number
  unit_type: 'each' | 'lb' | 'oz' | 'gallon' | 'liter' | 'ml'
  is_ingredient: boolean
  supplier_id?: string | null
  location: string
  notes: string
}

type SquareCategory = {
  id: string
  type: 'CATEGORY'
  category_data?: {
    name?: string
  }
}

type SquareItem = {
  id: string
  type: 'ITEM'
  item_data?: {
    name?: string
    category_id?: string
  }
}

type SquareCatalog = {
  objects?: (SquareItem | SquareCategory)[]
}

type SupplierRow = {
  id: string
  name: string
}

type InventoryInsertResult = {
  id: string
  item_name: string
  current_stock: number
}

function getSquareHeaders(config: SquareConfig) {
  return {
    'Square-Version': SQUARE_VERSION,
    'Authorization': `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json'
  }
}

async function fetchSquareCatalog(config: SquareConfig): Promise<SquareCatalog> {
  const baseUrl = config.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'

  const response = await fetch(`${baseUrl}/v2/catalog/search`, {
    method: 'POST',
    headers: getSquareHeaders(config),
    body: JSON.stringify({
      object_types: ['ITEM', 'CATEGORY'],
      include_related_objects: true
    })
  })

  if (!response.ok) {
    const errorData = await response.text()
    throw new Error(`Square API error: ${response.status} ${errorData}`)
  }

  return await response.json()
}

async function getSupplierMappings(supabase: ReturnType<typeof createServiceClient>) {
  const { data: suppliers, error } = await supabase
    .from('suppliers')
    .select('id, name')

  if (error) {
    throw new Error(`Failed to fetch suppliers: ${error.message}`)
  }

  return (suppliers ?? []) as SupplierRow[]
}

async function getExistingInventoryItems(supabase: ReturnType<typeof createServiceClient>, tenantId: string) {
  const { data: items, error } = await supabase
    .from('inventory_items')
    .select('square_item_id, item_name')
    .eq('tenant_id', tenantId)

  if (error) {
    console.warn('Warning: Could not fetch existing inventory items')
    return new Set()
  }

  return new Set((items ?? []).map(item => item.square_item_id))
}

// Intelligent supplier mapping based on category and item name patterns
function mapItemToSupplier(item: SquareItem, category: SquareCategory | undefined, suppliers: SupplierRow[]) {
  const itemName = item.item_data?.name?.toLowerCase() || ''
  const categoryName = category?.category_data?.name?.toLowerCase() || ''

  // Category-based mapping rules
  const categoryMappings: Record<string, string[]> = {
    'coffee': ['Premium Coffee Roasters'],
    'drinks': ['Premium Coffee Roasters'],
    'espresso': ['Premium Coffee Roasters'],
    'tea': ['Premium Coffee Roasters'],
    'dairy': ['Local Dairy Cooperative'],
    'milk': ['Local Dairy Cooperative'],
    'breakfast': ['Denver Bakery Supply Co'],
    'bakery': ['Denver Bakery Supply Co'],
    'pastries': ['Denver Bakery Supply Co'],
    'sweets': ['Denver Bakery Supply Co'],
    'produce': ['Mountain Fresh Produce'],
    'fresh': ['Mountain Fresh Produce'],
    'juice': ['Mountain Fresh Produce'],
    'packaging': ['Eco-Friendly Packaging'],
    'cups': ['Eco-Friendly Packaging'],
    'supplies': ['Eco-Friendly Packaging']
  }

  // Item name pattern mapping
  const itemPatterns: Record<string, string[]> = {
    'coffee': ['Premium Coffee Roasters'],
    'espresso': ['Premium Coffee Roasters'],
    'latte': ['Premium Coffee Roasters'],
    'americano': ['Premium Coffee Roasters'],
    'cappuccino': ['Premium Coffee Roasters'],
    'frappuccino': ['Premium Coffee Roasters'],
    'chai': ['Premium Coffee Roasters'],
    'matcha': ['Premium Coffee Roasters'],
    'milk': ['Local Dairy Cooperative'],
    'cream': ['Local Dairy Cooperative'],
    'dairy': ['Local Dairy Cooperative'],
    'cheese': ['Local Dairy Cooperative'],
    'egg': ['Local Dairy Cooperative'],
    'muffin': ['Denver Bakery Supply Co'],
    'cookie': ['Denver Bakery Supply Co'],
    'croissant': ['Denver Bakery Supply Co'],
    'bagel': ['Denver Bakery Supply Co'],
    'sandwich': ['Denver Bakery Supply Co'],
    'burrito': ['Denver Bakery Supply Co'],
    'syrup': ['Denver Bakery Supply Co'],
    'sauce': ['Denver Bakery Supply Co'],
    'juice': ['Mountain Fresh Produce'],
    'smoothie': ['Mountain Fresh Produce'],
    'fruit': ['Mountain Fresh Produce'],
    'veggie': ['Mountain Fresh Produce'],
    'salad': ['Mountain Fresh Produce'],
    'avocado': ['Mountain Fresh Produce'],
    'nuts': ['Mountain Fresh Produce'],
    'water': ['Mountain Fresh Produce'],
    'cup': ['Eco-Friendly Packaging'],
    'lid': ['Eco-Friendly Packaging'],
    'napkin': ['Eco-Friendly Packaging'],
    'bag': ['Eco-Friendly Packaging']
  }

  // Try category mapping first
  for (const [pattern, supplierNames] of Object.entries(categoryMappings)) {
    if (categoryName.includes(pattern)) {
      const supplier = suppliers.find(s => supplierNames.includes(s.name))
      if (supplier) return supplier.id
    }
  }

  // Try item name pattern mapping
  for (const [pattern, supplierNames] of Object.entries(itemPatterns)) {
    if (itemName.includes(pattern)) {
      const supplier = suppliers.find(s => supplierNames.includes(s.name))
      if (supplier) return supplier.id
    }
  }

  // Default to first available supplier
  return suppliers.length > 0 ? suppliers[0].id : null
}

// Generate intelligent defaults for inventory fields
function generateInventoryDefaults(item: SquareItem) {
  const itemName = item.item_data?.name?.toLowerCase() || ''

  // Default stock levels based on item type
  let defaultStock = 10
  let minThreshold = 5
  let reorderPoint = 10
  let unitType: 'each' | 'lb' | 'oz' | 'gallon' | 'liter' | 'ml' = 'each'
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

function processSquareCatalog(
  catalogData: SquareCatalog,
  suppliers: SupplierRow[],
  existingSquareIds: Set<string>
) {
  if (!catalogData.objects || catalogData.objects.length === 0) {
    return { newItems: [], stats: { total: 0, new: 0, existing: 0, categories: 0 } }
  }

  const categories = catalogData.objects
    .filter((obj): obj is SquareCategory => obj.type === 'CATEGORY')
    .reduce((acc: Record<string, SquareCategory>, cat) => {
      acc[cat.id] = cat
      return acc
    }, {})

  const items = catalogData.objects.filter((obj): obj is SquareItem => obj.type === 'ITEM')
  const newItems: InventoryItemInput[] = []
  const stats = {
    total: items.length,
    new: 0,
    existing: 0,
    categories: Object.keys(categories).length
  }

  items.forEach((item) => {
    if (existingSquareIds.has(item.id)) {
      stats.existing++
      return
    }

    const category = item.item_data?.category_id ? categories[item.item_data.category_id] : undefined
    const defaults = generateInventoryDefaults(item)
    const supplierId = mapItemToSupplier(item, category, suppliers)

    const inventoryItem: InventoryItemInput = {
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
      notes: `Synced from Square catalog${category ? ` - Category: ${category.category_data?.name}` : ''}`
    }

    newItems.push(inventoryItem)
    stats.new++
  })

  return { newItems, stats }
}

async function syncInventoryItems(supabase: ReturnType<typeof createServiceClient>, tenantId: string, items: InventoryItemInput[], dryRun: boolean) {
  if (dryRun || items.length === 0) {
    return { inserted: items, movements: [] }
  }

  const { data, error } = await supabase
    .from('inventory_items')
    .insert(items.map(item => ({ ...item, tenant_id: tenantId })))
    .select('id, item_name, current_stock')

  if (error) {
    throw new Error(`Failed to insert inventory items: ${error.message}`)
  }

  // Create stock movements for items with stock
  const stockMovements = data
    .filter(item => item.current_stock > 0)
    .map(item => ({
      tenant_id: tenantId,
      inventory_item_id: item.id,
      movement_type: 'purchase',
      quantity_change: item.current_stock,
      previous_stock: 0,
      new_stock: item.current_stock,
      reference_id: 'SQUARE_SYNC_API',
      notes: 'Initial stock from Square catalog sync via API'
    }))

  if (stockMovements.length > 0) {
    const { error: movementError } = await supabase
      .from('stock_movements')
      .insert(stockMovements)

    if (movementError) {
      console.warn('Warning: Could not create stock movements:', movementError.message)
    }
  }

  const insertedItems = (data ?? []) as InventoryInsertResult[]
  return { inserted: insertedItems, movements: stockMovements }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    const body: SquareSyncRequest = await request.json()

    const dryRun = body.dryRun || false

    // Resolve tenant and load Square config
    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json({ error: 'Square not configured' }, { status: 503 })
    }

    // Create per-request Supabase client
    const supabase = createServiceClient()

    // Fetch Square catalog
    const catalogData = await fetchSquareCatalog(squareConfig)

    // Get supplier mappings
    const suppliers = await getSupplierMappings(supabase)

    // Get existing inventory items
    const existingSquareIds = await getExistingInventoryItems(supabase, tenantId)

    // Process catalog and generate inventory items
    const { newItems, stats } = processSquareCatalog(catalogData, suppliers, existingSquareIds)

    // Sync items to database
    const syncResult = await syncInventoryItems(supabase, tenantId, newItems, dryRun)

    // Calculate summary
    const summary = {
      squareStats: stats,
      syncStats: {
        itemsProcessed: newItems.length,
        itemsInserted: syncResult.inserted.length,
        stockMovementsCreated: syncResult.movements.length,
        suppliersUsed: suppliers.length,
        dryRun
      }
    }

    return NextResponse.json({
      success: true,
      message: `Square catalog sync ${dryRun ? 'preview' : 'completed'} successfully`,
      summary,
      newItems: dryRun ? newItems : undefined // Only include item details in dry run
    })

  } catch (error) {
    console.error('Square catalog sync error:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        success: false
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Square catalog sync API endpoint',
    methods: ['POST'],
    requiredFields: [],
    optionalFields: ['dryRun'],
    description: 'Synchronizes Square catalog items with local inventory system',
    features: [
      'Intelligent supplier mapping based on item categories and names',
      'Smart inventory defaults (stock levels, locations, unit types)',
      'Automatic stock movement creation',
      'Dry run mode for previewing changes',
      'Admin access validation'
    ]
  })
}
