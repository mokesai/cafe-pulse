import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'
import type { SquareConfig } from '@/lib/square/types'

interface EnrichmentRecord extends Record<string, unknown> {
  square_item_id: string
  supplier_name?: string
  current_stock?: number
  minimum_threshold?: number
  reorder_point?: number
  unit_cost?: number
  location?: string
  notes?: string
  item_name?: string
  description?: string
}

interface EnrichmentSettings {
  conflict_resolution?: {
    default_strategy?: 'square_wins' | 'yaml_wins' | 'merge'
    field_strategies?: Record<string, 'square_wins' | 'yaml_wins' | 'merge'>
  }
}

interface EnrichmentPayload {
  inventory_enrichments: EnrichmentRecord[]
  enrichment_settings?: EnrichmentSettings
}

type InventoryItemRow = {
  id: string
  square_item_id: string
  item_name: string
  unit_cost: number | null
  current_stock: number | null
  minimum_threshold: number | null
  reorder_point: number | null
  supplier_id: string | null
  location: string | null
  notes: string | null
}

type InventoryUpdatePlan = {
  id: string
  updates: Record<string, unknown>
  changes: string[]
}

type StockMovementPlan = {
  inventory_item_id: string
  movement_type: 'adjustment'
  quantity_change: number
  previous_stock: number
  new_stock: number
  reference_id: string
  notes: string
}

interface HybridSyncRequest {
  dryRun?: boolean
  skipSquareSync?: boolean
  skipEnrichment?: boolean
  enrichmentData?: EnrichmentPayload
}

async function getInventoryStats(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string
) {
  const { data: items, error } = await supabase
    .from('inventory_items')
    .select('id, current_stock, unit_cost, supplier_id')
    .eq('tenant_id', tenantId)

  if (error) {
    console.warn('Warning: Could not fetch inventory stats')
    return { totalItems: 0, totalValue: 0, itemsWithSuppliers: 0, itemsWithStock: 0 }
  }

  return {
    totalItems: items.length,
    totalValue: items.reduce((sum, item) => sum + ((item.current_stock || 0) * (item.unit_cost || 0)), 0),
    itemsWithSuppliers: items.filter(item => item.supplier_id).length,
    itemsWithStock: items.filter(item => item.current_stock > 0).length
  }
}

