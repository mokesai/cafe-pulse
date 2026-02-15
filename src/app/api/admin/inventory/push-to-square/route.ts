import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'
import type { SquareConfig } from '@/lib/square/types'

const SQUARE_VERSION = '2024-12-18'

interface PushToSquareRequest {
  adminEmail: string
  itemIds?: string[] // Specific items to push, if not provided push all
  dryRun?: boolean
  pushType?: 'stock_only' | 'full_sync' // stock_only = inventory counts, full_sync = item details too
}

type InventoryItemToPush = {
  id: string
  square_item_id: string
  item_name: string
  current_stock: number | null
  unit_cost: number | null
  notes: string | null
}

type SquareInventoryCount = {
  catalog_object_id: string
  location_id: string
  quantity: string
}

async function validateAdminAccess(supabase: ReturnType<typeof createServiceClient>, adminEmail: string) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('email', adminEmail)
    .single()

  if (error || !profile || profile.role !== 'admin') {
    throw new Error('Admin access required')
  }

  return profile
}

function getSquareHeaders(config: SquareConfig) {
  return {
    'Square-Version': SQUARE_VERSION,
    'Authorization': `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json'
  }
}

async function getInventoryItemsToPush(supabase: ReturnType<typeof createServiceClient>, itemIds?: string[]): Promise<InventoryItemToPush[]> {
  let query = supabase
    .from('inventory_items')
    .select('id, square_item_id, item_name, current_stock, unit_cost, notes')
    .not('square_item_id', 'is', null) // Only items with Square IDs

  if (itemIds && itemIds.length > 0) {
    query = query.in('id', itemIds)
  }

  const { data: items, error } = await query

  if (error) {
    throw new Error(`Failed to fetch inventory items: ${error.message}`)
  }

  return (items ?? []) as InventoryItemToPush[]
}

async function pushInventoryCountsToSquare(config: SquareConfig, supabase: ReturnType<typeof createServiceClient>, items: InventoryItemToPush[], dryRun: boolean) {
  const baseUrl = config.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
  const results = {
    processed: 0,
    updated: 0,
    errors: 0,
    errorDetails: [] as string[]
  }

  console.log(`📤 Pushing inventory counts for ${items.length} items...`)

  // Square Inventory API allows batch updates
  const inventoryChanges: Array<{
    type: 'PHYSICAL_COUNT'
    physical_count: {
      catalog_object_id: string | null
      location_id: string
      quantity: string
      occurred_at: string
    }
  }> = []

  for (const item of items) {
    results.processed++

    // Check if we need to update the inventory count in Square
    try {
      // First get current Square inventory count
      const response = await fetch(`${baseUrl}/v2/inventory/counts/batch-retrieve`, {
        method: 'POST',
        headers: getSquareHeaders(config),
        body: JSON.stringify({
          catalog_object_ids: [item.square_item_id],
          location_ids: [config.locationId]
        })
      })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error(`Square API error ${response.status} while fetching counts:`, errorBody)
        results.errors++
        results.errorDetails.push(`${item.item_name}: Square API error ${response.status}`)
        continue
      }

      const squareData = await response.json()
      const squareCounts = (squareData.counts || []) as SquareInventoryCount[]
      const currentSquareCount = squareCounts.find(
        (count) => count.catalog_object_id === item.square_item_id && count.location_id === config.locationId
      )

      const squareQuantity = currentSquareCount ? parseInt(currentSquareCount.quantity, 10) : 0
      const localQuantity = item.current_stock || 0

      if (squareQuantity !== localQuantity) {
        inventoryChanges.push({
          type: 'PHYSICAL_COUNT',
          physical_count: {
            catalog_object_id: item.square_item_id,
            location_id: config.locationId,
            quantity: localQuantity.toString(),
            occurred_at: new Date().toISOString()
          }
        })

        console.log(`📊 Queued update for ${item.item_name}: Square=${squareQuantity} → Local=${localQuantity}`)
      }
    } catch (error) {
      results.errors++
      results.errorDetails.push(`${item.item_name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      console.error(`Error processing ${item.item_name}:`, error)
    }
  }

  // Push inventory changes to Square in batch
  if (inventoryChanges.length > 0 && !dryRun) {
    try {
      const response = await fetch(`${baseUrl}/v2/inventory/changes/batch-create`, {
        method: 'POST',
        headers: getSquareHeaders(config),
        body: JSON.stringify({
          idempotency_key: `inventory-push-${Date.now()}`,
          changes: inventoryChanges
        })
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Square Inventory API error: ${response.status} ${errorBody}`)
      }

      await response.json()
      results.updated = inventoryChanges.length

      console.log(`✅ Successfully pushed ${results.updated} inventory changes to Square`)

      // Log the push operation
      await supabase
        .from('stock_movements')
        .insert(
          inventoryChanges.map(change => ({
            inventory_item_id: items.find(item => item.square_item_id === change.physical_count.catalog_object_id)?.id,
            movement_type: 'adjustment',
            quantity_change: 0, // Net change is 0 since we're syncing
            previous_stock: 0, // We don't track the previous Square stock here
            new_stock: parseInt(change.physical_count.quantity, 10),
            reference_id: 'PUSH_TO_SQUARE',
            notes: 'Inventory count pushed to Square via API'
          }))
        )

    } catch (error) {
      results.errors += inventoryChanges.length
      results.errorDetails.push(`Batch push failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      console.error('Error pushing inventory changes:', error)
    }
  }

  return results
}

async function syncItemDetailsToSquare(items: InventoryItemToPush[]) {
  // This would update item names, descriptions, etc. in Square
  // For now, we typically let Square be the source of truth for item details
  // This could be implemented if there's a need to push local changes back to Square
  
  return {
    processed: items.length,
    updated: 0,
    message: 'Item details sync not implemented - Square is source of truth for item metadata'
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: PushToSquareRequest = await request.json()

    if (!body.adminEmail) {
      return NextResponse.json(
        { error: 'Admin email is required' },
        { status: 400 }
      )
    }

    const dryRun = body.dryRun || false
    const pushType = body.pushType || 'stock_only'

    // Resolve tenant and load Square config
    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json({ error: 'Square not configured' }, { status: 503 })
    }

    // Create per-request Supabase client
    const supabase = createServiceClient()

    // Validate admin access
    await validateAdminAccess(supabase, body.adminEmail)

    // Get inventory items to push
    const items = await getInventoryItemsToPush(supabase, body.itemIds)

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No items found to push to Square',
        results: { processed: 0, updated: 0 }
      })
    }

    let results

    if (pushType === 'stock_only') {
      // Push inventory counts only
      results = await pushInventoryCountsToSquare(squareConfig, supabase, items, dryRun)
    } else {
      // Full sync (item details + inventory)
      const stockResults = await pushInventoryCountsToSquare(squareConfig, supabase, items, dryRun)
      const detailResults = await syncItemDetailsToSquare(items)

      results = {
        stock: stockResults,
        details: detailResults,
        processed: stockResults.processed,
        updated: stockResults.updated + detailResults.updated,
        errors: stockResults.errors
      }
    }

    const summary = {
      pushType,
      itemCount: items.length,
      results,
      dryRun
    }

    return NextResponse.json({
      success: true,
      message: `Inventory push to Square ${dryRun ? 'preview' : 'completed'} successfully`,
      summary
    })

  } catch (error) {
    console.error('Push to Square error:', error)
    
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
    message: 'Push inventory data to Square API endpoint',
    methods: ['POST'],
    requiredFields: ['adminEmail'],
    optionalFields: ['itemIds', 'dryRun', 'pushType'],
    description: 'Pushes local inventory data back to Square for bidirectional sync',
    pushTypes: {
      'stock_only': 'Push inventory counts only (recommended)',
      'full_sync': 'Push both item details and inventory counts'
    },
    features: [
      'Batch inventory count updates',
      'Selective item pushing',
      'Dry run mode for previewing changes',
      'Error handling and reporting',
      'Stock movement logging'
    ],
    webhook_integration: 'Complements webhook-based real-time sync from Square'
  })
}
