import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantSquareConfig, resolveTenantFromMerchantId } from '@/lib/square/config'
import type { SquareConfig } from '@/lib/square/types'

interface SquareCatalogWebhookEvent {
  type: 'catalog.version.updated'
  event_id: string
  created_at: string
  merchant_id: string
  data: {
    type: 'catalog_version'
    object: {
      catalog_version: {
        updated_at: string
      }
    }
  }
}

interface CatalogCategoryData {
  name?: string
  description?: string
  ordinal?: number
  parent_category?: {
    id: string
  }
}

interface CatalogItemVariation {
  id: string
  item_variation_data?: {
    name?: string
    price_money?: { amount?: number }
  }
}

interface CatalogItemData {
  name?: string
  description?: string
  categories?: { id: string }[]
  category_id?: string
  variations?: CatalogItemVariation[]
  image_ids?: string[]
  is_deleted?: boolean
  is_archived?: boolean
  modifier_list_info?: {
    modifier_list_id: string
    name?: string
  }[]
}

interface CatalogObject {
  id: string
  type: string
  item_data?: CatalogItemData
  category_data?: CatalogCategoryData
  is_deleted?: boolean
  present_at_all_locations?: boolean
}

interface CatalogResponse {
  objects?: CatalogObject[]
}

interface SupplierRecord {
  id: string
  name?: string | null
}

interface ExistingInventoryItem {
  id: string
  square_item_id: string | null
  item_name: string
  updated_at?: string
  notes?: string | null
}

interface InventoryDefaults {
  current_stock: number
  minimum_threshold: number
  reorder_point: number
  unit_type: string
  is_ingredient: boolean
  location: string
}

interface SyncResult {
  newItems: number
  updatedItems: number
  categories: number
}

interface CatalogSearchRequest {
  object_types: string[]
  include_related_objects: boolean
  begin_time?: string
}

const isItemObject = (obj: CatalogObject): obj is CatalogObject & { item_data: CatalogItemData } =>
  obj.type === 'ITEM' && !!obj.item_data

const isCategoryObject = (
  obj: CatalogObject
): obj is CatalogObject & { category_data: CatalogCategoryData } =>
  obj.type === 'CATEGORY' && !!obj.category_data

