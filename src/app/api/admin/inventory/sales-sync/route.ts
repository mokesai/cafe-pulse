import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'
import type { SquareConfig } from '@/lib/square/types'

type ImpactType = 'auto' | 'manual' | 'ignored'

interface SalesSyncRequestBody {
  dryRun?: boolean
}

interface InventoryRow {
  id: string
  square_item_id: string
  item_name: string
  current_stock: number
  pack_size?: number | null
  item_type: 'ingredient' | 'prepackaged' | 'prepared' | 'supply'
  auto_decrement: boolean
}

interface SyncMetrics {
  ordersProcessed: number
  autoDecrements: number
  manualPending: number
  ignoredLines: number
  itemSummaries: Array<{
    name: string
    quantity: number
    impact: ImpactType
  }>
  lastOrderedAt?: string
  nextCursor?: string | null
}

const SQUARE_VERSION = '2024-12-18'

async function getLastSuccessfulRun(supabase: SupabaseClient, tenantId: string) {
  const { data } = await supabase
    .from('inventory_sales_sync_runs')
    .select('id, square_cursor, last_synced_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(1)

  return data?.[0] ?? null
}

async function createSyncRun(
  supabase: SupabaseClient,
  tenantId: string,
  adminId: string | null
) {
  const { data, error } = await supabase
    .from('inventory_sales_sync_runs')
    .insert([{
      tenant_id: tenantId,
      status: 'pending',
      created_by: adminId
    }])
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create sync run: ${error?.message ?? 'Unknown error'}`)
  }

  return data
}

type SyncRunUpdate = {
  status?: 'success' | 'error' | 'pending'
  square_cursor?: string | null
  last_synced_at?: string | null
  orders_processed?: number
  auto_decrements?: number
  manual_pending?: number
  finished_at?: string
  error_message?: string
}

async function updateSyncRun(
  supabase: SupabaseClient,
  tenantId: string,
  runId: string,
  updates: SyncRunUpdate
) {
  const { error } = await supabase
    .from('inventory_sales_sync_runs')
    .update({
      ...updates,
      finished_at: updates.finished_at ?? new Date().toISOString()
    })
    .eq('tenant_id', tenantId)
    .eq('id', runId)

  if (error) {
    throw new Error(`Failed to update sync run: ${error.message}`)
  }
}

async function fetchInventoryMap(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, square_item_id, item_name, current_stock, pack_size, item_type, auto_decrement')
    .eq('tenant_id', tenantId)

  if (error) {
    throw new Error(`Failed to load inventory items: ${error.message}`)
  }

  const map = new Map<string, InventoryRow>()
  for (const item of data || []) {
    if (item.square_item_id) {
      const candidate = item as InventoryRow
      const existing = map.get(item.square_item_id)
      if (!existing) {
        map.set(item.square_item_id, candidate)
        continue
      }
      const existingPackSize = Number(existing.pack_size) || 1
      const candidatePackSize = Number(candidate.pack_size) || 1
      if (candidatePackSize === 1 && existingPackSize !== 1) {
        map.set(item.square_item_id, candidate)
      }
    }
  }
  return map
}

function mapImpactType(item?: InventoryRow | null): { impactType: ImpactType; reason?: string } {
  if (!item) {
    return { impactType: 'ignored', reason: 'No matching inventory item' }
  }

  if (item.item_type === 'prepared' || (!item.auto_decrement && item.item_type === 'ingredient')) {
    return { impactType: 'manual', reason: 'Prepared item requires manual ingredient deduction' }
  }

  if (item.auto_decrement || item.item_type === 'prepackaged' || item.item_type === 'supply') {
    return { impactType: 'auto' }
  }

  return { impactType: 'ignored', reason: 'Item not eligible for automatic decrement' }
}

type SquareOrderMoney = {
  amount?: number
  currency?: string
}

type SquareOrderTender = {
  amount_money?: SquareOrderMoney
  type?: string
}

type SquareOrderLineItem = {
  catalog_object_id?: string | null
  variation_id?: string | null
  uid?: string | null
  name?: string
  quantity?: string
  modifiers?: Array<{
    uid?: string | null
    catalog_object_id?: string | null
    name?: string
    quantity?: string
    base_price_money?: SquareOrderMoney
    total_price_money?: SquareOrderMoney
  }>
  unit_price?: {
    measurement_unit?: {
      type?: string
    }
  }
  base_price_money?: SquareOrderMoney
  gross_sales_money?: SquareOrderMoney
  total_tax_money?: SquareOrderMoney
}

type SquareOrder = {
  id: string
  location_id?: string
  order_number?: string
  tenders?: SquareOrderTender[]
  customer_id?: string | null
  customer_details?: { nickname?: string } | null
  created_at?: string
  line_items?: SquareOrderLineItem[]
}

type SquareOrdersResponse = {
  orders: SquareOrder[]
  cursor?: string | null
}

async function fetchSquareOrders(
  config: SquareConfig,
  since?: string | null
): Promise<SquareOrdersResponse> {
  const baseUrl = config.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'

  const orders: SquareOrder[] = []
  let cursor: string | undefined
  let nextCursor: string | null | undefined

  do {
    const body: {
      location_ids: string[]
      query: Record<string, unknown>
      cursor?: string
    } = {
      location_ids: [config.locationId],
      query: {
        sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' }
      }
    }

    if (!cursor && since) {
      body.query.filter = {
        date_time_filter: {
          created_at: {
            start_at: since
          }
        }
      }
    }

    if (cursor) {
      body.cursor = cursor
    }

    const response = await fetch(`${baseUrl}/v2/orders/search`, {
      method: 'POST',
      headers: {
        'Square-Version': SQUARE_VERSION,
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Square orders search failed: ${response.status} ${errorText}`)
    }

    const payload = await response.json()
    if (Array.isArray(payload.orders)) {
      orders.push(...(payload.orders as SquareOrder[]))
    }

    cursor = payload.cursor
    nextCursor = payload.cursor ?? nextCursor
  } while (cursor)

  return { orders, cursor: nextCursor ?? null }
}