async function runSquareSync(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  squareConfig: SquareConfig,
  dryRun: boolean
) {
  try {
    const SQUARE_VERSION = '2024-12-18'
    const baseUrl = squareConfig.environment === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com'

    const catalogResponse = await fetch(`${baseUrl}/v2/catalog/search`, {
      method: 'POST',
      headers: {
        'Square-Version': SQUARE_VERSION,
        'Authorization': `Bearer ${squareConfig.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ object_types: ['ITEM', 'CATEGORY'], include_related_objects: true })
    })

    if (!catalogResponse.ok) {
      throw new Error(`Square API error: ${catalogResponse.status}`)
    }

    const catalogData = await catalogResponse.json()

    // Get existing inventory to avoid duplicates (tenant-scoped)
    const { data: existingItems } = await supabase
      .from('inventory_items')
      .select('square_item_id')
      .eq('tenant_id', tenantId)
    const existingIds = new Set((existingItems ?? []).map(i => i.square_item_id))

    // Identify new items from catalog
    const objects = catalogData.objects || []
    const newItems = objects
      .filter((obj: { type: string; id: string }) => obj.type === 'ITEM' && !existingIds.has(obj.id))
      .map((obj: { id: string; item_data?: { name?: string } }) => ({
        square_item_id: obj.id,
        item_name: obj.item_data?.name || 'Unknown Item',
        current_stock: 0,
        minimum_threshold: 5,
        reorder_point: 10,
        unit_cost: 0,
        unit_type: 'each' as const,
        is_ingredient: true,
        location: 'main',
        notes: 'Synced from Square catalog via hybrid sync',
        tenant_id: tenantId,
      }))

    if (!dryRun && newItems.length > 0) {
      const { error } = await supabase.from('inventory_items').insert(newItems)
      if (error) throw new Error(`Failed to insert items: ${error.message}`)
    }

    return { success: true, summary: { newItems: newItems.length, dryRun } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function runEnrichmentSync(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  enrichmentData: EnrichmentPayload,
  dryRun: boolean
) {
  if (!enrichmentData || !enrichmentData.inventory_enrichments) {
    return {
      success: false,
      error: 'No enrichment data provided'
    }
  }

  try {
    // Get supplier mappings (tenant-scoped)
    const { data: suppliers, error: supplierError } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('tenant_id', tenantId)

    if (supplierError) {
      throw new Error(`Failed to fetch suppliers: ${supplierError.message}`)
    }

    const supplierMap: Record<string, string> = {}
    suppliers.forEach(supplier => {
      supplierMap[supplier.name] = supplier.id
    })

    // Get existing inventory items (tenant-scoped)
    const { data: itemsData, error: itemsError } = await supabase
      .from('inventory_items')
      .select('id, square_item_id, item_name, unit_cost, current_stock, minimum_threshold, reorder_point, supplier_id, location, notes')
      .eq('tenant_id', tenantId)

    if (itemsError) {
      throw new Error(`Failed to fetch inventory items: ${itemsError.message}`)
    }

    const itemMap: Record<string, InventoryItemRow> = {}
    const inventoryItems = (itemsData ?? []) as InventoryItemRow[]
    inventoryItems.forEach(item => {
      itemMap[item.square_item_id] = item
    })

    // Process enrichments with conflict resolution
    const updates: InventoryUpdatePlan[] = []
    const stockMovements: StockMovementPlan[] = []
    const stats = {
      processed: 0,
      updated: 0,
      skipped: 0,
      stockChanges: 0
    }

    enrichmentData.inventory_enrichments.forEach((enrichment) => {
      stats.processed++

      const existingItem = itemMap[enrichment.square_item_id]
      if (!existingItem) {
        stats.skipped++
        return
      }

      // Build update object with conflict resolution
      const updates_obj: Record<string, unknown> = {}
      const changes: string[] = []
      const existingRecord = existingItem as Record<string, unknown>

      // Apply enrichment settings for conflict resolution
      const settings = enrichmentData.enrichment_settings || {}
      const defaultStrategy = settings.conflict_resolution?.default_strategy || 'yaml_wins'
      const fieldStrategies = settings.conflict_resolution?.field_strategies || {}

      Object.keys(enrichment).forEach(field => {
        if (field === 'square_item_id') return

        let dbField = field
        let newValue = enrichment[field]

        // Handle special field mappings
        if (field === 'supplier_name') {
          dbField = 'supplier_id'
          const supplierName = typeof enrichment[field] === 'string' ? enrichment[field] : undefined
          newValue = supplierName ? supplierMap[supplierName] : undefined
        } else if (field === 'custom_fields') {
          // Skip custom fields for now
          return
        }

        // Apply conflict resolution strategy
        const strategy = fieldStrategies[field] || defaultStrategy

        if (strategy === 'square_wins' && ['item_name', 'description'].includes(field)) {
          // Don't update these fields, let Square manage them
          return
        }

        // Check if value changed
        if (existingRecord[dbField] !== newValue) {
          updates_obj[dbField] = newValue
          changes.push(`${field}: ${existingRecord[dbField] || 'null'} → ${newValue}`)

          // Track stock changes
          if (field === 'current_stock' && typeof newValue === 'number') {
            const previousStock = existingItem.current_stock || 0
            const stockChange = newValue - previousStock

            if (stockChange !== 0) {
              stockMovements.push({
                inventory_item_id: existingItem.id,
                movement_type: 'adjustment',
                quantity_change: stockChange,
                previous_stock: previousStock,
                new_stock: newValue,
                reference_id: 'HYBRID_ENRICHMENT',
                notes: `Hybrid sync adjustment: ${stockChange > 0 ? '+' : ''}${stockChange}`
              })
              stats.stockChanges++
            }
          }
        }
      })

      if (Object.keys(updates_obj).length > 0) {
        updates.push({
          id: existingItem.id,
          updates: updates_obj,
          changes: changes
        })
        stats.updated++
      }
    })

    // Apply updates if not dry run
    if (!dryRun && updates.length > 0) {
      for (const update of updates) {
        const { error } = await supabase
          .from('inventory_items')
          .update(update.updates)
          .eq('id', update.id)
          .eq('tenant_id', tenantId)

        if (error) {
          console.error(`Error updating item:`, error.message)
        }
      }

      // Create stock movements
      if (stockMovements.length > 0) {
        await supabase
          .from('stock_movements')
          .insert(stockMovements)
      }
    }

    return {
      success: true,
      stats,
      updates: dryRun ? updates : undefined
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)

    const body: HybridSyncRequest = await request.json()
    const dryRun = body.dryRun || false

    // Get initial stats
    const beforeStats = await getInventoryStats(supabase, tenantId)

    let squareResult = null
    let enrichmentResult = null

    // Phase 1: Square Catalog Sync
    if (!body.skipSquareSync && squareConfig) {
      squareResult = await runSquareSync(supabase, tenantId, squareConfig, dryRun)
    }

    // Phase 2: YAML Enrichment
    if (!body.skipEnrichment && body.enrichmentData) {
      enrichmentResult = await runEnrichmentSync(supabase, tenantId, body.enrichmentData, dryRun)
    }

    // Get final stats
    const afterStats = await getInventoryStats(supabase, tenantId)

    const summary = {
      beforeStats,
      afterStats,
      phases: {
        squareSync: {
          ran: !body.skipSquareSync && !!squareConfig,
          result: squareResult
        },
        enrichment: {
          ran: !body.skipEnrichment && !!body.enrichmentData,
          result: enrichmentResult
        }
      },
      totalChanges: {
        itemsAdded: afterStats.totalItems - beforeStats.totalItems,
        valueChange: afterStats.totalValue - beforeStats.totalValue,
        supplierMappingChange: afterStats.itemsWithSuppliers - beforeStats.itemsWithSuppliers
      },
      dryRun
    }

    return NextResponse.json({
      success: true,
      message: `Hybrid inventory sync ${dryRun ? 'preview' : 'completed'} successfully`,
      summary
    })

  } catch (error) {
    console.error('Hybrid sync error:', error)

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
    message: 'Hybrid inventory sync API endpoint',
    methods: ['POST'],
    requiredFields: [],
    optionalFields: ['dryRun', 'skipSquareSync', 'skipEnrichment', 'enrichmentData'],
    description: 'Combines Square catalog sync with YAML enrichment for complete inventory management',
    workflow: [
      'Phase 1: Sync Square catalog items (discover structure)',
      'Phase 2: Apply YAML enrichments (business data overlay)',
      'Phase 3: Generate comprehensive sync report'
    ],
    features: [
      'Two-phase hybrid approach',
      'Conflict resolution strategies',
      'Selective sync options',
      'Comprehensive reporting',
      'Admin access validation'
    ]
  })
}
