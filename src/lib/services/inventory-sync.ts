/**
 * Inventory Synchronization Service
 * Centralized service for managing real-time inventory sync between Square and local database
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY

function getSupabaseClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration for inventory sync service')
  }
  return createClient(supabaseUrl, supabaseServiceKey)
}

const supabase = {
  get from() { return getSupabaseClient().from.bind(getSupabaseClient()) },
  get rpc() { return getSupabaseClient().rpc.bind(getSupabaseClient()) },
}

type WebhookEventRecord = {
  event_type: string
  processed_at: string
  sync_result?: {
    errors?: number
    success?: boolean
    [key: string]: unknown
  }
}

interface InventoryItemRow {
  id: string
  item_name: string
  current_stock: number
  minimum_threshold: number
  reorder_point: number
}

interface SquareInventoryCount {
  catalog_object_id: string
  quantity: string | number
  state: string
}

interface SquareInventoryEvent {
  object?: {
    inventory_counts?: SquareInventoryCount[]
  }
}

export interface InventoryUpdateEvent {
  id: string
  type: 'stock_change' | 'item_created' | 'item_updated' | 'item_deleted'
  source: 'square' | 'local' | 'manual'
  timestamp: string
  data: {
    square_item_id: string
    item_name?: string
    previous_stock?: number
    new_stock?: number
    location_id?: string
    details?: Record<string, unknown>
  }
}

export interface SyncConflict {
  square_item_id: string
  field: string
  square_value: unknown
  local_value: unknown
  resolution: 'square_wins' | 'local_wins' | 'manual_review'
}

export class InventorySyncService {
  
  /**
   * Process incoming Square webhook events
   */
  static async processSquareWebhook(eventType: string, eventData: unknown): Promise<{
    success: boolean
    updates: number
    conflicts: SyncConflict[]
    alerts: number
  }> {
    const result = {
      success: false,
      updates: 0,
      conflicts: [] as SyncConflict[],
      alerts: 0
    }

    try {
      if (eventType === 'catalog.version.updated') {
        const catalogResult = await this.handleCatalogUpdate()
        result.updates = catalogResult.updates
        result.conflicts = catalogResult.conflicts
      } else if (eventType === 'inventory.count.updated') {
        const inventoryResult = await this.handleInventoryUpdate(eventData as SquareInventoryEvent)
        result.updates = inventoryResult.updates
        result.alerts = inventoryResult.alerts
      }

      result.success = true
      return result
    } catch (error) {
      console.error('Inventory sync service error:', error)
      result.success = false
      return result
    }
  }

  /**
   * Handle catalog updates from Square
   */
  private static async handleCatalogUpdate(): Promise<{
    updates: number
    conflicts: SyncConflict[]
  }> {
    // Implementation would fetch changed catalog items and update local inventory
    // This is a framework for the real-time sync logic
    return { updates: 0, conflicts: [] }
  }

  /**
   * Handle inventory count updates from Square
   */
  private static async handleInventoryUpdate(eventData: SquareInventoryEvent): Promise<{
    updates: number
    alerts: number
  }> {
    const inventoryCounts = eventData.object?.inventory_counts || []
    let updates = 0
    let alerts = 0

    for (const count of inventoryCounts) {
      try {
        const updateResult = await this.updateLocalInventoryFromSquare(count)
        if (updateResult.updated) {
          updates++
        }
        if (updateResult.alertCreated) {
          alerts++
        }
      } catch (error) {
        console.error(`Error processing inventory count for ${count.catalog_object_id}:`, error)
      }
    }

    return { updates, alerts }
  }

  /**
   * Update local inventory from Square inventory count
   */
  private static async updateLocalInventoryFromSquare(inventoryCount: SquareInventoryCount): Promise<{
    updated: boolean
    alertCreated: boolean
    error?: string
  }> {
    const { catalog_object_id, quantity, state } = inventoryCount
    const newQuantity = Number(quantity ?? 0)

    // Find local inventory item
    const { data: item, error } = await supabase
      .from('inventory_items')
      .select('id, item_name, current_stock, minimum_threshold, reorder_point')
      .eq('square_item_id', catalog_object_id)
      .maybeSingle()

    if (error || !item) {
      return { updated: false, alertCreated: false, error: 'Item not found in local inventory' }
    }

    const previousStock = item.current_stock || 0
    const quantityChange = newQuantity - previousStock

    if (quantityChange === 0) {
      return { updated: false, alertCreated: false }
    }

    try {
      // Update inventory item
      const { error: updateError } = await supabase
        .from('inventory_items')
        .update({
          current_stock: newQuantity,
          last_restocked_at: quantityChange > 0 ? new Date().toISOString() : undefined
        })
        .eq('id', item.id)

      if (updateError) {
        throw updateError
      }

      // Create stock movement
      const movementType = state === 'SOLD' || state === 'SOLD_ONLINE' ? 'sale' : 
                          state === 'RECEIVED_FROM_VENDOR' ? 'purchase' : 'adjustment'

      await supabase
        .from('stock_movements')
        .insert([{
          inventory_item_id: item.id,
          movement_type: movementType,
          quantity_change: quantityChange,
          previous_stock: previousStock,
          new_stock: newQuantity,
          reference_id: 'SQUARE_WEBHOOK',
          notes: `Real-time update from Square: ${state}`
        }])

      // Check for low stock alerts
      const alertCreated = await this.checkAndCreateLowStockAlert(item, newQuantity)

      return { updated: true, alertCreated }
    } catch (error) {
      return { updated: false, alertCreated: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Push local inventory changes to Square
   */
  static async pushToSquare(itemIds?: string[]): Promise<{
    success: boolean
    updated: number
    errors: string[]
  }> {
    try {
      const response = await fetch('/api/admin/inventory/push-to-square', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminEmail: process.env.ADMIN_EMAIL,
          itemIds,
          pushType: 'stock_only'
        })
      })

      if (!response.ok) {
        throw new Error(`Push API error: ${response.status}`)
      }

      const result = await response.json()
      return {
        success: result.success,
        updated: result.summary?.results?.updated || 0,
        errors: result.summary?.results?.errorDetails || []
      }
    } catch (error) {
      return {
        success: false,
        updated: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  /**
   * Check and create low stock alerts
   */
  private static async checkAndCreateLowStockAlert(item: InventoryItemRow, newQuantity: number): Promise<boolean> {
    const { minimum_threshold, reorder_point } = item
    
    let alertLevel = null
    if (newQuantity === 0) {
      alertLevel = 'out_of_stock'
    } else if (newQuantity <= minimum_threshold) {
      alertLevel = 'critical'
    } else if (newQuantity <= reorder_point) {
      alertLevel = 'low'
    }

    if (!alertLevel) {
      return false
    }

    try {
      // Check if alert already exists
      const { data: existingAlert } = await supabase
        .from('low_stock_alerts')
        .select('id')
        .eq('inventory_item_id', item.id)
        .eq('is_acknowledged', false)
        .maybeSingle()

      if (existingAlert) {
        return false // Alert already exists
      }

      // Create new alert
      const { error } = await supabase
        .from('low_stock_alerts')
        .insert([{
          inventory_item_id: item.id,
          alert_level: alertLevel,
          stock_level: newQuantity,
          threshold_level: alertLevel === 'out_of_stock' ? 0 : 
                         alertLevel === 'critical' ? minimum_threshold : reorder_point
        }])

      return !error
    } catch (error) {
      console.error('Error creating low stock alert:', error)
      return false
    }
  }

  /**
   * Get sync status and health metrics
   */
  static async getSyncStatus(): Promise<{
    lastCatalogSync: Date | null
    lastInventorySync: Date | null
    pendingAlerts: number
    recentErrors: WebhookEventRecord[]
    webhookHealth: {
      catalogWebhook: boolean
      inventoryWebhook: boolean
    }
  }> {
    try {
      // Get last webhook events
      const { data: lastEvents } = await supabase
        .from('webhook_events')
        .select('event_type, processed_at, sync_result')
        .order('processed_at', { ascending: false })
        .limit(10)

      const lastCatalogSync = lastEvents
        ?.find(e => e.event_type === 'catalog.version.updated')?.processed_at

      const lastInventorySync = lastEvents
        ?.find(e => e.event_type === 'inventory.count.updated')?.processed_at

      // Get pending alerts count
      const { count: pendingAlerts } = await supabase
        .from('low_stock_alerts')
        .select('id', { count: 'exact' })
        .eq('is_acknowledged', false)

      // Get recent errors from webhook events
      const recentErrors = (lastEvents as WebhookEventRecord[] | undefined)
        ?.filter(e => (Array.isArray(e.sync_result?.errors) ? e.sync_result?.errors.length > 0 : !e.sync_result?.success))
        .slice(0, 5) || []

      return {
        lastCatalogSync: lastCatalogSync ? new Date(lastCatalogSync) : null,
        lastInventorySync: lastInventorySync ? new Date(lastInventorySync) : null,
        pendingAlerts: pendingAlerts || 0,
        recentErrors,
        webhookHealth: {
          catalogWebhook: true, // Would check webhook endpoint health
          inventoryWebhook: true
        }
      }
    } catch (error) {
      console.error('Error getting sync status:', error)
      return {
        lastCatalogSync: null,
        lastInventorySync: null,
        pendingAlerts: 0,
        recentErrors: [],
        webhookHealth: {
          catalogWebhook: false,
          inventoryWebhook: false
        }
      }
    }
  }

  /**
   * Force a manual sync (for testing or recovery)
   */
  static async forceManualSync(syncType: 'catalog' | 'inventory' | 'both' = 'both'): Promise<{
    success: boolean
    results: Record<string, unknown>
  }> {
    try {
      const results: Record<string, unknown> = {}

      if (syncType === 'catalog' || syncType === 'both') {
        // Trigger catalog sync
        const catalogResponse = await fetch('/api/admin/inventory/sync-square', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adminEmail: process.env.ADMIN_EMAIL,
            dryRun: false
          })
        })
        
        results.catalog = catalogResponse.ok ? await catalogResponse.json() : { success: false }
      }

      if (syncType === 'inventory' || syncType === 'both') {
        // For inventory, we'd need to trigger a full inventory reconciliation
        // This could involve comparing all Square inventory counts with local counts
        results.inventory = { success: true, message: 'Manual inventory sync not yet implemented' }
      }

      return { success: true, results }
    } catch (error) {
      return { 
        success: false, 
        results: { error: error instanceof Error ? error.message : 'Unknown error' }
      }
    }
  }
}
