import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface InventoryItemInput {
  square_item_id: string
  item_name: string
  current_stock?: number
  minimum_threshold?: number
  reorder_point?: number
  unit_cost?: number
  unit_type?: 'each' | 'lb' | 'oz' | 'gallon' | 'liter' | 'ml'
  is_ingredient?: boolean
  supplier_id?: string
  location?: string
  notes?: string
  last_restocked_at?: string
}

interface BulkUploadRequest {
  items: InventoryItemInput[]
  replace?: boolean
}

async function validateInventoryItems(
  items: InventoryItemInput[],
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string
) {
  const errors: string[] = []
  const requiredFields = ['square_item_id', 'item_name']
  const validUnitTypes = ['each', 'lb', 'oz', 'gallon', 'liter', 'ml']

  // Get existing square_item_ids to check for duplicates (tenant-scoped)
  const { data: existingItems } = await supabase
    .from('inventory_items')
    .select('square_item_id')
    .eq('tenant_id', tenantId)

  const existingSquareIds = new Set(existingItems?.map(item => item.square_item_id) || [])
  const newSquareIds = new Set()

  items.forEach((item, index) => {
    // Check required fields
    requiredFields.forEach(field => {
      if (!item[field as keyof InventoryItemInput]) {
        errors.push(`Item ${index + 1}: Missing required field "${field}"`)
      }
    })

    // Check for duplicate square_item_ids within the upload
    if (newSquareIds.has(item.square_item_id)) {
      errors.push(`Item ${index + 1}: Duplicate square_item_id "${item.square_item_id}" in upload`)
    } else {
      newSquareIds.add(item.square_item_id)
    }

    // Check if square_item_id already exists in database
    if (existingSquareIds.has(item.square_item_id)) {
      errors.push(`Item ${index + 1}: square_item_id "${item.square_item_id}" already exists in database`)
    }

    // Validate unit_type
    if (item.unit_type && !validUnitTypes.includes(item.unit_type)) {
      errors.push(`Item ${index + 1}: Invalid unit_type "${item.unit_type}". Must be one of: ${validUnitTypes.join(', ')}`)
    }

    // Validate numeric fields
    const numericFields: (keyof InventoryItemInput)[] = ['current_stock', 'minimum_threshold', 'reorder_point', 'unit_cost']
    numericFields.forEach(field => {
      const value = item[field]
      if (value !== undefined && (isNaN(Number(value)) || Number(value) < 0)) {
        errors.push(`Item ${index + 1}: Field "${field}" must be a non-negative number`)
      }
    })

    // Validate reorder_point >= minimum_threshold
    if (item.reorder_point !== undefined && item.minimum_threshold !== undefined) {
      if (item.reorder_point < item.minimum_threshold) {
        errors.push(`Item ${index + 1}: reorder_point (${item.reorder_point}) must be >= minimum_threshold (${item.minimum_threshold})`)
      }
    }

    // Validate supplier_id exists if provided
    if (item.supplier_id) {
      // We'll validate this in the database constraint, but could add a check here if needed
    }
  })

  if (errors.length > 0) {
    throw new Error(`Validation errors: ${errors.join('; ')}`)
  }
}

async function clearExistingInventory(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string
) {
  const { error } = await supabase
    .from('inventory_items')
    .delete()
    .eq('tenant_id', tenantId)
    .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all records

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found, which is OK
    throw new Error(`Failed to clear existing inventory: ${error.message}`)
  }
}

async function insertInventoryItems(
  items: InventoryItemInput[],
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string
) {
  // Transform items for database
  const dbItems = items.map(item => ({
    square_item_id: item.square_item_id,
    item_name: item.item_name,
    current_stock: item.current_stock || 0,
    minimum_threshold: item.minimum_threshold || 5,
    reorder_point: item.reorder_point || 10,
    unit_cost: item.unit_cost || 0,
    unit_type: item.unit_type || 'each',
    is_ingredient: item.is_ingredient !== false, // Default to true unless explicitly false
    supplier_id: item.supplier_id || null,
    location: item.location || 'main',
    notes: item.notes || null,
    last_restocked_at: item.last_restocked_at ? new Date(item.last_restocked_at) : null,
    tenant_id: tenantId,
  }))

  const { data, error } = await supabase
    .from('inventory_items')
    .insert(dbItems)
    .select('id, item_name, current_stock')

  if (error) {
    throw new Error(`Failed to insert inventory items: ${error.message}`)
  }

  return (data ?? []) as InsertedInventoryItem[]
}

type InsertedInventoryItem = {
  id: string
  current_stock: number
}

async function createStockMovements(
  inventoryItems: InsertedInventoryItem[],
  supabase: ReturnType<typeof createServiceClient>
) {
  const stockMovements = inventoryItems
    .filter(item => item.current_stock > 0)
    .map(item => ({
      inventory_item_id: item.id,
      movement_type: 'purchase',
      quantity_change: item.current_stock,
      previous_stock: 0,
      new_stock: item.current_stock,
      reference_id: 'BULK_UPLOAD_API',
      notes: 'Initial inventory bulk upload via API'
    }))

  if (stockMovements.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from('stock_movements')
    .insert(stockMovements)
    .select('id')

  if (error) {
    // Don't throw error for stock movements, just log warning
    console.warn('Warning: Could not create stock movements:', error.message)
    return []
  }

  return data
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    const body: BulkUploadRequest = await request.json()

    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: 'Items array is required and must not be empty' },
        { status: 400 }
      )
    }

    // Validate inventory items
    await validateInventoryItems(body.items, supabase, tenantId)

    // Clear existing inventory if replace mode
    if (body.replace) {
      await clearExistingInventory(supabase, tenantId)
    }

    // Insert inventory items
    const insertedItems = await insertInventoryItems(body.items, supabase, tenantId)

    // Create stock movements
    const stockMovements = await createStockMovements(insertedItems, supabase)

    // Calculate summary stats
    const stats = {
      totalItems: insertedItems.length,
      ingredients: body.items.filter(item => item.is_ingredient !== false).length,
      finishedProducts: body.items.filter(item => item.is_ingredient === false).length,
      totalStock: body.items.reduce((sum, item) => sum + (item.current_stock || 0), 0),
      totalValue: body.items.reduce((sum, item) => sum + ((item.current_stock || 0) * (item.unit_cost || 0)), 0),
      stockMovementsCreated: stockMovements.length,
      mode: body.replace ? 'replace' : 'merge'
    }

    return NextResponse.json({
      success: true,
      message: 'Inventory items uploaded successfully',
      stats
    })

  } catch (error) {
    console.error('Bulk inventory upload error:', error)

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
    message: 'Inventory bulk upload API endpoint',
    methods: ['POST'],
    requiredFields: ['items'],
    optionalFields: ['replace'],
    itemFields: {
      required: ['square_item_id', 'item_name'],
      optional: ['current_stock', 'minimum_threshold', 'reorder_point', 'unit_cost', 'unit_type', 'is_ingredient', 'supplier_id', 'location', 'notes', 'last_restocked_at']
    }
  })
}
