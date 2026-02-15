import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantSquareConfig, resolveTenantFromMerchantId } from '@/lib/square/config'

interface InventoryCount {
  catalog_object_id: string
  location_id: string
  quantity: string
  state: 'IN_STOCK' | 'SOLD' | 'RETURNED_BY_CUSTOMER' | 'RESERVED_FOR_SALE' | 'SOLD_ONLINE' | 'ORDERED_FROM_VENDOR' | 'RECEIVED_FROM_VENDOR'
}

interface SquareInventoryWebhookEvent {
  type: 'inventory.count.updated'
  event_id: string
  created_at: string
  merchant_id: string
  data: {
    type: 'inventory_counts'
    object: {
      inventory_counts: InventoryCount[]
    }
  }
}

interface InventoryItemRecord {
  id: string
  item_name: string
  current_stock: number | null
  minimum_threshold: number
  reorder_point: number
  square_item_id?: string | null
}

interface InventoryUpdateResult {
  processed: number
  updated: number
  notFound: number
  alertsCreated: number
  totalQuantityChange: number
}

// Verify Square webhook signature
function verifySquareSignature(body: string, signature: string, secret: string): boolean {
  if (!secret || !signature) {
    console.warn('⚠️  Webhook signature verification skipped (no secret configured)')
    return true // Allow in development
  }

  try {
    const url = `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/square/inventory`
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

async function getInventoryItemBySquareId(catalogObjectId: string) {
  // Try to find by exact square_item_id first
  const supabase = createServiceClient()
  const { data: item, error } = await supabase
    .from('inventory_items')
    .select('id, square_item_id, item_name, current_stock, minimum_threshold, reorder_point')
    .eq('square_item_id', catalogObjectId)
    .maybeSingle<InventoryItemRecord>()

  if (error) {
    console.warn(`Warning: Error looking up item ${catalogObjectId}:`, error.message)
    return null
  }

  return item
}

async function updateInventoryStock(inventoryItem: InventoryItemRecord, newQuantity: number, movementType: string, reference: string) {
  const previousStock = inventoryItem.current_stock || 0
  const quantityChange = newQuantity - previousStock

  if (quantityChange === 0) {
    return { updated: false, reason: 'No quantity change' }
  }

  try {
    // Update inventory item
    const supabase = createServiceClient()
    const { error: updateError } = await supabase
      .from('inventory_items')
      .update({
        current_stock: newQuantity,
        last_restocked_at: quantityChange > 0 ? new Date().toISOString() : undefined
      })
      .eq('id', inventoryItem.id)

    if (updateError) {
      throw new Error(`Failed to update inventory: ${updateError.message}`)
    }

    // Create stock movement record
    const { error: movementError } = await supabase
      .from('stock_movements')
      .insert([{
        inventory_item_id: inventoryItem.id,
        movement_type: movementType,
        quantity_change: quantityChange,
        previous_stock: previousStock,
        new_stock: newQuantity,
        reference_id: reference,
        notes: `Square webhook update: ${quantityChange > 0 ? '+' : ''}${quantityChange} units`
      }])

    if (movementError) {
      console.warn('Warning: Could not create stock movement:', movementError.message)
    }

    return {
      updated: true,
      quantityChange,
      previousStock,
      newStock: newQuantity
    }
  } catch (error) {
    console.error(`Error updating inventory for ${inventoryItem.item_name}:`, error)
    return { updated: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function checkLowStockAlert(inventoryItem: InventoryItemRecord, newQuantity: number) {
  const { minimum_threshold, reorder_point } = inventoryItem

  let alertLevel = null
  if (newQuantity === 0) {
    alertLevel = 'out_of_stock'
  } else if (newQuantity <= minimum_threshold) {
    alertLevel = 'critical'
  } else if (newQuantity <= reorder_point) {
    alertLevel = 'low'
  }

  if (alertLevel) {
    try {
      // Check if alert already exists for this item
      const supabase = createServiceClient()
      const { data: existingAlert } = await supabase
        .from('low_stock_alerts')
        .select('id')
        .eq('inventory_item_id', inventoryItem.id)
        .eq('is_acknowledged', false)
        .maybeSingle()

      if (!existingAlert) {
        // Create new alert
        await supabase
          .from('low_stock_alerts')
          .insert([{
            inventory_item_id: inventoryItem.id,
            alert_level: alertLevel,
            stock_level: newQuantity,
            threshold_level: alertLevel === 'out_of_stock' ? 0 :
                           alertLevel === 'critical' ? minimum_threshold : reorder_point
          }])

        console.log(`🚨 Created ${alertLevel} stock alert for ${inventoryItem.item_name}`)
        return { alertCreated: true, alertLevel }
      }
    } catch (error) {
      console.warn('Warning: Could not create stock alert:', error instanceof Error ? error.message : 'Unknown error')
    }
  }

  return { alertCreated: false }
}

async function processInventoryUpdates(locationId: string, inventoryCounts: InventoryCount[], eventId: string): Promise<InventoryUpdateResult> {
  const results: InventoryUpdateResult = {
    processed: 0,
    updated: 0,
    notFound: 0,
    alertsCreated: 0,
    totalQuantityChange: 0
  }

  console.log(`📊 Processing ${inventoryCounts.length} inventory updates...`)

  for (const count of inventoryCounts) {
    // Only process updates for our configured location
    if (count.location_id !== locationId) {
      console.log(`⏩ Skipping update for different location: ${count.location_id}`)
      continue
    }

    results.processed++
    const newQuantity = parseInt(count.quantity, 10)

    // Find corresponding inventory item
    const inventoryItem = await getInventoryItemBySquareId(count.catalog_object_id)
    
    if (!inventoryItem) {
      console.log(`⚠️  Item not found in inventory: ${count.catalog_object_id}`)
      results.notFound++
      continue
    }

    // Determine movement type based on quantity change and state
    let movementType = 'adjustment'
    if (count.state === 'SOLD' || count.state === 'SOLD_ONLINE') {
      movementType = 'sale'
    } else if (count.state === 'RECEIVED_FROM_VENDOR') {
      movementType = 'purchase'
    }

    // Update inventory stock
    const updateResult = await updateInventoryStock(
      inventoryItem,
      newQuantity,
      movementType,
      `SQUARE_WEBHOOK_${eventId}`
    )

    if (updateResult.updated) {
      results.updated++
      results.totalQuantityChange += Math.abs(updateResult.quantityChange || 0)

      console.log(`✨ Updated ${inventoryItem.item_name}: ${updateResult.previousStock} → ${updateResult.newStock}`)

      // Check for low stock alerts
      const alertResult = await checkLowStockAlert(inventoryItem, newQuantity)
      if (alertResult.alertCreated) {
        results.alertsCreated++
      }
    }
  }

  return results
}

async function logWebhookEvent(event: SquareInventoryWebhookEvent, processResult: InventoryUpdateResult) {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('webhook_events')
      .insert([{
        event_id: event.event_id,
        event_type: event.type,
        merchant_id: event.merchant_id,
        event_data: event,
        sync_result: processResult,
        processed_at: new Date().toISOString()
      }])

    if (error) {
      console.warn('Warning: Could not log webhook event:', error instanceof Error ? error.message : 'Unknown error')
    }
  } catch (error) {
    console.warn('Warning: Could not log webhook event:', error instanceof Error ? error.message : 'Unknown error')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const event: SquareInventoryWebhookEvent = JSON.parse(body)

    // Resolve tenant from merchant_id
    const tenantId = await resolveTenantFromMerchantId(event.merchant_id)
    if (!tenantId) {
      console.warn(`Unknown merchant_id in inventory webhook: ${event.merchant_id}`)
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

    console.log('📨 Received Square inventory webhook:', event.event_id)
    console.log('📦 Inventory counts:', event.data.object.inventory_counts.length)

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

    // Process inventory updates using tenant's location_id
    const processResult = await processInventoryUpdates(
      squareConfig.locationId,
      event.data.object.inventory_counts,
      event.event_id
    )

    // Log the webhook event
    await logWebhookEvent(event, processResult)

    console.log('✅ Inventory webhook processed successfully')
    console.log(`📊 Results: ${processResult.updated} updated, ${processResult.alertsCreated} alerts created`)

    return NextResponse.json({
      success: true,
      message: 'Inventory webhook processed successfully',
      event_id: event.event_id,
      results: processResult,
      processed_at: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ Inventory webhook error:', error)

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
    message: 'Square inventory webhook endpoint',
    methods: ['POST'],
    description: 'Receives inventory.count.updated events from Square',
    features: [
      'Real-time inventory stock updates',
      'Automatic low stock alerts',
      'Stock movement tracking',
      'Location-based filtering',
      'Duplicate event prevention'
    ],
    webhook_url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/square/inventory`,
    required_permissions: ['INVENTORY_READ'],
    required_env_vars: [
      'SQUARE_ACCESS_TOKEN',
      'SQUARE_LOCATION_ID',
      'SQUARE_WEBHOOK_SIGNATURE_KEY (optional but recommended)'
    ]
  })
}