// Verify Square webhook signature
function verifySquareSignature(body: string, signature: string, secret: string): boolean {
  if (!secret || !signature) {
    console.warn('⚠️  Webhook signature verification skipped (no secret configured)')
    return true // Allow in development
  }

  try {
    const url = `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/square/catalog`
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const payload = `${url}${body}${timestamp}`

    const hash = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64')

    const expectedSignature = `sha256=${hash}`

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch (error) {
    console.error('Error verifying webhook signature:', error)
    return false
  }
}

function makeSquareHeaders(config: SquareConfig) {
  return {
    'Square-Version': '2024-12-18',
    'Authorization': `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json'
  }
}

async function getLastCatalogSync() {
  try {
    const supabase = createServiceClient()
    const { data: lastSync, error } = await supabase
      .from('webhook_events')
      .select('processed_at, event_data')
      .eq('event_type', 'catalog.version.updated')
      .order('processed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('Warning: Could not fetch last catalog sync time')
      return null
    }

    return lastSync?.processed_at ? new Date(lastSync.processed_at) : null
  } catch (error) {
    console.warn('Warning: Could not fetch last catalog sync time', error)
    return null
  }
}

async function fetchCatalogChanges(config: SquareConfig, sinceTimestamp?: Date): Promise<CatalogResponse> {
  try {
    const baseUrl = config.environment === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com'

    const query: CatalogSearchRequest = {
      object_types: ['ITEM', 'CATEGORY'],
      include_related_objects: true
    }

    // If we have a timestamp, only fetch changes since then
    if (sinceTimestamp) {
      query.begin_time = sinceTimestamp.toISOString()
    }

    const response = await fetch(`${baseUrl}/v2/catalog/search`, {
      method: 'POST',
      headers: makeSquareHeaders(config),
      body: JSON.stringify(query)
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error fetching catalog changes:', error)
    throw error
  }
}

async function syncCatalogChanges(catalogData: CatalogResponse): Promise<SyncResult> {
  if (!catalogData.objects || catalogData.objects.length === 0) {
    return { newItems: 0, updatedItems: 0, categories: 0 }
  }

  const categories = catalogData.objects.filter(isCategoryObject)
  const items = catalogData.objects.filter(isItemObject)

  let newItems = 0
  let updatedItems = 0

  // Get existing inventory items
  const supabase = createServiceClient()
  const { data: existingItemsRaw, error } = await supabase
    .from('inventory_items')
    .select('id, square_item_id, item_name, updated_at, notes')

  if (error) {
    throw new Error(`Failed to fetch existing inventory: ${error.message}`)
  }

  const existingItems = (existingItemsRaw || []) as ExistingInventoryItem[]

  const existingItemMap = new Map()
  existingItems.forEach(item => {
    if (item.square_item_id) {
      existingItemMap.set(item.square_item_id, item)
    }
  })

  // Get supplier mappings
  const { data: suppliersRaw, error: supplierError } = await supabase
    .from('suppliers')
    .select('id, name')

  if (supplierError) {
    throw new Error(`Failed to fetch suppliers: ${supplierError.message}`)
  }
  const suppliers = (suppliersRaw || []) as SupplierRecord[]

  // Process catalog items
  for (const item of items) {
    const existingItem = existingItemMap.get(item.id)
    
    if (existingItem) {
      // Update existing item (only item name and description from Square)
      const updates: Partial<Pick<ExistingInventoryItem, 'item_name' | 'notes'>> = {}
      
      if (item.item_data?.name && item.item_data.name !== existingItem.item_name) {
        updates.item_name = item.item_data.name
        updates.notes = (existingItem.notes || '') + ` [Square update: ${new Date().toISOString()}]`
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('inventory_items')
          .update(updates)
          .eq('id', existingItem.id)

        if (!updateError) {
          updatedItems++
          console.log(`✨ Updated item: ${item.item_data?.name}`)
        }
      }
    } else {
      // Create new inventory item with intelligent defaults
      const categoryObj = categories.find((cat) => cat.id === item.item_data?.category_id)
      const supplierId = mapItemToSupplier(item, categoryObj, suppliers)
      const defaults = generateInventoryDefaults(item, categoryObj)

      const newInventoryItem = {
        square_item_id: item.id,
        item_name: item.item_data?.name || 'Unknown Item',
        current_stock: defaults.current_stock,
        minimum_threshold: defaults.minimum_threshold,
        reorder_point: defaults.reorder_point,
        unit_cost: 0, // Default to 0, will be enriched later
        unit_type: defaults.unit_type,
        is_ingredient: defaults.is_ingredient,
        supplier_id: supplierId,
        location: defaults.location,
        notes: `Auto-created from Square webhook - Category: ${categoryObj?.category_data?.name || 'Unknown'}`
      }

      const { error: insertError } = await supabase
        .from('inventory_items')
        .insert([newInventoryItem])

      if (!insertError) {
        newItems++
        console.log(`🆕 Created new item: ${item.item_data?.name}`)
      }
    }
  }

  return { newItems, updatedItems, categories: categories.length }
}

// Helper functions (reused from other sync tools)
function mapItemToSupplier(
  item: CatalogObject & { item_data: CatalogItemData },
  category: (CatalogObject & { category_data: CatalogCategoryData }) | undefined,
  suppliers: SupplierRecord[]
) {
  const itemName = item.item_data?.name?.toLowerCase() || ''
  const categoryName = category?.category_data?.name?.toLowerCase() || ''
  
  const patterns = {
    'coffee': 'Premium Coffee Roasters',
    'dairy': 'Local Dairy Cooperative',
    'bakery': 'Denver Bakery Supply Co',
    'produce': 'Mountain Fresh Produce',
    'packaging': 'Eco-Friendly Packaging'
  }

  for (const [pattern, supplierName] of Object.entries(patterns)) {
    if (itemName.includes(pattern) || categoryName.includes(pattern)) {
      const supplier = suppliers.find(s => s.name === supplierName)
      if (supplier) return supplier.id
    }
  }

  return suppliers.length > 0 ? suppliers[0].id : null
}

function generateInventoryDefaults(
  item: CatalogObject & { item_data: CatalogItemData },
  category: (CatalogObject & { category_data: CatalogCategoryData }) | undefined
): InventoryDefaults {
  const itemName = item.item_data?.name?.toLowerCase() || ''
  const categoryName = category?.category_data?.name?.toLowerCase() || ''
  
  let defaultStock = 10
  let minThreshold = 3
  let reorderPoint = 6
  let unitType: 'each' | 'lb' | 'oz' | 'gallon' | 'liter' | 'ml' = 'each'
  let location = 'main'
  let isIngredient = true

  // Apply intelligent defaults based on item patterns
  if (itemName.includes('coffee') || itemName.includes('bean') || categoryName.includes('coffee')) {
    defaultStock = 25
    minThreshold = 5
    reorderPoint = 10
    unitType = 'lb'
    location = 'Coffee Storage'
  } else if (itemName.includes('milk') || categoryName.includes('dairy')) {
    defaultStock = 20
    minThreshold = 5
    reorderPoint = 10
    unitType = 'gallon'
    location = 'Refrigerator'
  } else if (itemName.includes('muffin') || itemName.includes('cookie') || categoryName.includes('bakery')) {
    defaultStock = 24
    minThreshold = 6
    reorderPoint = 12
    location = 'Display Case'
    isIngredient = false
  } else if (itemName.includes('cup')) {
    defaultStock = 500
    minThreshold = 100
    reorderPoint = 200
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

async function logWebhookEvent(event: SquareCatalogWebhookEvent, syncResult: SyncResult) {
  try {
    // Log webhook processing for audit trail
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('webhook_events')
      .insert([{
        event_id: event.event_id,
        event_type: event.type,
        merchant_id: event.merchant_id,
        event_data: event,
        sync_result: syncResult,
        processed_at: new Date().toISOString()
      }])

    if (error) {
      console.warn('Warning: Could not log webhook event:', error.message)
    }
  } catch (error) {
    console.warn('Warning: Could not log webhook event:', error instanceof Error ? error.message : 'Unknown error')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const event: SquareCatalogWebhookEvent = JSON.parse(body)

    // Resolve tenant from merchant_id
    const tenantId = await resolveTenantFromMerchantId(event.merchant_id)
    if (!tenantId) {
      console.warn(`Unknown merchant_id in catalog webhook: ${event.merchant_id}`)
      return NextResponse.json(
        { success: false, message: 'Unknown merchant' },
        { status: 200 }
      )
    }

    // Load tenant's Square config
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      console.warn(`No Square config for tenant ${tenantId}`)
      return NextResponse.json(
        { success: false, message: 'Tenant not configured' },
        { status: 200 }
      )
    }

    // Verify webhook signature using tenant's key
    const headersList = await headers()
    const signature = headersList.get('x-square-signature') || ''
    if (
      squareConfig.webhookSignatureKey &&
      !verifySquareSignature(body, signature, squareConfig.webhookSignatureKey)
    ) {
      console.error('Invalid webhook signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    console.log('📨 Received Square catalog webhook:', event.event_id)
    console.log('📅 Catalog updated at:', event.data.object.catalog_version.updated_at)

    // Check if this event was already processed
    const supabase = createServiceClient()
    const { data: existingEvent } = await supabase
      .from('webhook_events')
      .select('id')
      .eq('event_id', event.event_id)
      .maybeSingle()

    if (existingEvent) {
      console.log('⏩ Event already processed, skipping')
      return NextResponse.json({ message: 'Event already processed' })
    }

    // Get last sync timestamp
    const lastSync = await getLastCatalogSync()

    // Fetch catalog changes since last sync using tenant's credentials
    const catalogData = await fetchCatalogChanges(squareConfig, lastSync || undefined)

    // Sync changes to inventory
    const syncResult = await syncCatalogChanges(catalogData)

    // Log the webhook event
    await logWebhookEvent(event, syncResult)

    console.log('✅ Catalog webhook processed successfully')
    console.log(`🆕 New items: ${syncResult.newItems}`)
    console.log(`✨ Updated items: ${syncResult.updatedItems}`)

    return NextResponse.json({
      success: true,
      message: 'Catalog webhook processed successfully',
      event_id: event.event_id,
      sync_result: syncResult,
      processed_at: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ Catalog webhook error:', error)

    // Always return 200 to Square to prevent retries for application errors
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processed_at: new Date().toISOString()
      },
      { status: 200 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Square catalog webhook endpoint',
    methods: ['POST'],
    description: 'Receives catalog.version.updated events from Square',
    features: [
      'Real-time catalog synchronization',
      'Automatic inventory item creation',
      'Intelligent supplier mapping',
      'Duplicate event prevention',
      'Audit trail logging'
    ],
    webhook_url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/square/catalog`,
    required_permissions: ['ITEMS_READ'],
    required_env_vars: [
      'SQUARE_ACCESS_TOKEN',
      'SQUARE_WEBHOOK_SIGNATURE_KEY (optional but recommended)'
    ]
  })
}
