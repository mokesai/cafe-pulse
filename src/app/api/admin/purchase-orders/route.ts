import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import type { AdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { canonicalStatus, insertStatusHistory } from './status-utils'
import { cookies } from 'next/headers'

interface SupplierProfileInfo {
  full_name?: string | null
  email?: string | null
}

interface PurchaseOrderItemRow {
  id: string
  inventory_item_id: string
  quantity_ordered: number
  quantity_received: number
  unit_cost?: number | null
  total_cost?: number | null
  is_excluded?: boolean | null
  unit_type?: string | null
  pack_size?: number | null
  ordered_pack_qty?: number | null
  inventory_items?: {
    item_name?: string | null
    unit_type?: string | null
    pack_size?: number | null
  } | null
}

interface StatusHistoryEntry {
  previous_status: string | null
  new_status: string | null
  changed_by: string | null
  changed_at: string
  note?: string | null
}

interface PurchaseOrderRow {
  id: string
  status?: string | null
  sent_by?: string | null
  suppliers?: {
    name?: string | null
    contact_person?: string | null
    email?: string | null
    phone?: string | null
  } | null
  purchase_order_items?: PurchaseOrderItemRow[]
  purchase_order_status_history?: StatusHistoryEntry[]
  [key: string]: unknown
}

function computeOrderTotal(items: PurchaseOrderItemRow[] | undefined) {
  return (items || []).reduce((sum, item) => {
    if (item.is_excluded) return sum
    const lineTotal = typeof item.total_cost === 'number'
      ? item.total_cost
      : (Number(item.quantity_ordered) || 0) * (Number(item.unit_cost) || 0)
    return sum + lineTotal
  }, 0)
}

interface PurchaseOrderItemInput {
  inventory_item_id: string
  quantity_ordered: number
  unit_cost?: number
  ordered_pack_qty?: number | null
  pack_size?: number | null
  order_unit?: string | null
}

interface NormalizedOrderItem extends PurchaseOrderItemInput {
  order_unit: string
  pack_size: number
  ordered_pack_qty: number | null
  quantity_ordered: number
  total_cost: number
}

interface ProfileRow {
  id: string
  full_name?: string | null
  email?: string | null
}

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const dateFilter = searchParams.get('dateFilter')

    const supabase = createServiceClient()

    // Get tenant ID from cookie
    const cookieStore = await cookies()
    const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'

    // Build query with supplier information
    let query = supabase
      .from('purchase_orders')
      .select(`
        *,
        suppliers!purchase_orders_supplier_id_fkey (
          name,
          contact_person,
          email,
          phone
        ),
        purchase_order_items!purchase_order_items_purchase_order_id_fkey (
          *,
          inventory_items!purchase_order_items_inventory_item_id_fkey (
            item_name,
            unit_type,
            pack_size
          )
        ),
        purchase_order_status_history!purchase_order_status_history_purchase_order_id_fkey (
          previous_status,
          new_status,
          changed_by,
          changed_at,
          note
        )
      `)
      .eq('tenant_id', tenantId)

    // Filter by status
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    // Filter by date
    if (dateFilter && dateFilter !== 'all') {
      const now = new Date()
      let startDate: Date

      switch (dateFilter) {
        case 'this_week':
          startDate = new Date(now.setDate(now.getDate() - 7))
          query = query.gte('order_date', startDate.toISOString())
          break
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1)
          query = query.gte('order_date', startDate.toISOString())
          break
        case 'overdue':
          query = query
            .lt('expected_delivery_date', new Date().toISOString())
            .not('status', 'in', '("received", "cancelled")')
          break
      }
    }

    // Fetch purchase orders
    const { data: orders, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('Database error fetching purchase orders:', error)
      return NextResponse.json(
        { error: 'Failed to fetch purchase orders', details: error.message },
        { status: 500 }
      )
    }

    const orderRows = (orders || []) as PurchaseOrderRow[]

    const sentByIds = Array.from(
      new Set(
        orderRows
          .map(order => order.sent_by)
          .filter((value): value is string => Boolean(value))
      )
    )

    let sentByProfiles: Record<string, SupplierProfileInfo> = {}
    if (sentByIds.length > 0) {
      const serviceSupabase = createServiceClient()
      const { data: profiles } = await serviceSupabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', sentByIds)

      sentByProfiles = (profiles || []).reduce((acc: Record<string, SupplierProfileInfo>, profile: ProfileRow) => {
        acc[profile.id] = {
          full_name: profile.full_name,
          email: profile.email
        }
        return acc
      }, {})
    }

    // Transform data to match expected format
    const transformedOrders = orderRows.map(order => {
      const history = (order.purchase_order_status_history || [])
        .map((entry: StatusHistoryEntry) => ({
          previous_status: entry.previous_status,
          new_status: entry.new_status,
          changed_by: entry.changed_by,
          changed_at: entry.changed_at,
          note: entry.note
        }))
        .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())

      const computedTotalAmount = computeOrderTotal(order.purchase_order_items)

      return {
        ...order,
        supplier_name: order.suppliers?.name || 'Unknown Supplier',
        supplier_contact: order.suppliers?.contact_person,
        supplier_email: order.suppliers?.email,
        supplier_phone: order.suppliers?.phone,
        total_amount: computedTotalAmount,
        items: order.purchase_order_items?.map((item: PurchaseOrderItemRow) => ({
          ...item,
          inventory_item_name: item.inventory_items?.item_name || 'Unknown Item',
          unit_type: item.inventory_items?.unit_type || item.unit_type || 'each',
          pack_size: item.inventory_items?.pack_size || item.pack_size || null
        })) || [],
        status_history: history,
        sent_by_profile: order.sent_by ? sentByProfiles[order.sent_by] || null : null
      }
    })

    return NextResponse.json({
      success: true,
      orders: transformedOrders,
      total: transformedOrders.length,
      message: 'Purchase orders fetched successfully'
    })

  } catch (error) {
    console.error('Failed to fetch purchase orders:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch purchase orders', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }
    const admin = authResult as AdminAuthSuccess

    const body = await request.json()
    const { 
      supplier_id,
      order_number,
      expected_delivery_date,
      notes,
      items,
      sent_at,
      actual_delivery_date
    } = body

    if (!supplier_id?.trim()) {
      return NextResponse.json(
        { error: 'Supplier is required' },
        { status: 400 }
      )
    }

    if (!order_number?.trim()) {
      return NextResponse.json(
        { error: 'Order number is required' },
        { status: 400 }
      )
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'At least one item is required' },
        { status: 400 }
      )
    }

    const itemInputs: PurchaseOrderItemInput[] = Array.isArray(items) ? items : []

    // Validate items
    for (const item of itemInputs) {
      if (!item.inventory_item_id || !item.quantity_ordered || item.quantity_ordered <= 0) {
        return NextResponse.json(
          { error: 'All items must have valid inventory item and quantity' },
          { status: 400 }
        )
      }

      if (item.ordered_pack_qty !== undefined && item.ordered_pack_qty !== null) {
        const packQty = Number(item.ordered_pack_qty)
        if (!Number.isFinite(packQty) || packQty <= 0) {
          return NextResponse.json(
            { error: 'ordered_pack_qty must be positive when provided' },
            { status: 400 }
          )
        }
      }
    }

    console.log('Creating new purchase order:', order_number)

    const supabase = createServiceClient()

    // Get tenant ID from cookie
    const cookieStore = await cookies()
    const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'

    // Fetch pack sizes from inventory for missing values
    const inventoryIds = Array.from(new Set(itemInputs.map(item => item.inventory_item_id).filter(Boolean)))
    const inventoryPackMap: Record<string, number> = {}
    if (inventoryIds.length > 0) {
      const { data: invRows } = await supabase
        .from('inventory_items')
        .select('id, pack_size')
        .eq('tenant_id', tenantId)
        .in('id', inventoryIds)
      const typedRows = (invRows || []) as Array<{ id: string; pack_size: number | null }>
      typedRows.forEach(row => {
        inventoryPackMap[row.id] = Number(row.pack_size) || 1
      })
    }

    // Normalize items to unit quantities
    const normalizedItems: NormalizedOrderItem[] = itemInputs.map(item => {
      const packSize = item.pack_size ?? inventoryPackMap[item.inventory_item_id] ?? 1
      const sourceQty = Number(item.quantity_ordered) || 0
      const derivedOrderUnit = item.order_unit || (packSize > 1 ? 'pack' : 'each')
      const packCount = derivedOrderUnit === 'pack'
        ? (item.ordered_pack_qty ?? sourceQty)
        : null
      const quantityOrdered =
        derivedOrderUnit === 'pack'
          ? (packCount || 0) * packSize
          : sourceQty
      const lineTotal = quantityOrdered * (item.unit_cost || 0)
      return {
        ...item,
        order_unit: derivedOrderUnit,
        pack_size: packSize,
        ordered_pack_qty: derivedOrderUnit === 'pack' ? packCount : null,
        quantity_ordered: quantityOrdered,
        total_cost: lineTotal
      }
    })

    // Calculate total amount using unit quantities
    const totalAmount = normalizedItems.reduce((sum, item) => sum + (item.total_cost || 0), 0)

    // Start transaction by creating the purchase order
    const normalizedSentAt = sent_at ? new Date(sent_at).toISOString() : null

    const { data: newOrder, error: orderError } = await supabase
      .from('purchase_orders')
      .insert({
        supplier_id,
        order_number: order_number.trim(),
        status: 'draft',
        order_date: new Date().toISOString(),
        expected_delivery_date: expected_delivery_date || null,
        actual_delivery_date: actual_delivery_date || null,
        sent_at: normalizedSentAt,
        sent_by: normalizedSentAt ? admin.userId : null,
        total_amount: totalAmount,
        notes: notes?.trim() || null
      })
      .select()
      .single()

    if (orderError) {
      console.error('Database error creating purchase order:', orderError)
      return NextResponse.json(
        { error: 'Failed to create purchase order', details: orderError.message },
        { status: 500 }
      )
    }

    // Insert purchase order items
    const orderItems = normalizedItems.map(item => ({
      purchase_order_id: newOrder.id,
      inventory_item_id: item.inventory_item_id,
      quantity_ordered: item.quantity_ordered,
      quantity_received: 0,
      unit_cost: item.unit_cost,
      ordered_pack_qty: item.ordered_pack_qty || null,
      pack_size: item.pack_size ?? 1
    }))

    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(orderItems)

    if (itemsError) {
      // Rollback by deleting the order
      await supabase.from('purchase_orders').delete().eq('id', newOrder.id)
      console.error('Database error creating purchase order items:', itemsError)
      return NextResponse.json(
        { error: 'Failed to create purchase order items', details: itemsError.message },
        { status: 500 }
      )
    }

    console.log('✅ Successfully created purchase order:', newOrder.id)

    await insertStatusHistory(
      supabase,
      newOrder.id,
      null,
      canonicalStatus(newOrder.status || 'draft') || 'draft',
      admin.userId
    )

    return NextResponse.json({
      success: true,
      order: newOrder,
      message: 'Purchase order created successfully'
    })

  } catch (error) {
    console.error('Failed to create purchase order:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create purchase order', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