async function insertSalesTransaction(
  supabase: SupabaseClient,
  tenantId: string,
  order: SquareOrder,
  syncRunId: string,
  dryRun: boolean
) {
  if (!order?.id) return null

  const squareOrderId = order.id

  const existing = await supabase
    .from('sales_transactions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('square_order_id', squareOrderId)
    .maybeSingle()

  if (existing.error) {
    throw new Error(`Failed checking existing transaction: ${existing.error.message}`)
  }

  if (existing.data) {
    return { id: existing.data.id, wasInserted: false }
  }

  const lineTender = order.tenders?.[0]
  const customerName = order.customer_id || order.customer_details?.nickname || null

  if (dryRun) {
    return { id: squareOrderId, wasInserted: true, dryRunId: squareOrderId }
  }

  const { data, error } = await supabase
    .from('sales_transactions')
    .insert([{
      tenant_id: tenantId,
      square_order_id: squareOrderId,
      location_id: order.location_id,
      order_number: order.order_number,
      tender_total_money: lineTender?.amount_money?.amount
        ? Number(lineTender.amount_money.amount) / 100
        : null,
      tender_currency: lineTender?.amount_money?.currency,
      tender_type: lineTender?.type,
      customer_name: customerName,
      ordered_at: order.created_at,
      sync_run_id: syncRunId,
      raw_payload: order
    }])
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to insert sales transaction: ${error?.message ?? 'Unknown error'}`)
  }

  return { id: data.id, wasInserted: true }
}

function parseQuantity(quantity: string | number | undefined): number {
  if (!quantity) return 0
  const parsed = typeof quantity === 'string' ? parseFloat(quantity) : Number(quantity)
  if (Number.isNaN(parsed)) return 0
  return parsed
}

async function insertTransactionItems(
  supabase: SupabaseClient,
  tenantId: string,
  transactionId: string,
  items: Array<{
    inventory_item_id?: string | null
    square_catalog_object_id: string
    name: string
    quantity: number
    impact_type: ImpactType
    impact_reason?: string
    unit?: string
    metadata?: Record<string, unknown>
  }>,
  dryRun: boolean
) {
  if (items.length === 0 || dryRun) {
    return
  }

  const payload = items.map(item => ({
    tenant_id: tenantId,
    transaction_id: transactionId,
    inventory_item_id: item.inventory_item_id ?? null,
    square_catalog_object_id: item.square_catalog_object_id,
    name: item.name,
    quantity: item.quantity,
    impact_type: item.impact_type,
    impact_reason: item.impact_reason,
    unit: item.unit,
    metadata: item.metadata ?? null
  }))

  const { error } = await supabase
    .from('sales_transaction_items')
    .insert(payload)

  if (error) {
    throw new Error(`Failed to insert transaction items: ${error.message}`)
  }
}

async function applyAutoDecrements(
  supabase: SupabaseClient,
  tenantId: string,
  autoItems: Array<{
    inventory: InventoryRow
    quantity: number
    orderId: string
    lineName: string
  }>,
  dryRun: boolean
) {
  if (autoItems.length === 0 || dryRun) return

  const stockMovements = []

  for (const autoItem of autoItems) {
    const quantityDelta = Math.round(autoItem.quantity)
    if (quantityDelta <= 0) continue

    const previousStock = autoItem.inventory.current_stock ?? 0
    const newStock = Math.max(0, previousStock - quantityDelta)

    const { error } = await supabase
      .from('inventory_items')
      .update({
        current_stock: newStock,
        updated_at: new Date().toISOString()
      })
      .eq('tenant_id', tenantId)
      .eq('id', autoItem.inventory.id)

    if (error) {
      throw new Error(`Failed to decrement inventory for ${autoItem.inventory.item_name}: ${error.message}`)
    }

    autoItem.inventory.current_stock = newStock

    stockMovements.push({
      tenant_id: tenantId,
      inventory_item_id: autoItem.inventory.id,
      movement_type: 'sale',
      quantity_change: -quantityDelta,
      previous_stock: previousStock,
      new_stock: newStock,
      reference_id: autoItem.orderId,
      notes: `Square sale sync: ${autoItem.lineName}`
    })
  }

  if (stockMovements.length > 0) {
    const { error } = await supabase
      .from('stock_movements')
      .insert(stockMovements)

    if (error) {
      throw new Error(`Failed to log stock movements: ${error.message}`)
    }
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }

  // Resolve tenant and load Square config
  const tenantId = await getCurrentTenantId()
  const squareConfig = await getTenantSquareConfig(tenantId)
  if (!squareConfig) {
    return NextResponse.json({ error: 'Square not configured' }, { status: 503 })
  }

  const supabase = createServiceClient()
  let currentRunId: string | null = null

  try {
    const body = (await request.json().catch(() => ({}))) as SalesSyncRequestBody

    const lastRun = await getLastSuccessfulRun(supabase, tenantId)
    const syncRun = await createSyncRun(supabase, tenantId, authResult.userId ?? null)
    currentRunId = syncRun.id

    const sinceTimestamp = lastRun?.last_synced_at
      ? new Date(new Date(lastRun.last_synced_at).getTime() - 60 * 1000).toISOString()
      : undefined

    const { orders, cursor } = await fetchSquareOrders(squareConfig, sinceTimestamp)
    const inventoryMap = await fetchInventoryMap(supabase, tenantId)

    const metrics: SyncMetrics = {
      ordersProcessed: 0,
      autoDecrements: 0,
      manualPending: 0,
      ignoredLines: 0,
      itemSummaries: [],
      nextCursor: cursor ?? null
    }

    const autoItemsForAdjustment: Array<{
      inventory: InventoryRow
      quantity: number
      orderId: string
      lineName: string
    }> = []

    let latestOrderedAt: string | undefined

    for (const order of orders) {
      const orderedAt = order.created_at
      if (sinceTimestamp && orderedAt && new Date(orderedAt) <= new Date(sinceTimestamp)) {
        continue
      }

      const transactionResult = await insertSalesTransaction(
        supabase,
        tenantId,
        order,
        syncRun.id,
        Boolean(body.dryRun)
      )

      if (!transactionResult) continue
      if (!transactionResult.wasInserted && !body.dryRun) {
        continue
      }

      metrics.ordersProcessed += 1
      if (orderedAt) {
        const orderedAtDate = new Date(orderedAt)
        if (!latestOrderedAt || orderedAtDate > new Date(latestOrderedAt)) {
          latestOrderedAt = orderedAt
        }
      }

      const lineItemsPayload: Parameters<typeof insertTransactionItems>[3] = []

      for (const [lineIndex, lineItem] of (order.line_items ?? []).entries()) {
        const rawCatalogId = lineItem.catalog_object_id || lineItem.variation_id || null
        const generatedCatalogId = rawCatalogId || lineItem.uid || `${order.id}-line-${lineIndex}`
        const quantity = parseQuantity(lineItem.quantity)
        const lineName = lineItem.name || 'Unnamed Item'
        const inventoryItem = rawCatalogId ? inventoryMap.get(rawCatalogId) : undefined
        const { impactType, reason } = mapImpactType(inventoryItem)

        if (impactType === 'auto' && inventoryItem) {
          metrics.autoDecrements += quantity
          autoItemsForAdjustment.push({
            inventory: inventoryItem,
            quantity,
            orderId: order.id,
            lineName
          })
        } else if (impactType === 'manual') {
          metrics.manualPending += quantity
        } else {
          metrics.ignoredLines += quantity
        }

        metrics.itemSummaries.push({
          name: lineName,
          quantity,
          impact: impactType
        })

        lineItemsPayload.push({
          inventory_item_id: inventoryItem?.id ?? null,
          square_catalog_object_id: generatedCatalogId,
          name: lineName,
          quantity,
          impact_type: impactType,
          impact_reason: reason ?? (rawCatalogId ? undefined : 'No catalog object id'),
          unit: lineItem.unit_price?.measurement_unit?.type,
          metadata: {
            original_catalog_object_id: rawCatalogId,
            variation_id: lineItem.variation_id,
            uid: lineItem.uid,
            modifiers: (lineItem.modifiers ?? []).map(mod => ({
              uid: mod.uid ?? null,
              catalog_object_id: mod.catalog_object_id ?? null,
              name: mod.name,
              quantity: mod.quantity,
              base_price_money: mod.base_price_money,
              total_price_money: mod.total_price_money
            })),
            base_price_money: lineItem.base_price_money,
            gross_sales_money: lineItem.gross_sales_money,
            total_tax_money: lineItem.total_tax_money
          }
        })
      }

      await insertTransactionItems(
        supabase,
        tenantId,
        transactionResult.id,
        lineItemsPayload,
        Boolean(body.dryRun)
      )
    }

    await applyAutoDecrements(supabase, tenantId, autoItemsForAdjustment, Boolean(body.dryRun))

    metrics.lastOrderedAt = latestOrderedAt

    await updateSyncRun(supabase, tenantId, syncRun.id, {
      status: 'success',
      square_cursor: cursor ?? null,
      last_synced_at: latestOrderedAt ?? lastRun?.last_synced_at ?? null,
      orders_processed: metrics.ordersProcessed,
      auto_decrements: Math.round(metrics.autoDecrements),
      manual_pending: Math.round(metrics.manualPending)
    })

    return NextResponse.json({
      success: true,
      runId: syncRun.id,
      message: `Processed ${metrics.ordersProcessed} orders`,
      metrics
    })
  } catch (error) {
    console.error('Sales sync error:', error)

    if (error instanceof Error && error.message.includes('Failed to create sync run')) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (error instanceof Error) {
      // Attempt to mark the latest pending run as failed
      try {
        const runId = currentRunId
        if (runId) {
          await updateSyncRun(supabase, tenantId, runId, {
            status: 'error',
            error_message: error.message
          })
        }
      } catch (updateError) {
        console.error('Failed to update sync run status:', updateError)
      }

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ error: 'Unknown error occurred' }, { status: 500 })
  }
}
