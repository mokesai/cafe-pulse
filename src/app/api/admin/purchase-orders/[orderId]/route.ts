import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import type { AdminAuthSuccess } from '@/lib/admin/middleware'
import { createCurrentTenantClient, createServiceClient } from '@/lib/supabase/server'
import { canonicalStatus, canTransition, insertStatusHistory, isValidStatus } from '../status-utils'

interface SupplierDetails {
  name?: string | null
  contact_person?: string | null
  email?: string | null
  phone?: string | null
}

interface OrderStatusEntry {
  previous_status: string | null
  new_status: string | null
  changed_by: string | null
  changed_at: string
  note?: string | null
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
    square_item_id?: string | null
  } | null
}

interface PurchaseOrderRow {
  id: string
  order_number: string
  sent_by?: string | null
  suppliers?: SupplierDetails | null
  purchase_order_items?: PurchaseOrderItemRow[]
  purchase_order_status_history?: OrderStatusEntry[]
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

interface PurchaseOrderPatchBody {
  status?: string
  expected_delivery_date?: string | null
  actual_delivery_date?: string | null
  notes?: string | null
  status_note?: string | null
  sent_at?: string | null
  sent_via?: string | null
  sent_notes?: string | null
  confirmed_at?: string | null
}

type PurchaseOrderUpdatePayload = Partial<{
  status: string
  expected_delivery_date: string | null
  actual_delivery_date: string | null
  notes: string | null
  sent_at: string | null
  sent_via: string | null
  sent_notes: string | null
  sent_by: string | null
  confirmed_at: string | null
}>

interface PurchaseOrderPutItemInput {
  inventory_item_id: string
  quantity_ordered: number
  quantity_received?: number
  unit_cost?: number
}

interface SanitizedOrderItem extends PurchaseOrderPutItemInput {
  quantity_received: number
  unit_cost: number
}

type PurchaseOrderFullUpdatePayload = Partial<{
  supplier_id: string
  order_number: string
  expected_delivery_date: string | null
  notes: string | null
  total_amount: number
  actual_delivery_date: string | null
  status: string
  sent_at: string | null
  sent_via: string | null
  sent_notes: string | null
  sent_by: string | null
}>

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { orderId } = resolvedParams
    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createCurrentTenantClient()

    // Fetch purchase order with details
    const { data: order, error } = await supabase
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
      .eq('id', orderId)
      .single()

    if (error) {
      console.error('Database error fetching purchase order:', error)
      return NextResponse.json(
        { error: 'Failed to fetch purchase order', details: error.message },
        { status: 500 }
      )
    }

    if (!order) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    // Transform data
    const typedOrder = order as PurchaseOrderRow

    const history = (typedOrder.purchase_order_status_history || [])
      .map((entry: OrderStatusEntry) => ({
        previous_status: entry.previous_status,
        new_status: entry.new_status,
        changed_by: entry.changed_by,
        changed_at: entry.changed_at,
        note: entry.note
      }))
      .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())

    let sentByProfile: { full_name?: string | null; email?: string | null } | null = null

    if (typedOrder.sent_by) {
      const serviceSupabase = createServiceClient()
      const { data: profile } = await serviceSupabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', typedOrder.sent_by)
        .maybeSingle()

      sentByProfile = profile || null
    }

    const transformedOrder = {
      ...typedOrder,
      supplier_name: typedOrder.suppliers?.name || 'Unknown Supplier',
      supplier_contact: typedOrder.suppliers?.contact_person,
      supplier_email: typedOrder.suppliers?.email,
      supplier_phone: typedOrder.suppliers?.phone,
      total_amount: computeOrderTotal(typedOrder.purchase_order_items),
      items: typedOrder.purchase_order_items?.map((item: PurchaseOrderItemRow) => ({
        ...item,
        inventory_item_name: item.inventory_items?.item_name || 'Unknown Item',
        unit_type: item.inventory_items?.unit_type || item.unit_type || 'each',
        pack_size: item.inventory_items?.pack_size || item.pack_size || null
      })) || [],
      status_history: history,
      sent_by_profile: sentByProfile
    }

    return NextResponse.json({
      success: true,
      order: transformedOrder,
      message: 'Purchase order fetched successfully'
    })

  } catch (error) {
    console.error('Failed to fetch purchase order:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch purchase order', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }
    const admin = authResult as AdminAuthSuccess

    const resolvedParams = await params
    const { orderId } = resolvedParams
    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const body: PurchaseOrderPatchBody = await request.json()
    
    console.log('Updating purchase order:', orderId, body)

    const supabase = await createCurrentTenantClient()

    const { data: existingOrder, error: existingError } = await supabase
      .from('purchase_orders')
      .select('status')
      .eq('id', orderId)
      .maybeSingle()

    if (existingError) {
      console.error('Database error fetching purchase order:', existingError)
      return NextResponse.json(
        { error: 'Failed to fetch purchase order', details: existingError.message },
        { status: 500 }
      )
    }

    if (!existingOrder) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const currentStatus = existingOrder.status
    let targetStatus: string | undefined

    // Build update object with only provided fields
    const updateData: PurchaseOrderUpdatePayload = {}
    if (body.status !== undefined) updateData.status = body.status
    if (body.expected_delivery_date !== undefined) updateData.expected_delivery_date = body.expected_delivery_date
    if (body.actual_delivery_date !== undefined) updateData.actual_delivery_date = body.actual_delivery_date
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null

    // If marking as received, automatically update inventory levels
    if (body.status !== undefined) {
      const next = body.status as string
      if (!isValidStatus(next)) {
        return NextResponse.json(
          { error: 'Invalid status supplied' },
          { status: 400 }
        )
      }

      targetStatus = canonicalStatus(next) || next

      if (!canTransition(currentStatus, targetStatus)) {
        return NextResponse.json(
          { error: `Cannot transition purchase order from ${currentStatus} to ${targetStatus}` },
          { status: 400 }
        )
      }

      updateData.status = targetStatus
    }

    if (targetStatus === 'received' && !body.actual_delivery_date) {
      updateData.actual_delivery_date = new Date().toISOString()
    }

    if (targetStatus === 'confirmed' && !body.confirmed_at) {
      updateData.confirmed_at = new Date().toISOString()
    }

    const hasPatchSentAt = Object.prototype.hasOwnProperty.call(body, 'sent_at')
    const hasPatchSentVia = Object.prototype.hasOwnProperty.call(body, 'sent_via')
    const hasPatchSentNotes = Object.prototype.hasOwnProperty.call(body, 'sent_notes')
    let patchSentAt: string | null | undefined
    if (hasPatchSentAt) {
      patchSentAt = body.sent_at ? new Date(body.sent_at).toISOString() : null
    } else if (targetStatus === 'sent') {
      patchSentAt = new Date().toISOString()
    }

    const patchTouchesSent = patchSentAt !== undefined || hasPatchSentVia || hasPatchSentNotes
    if (patchTouchesSent) {
      if (patchSentAt !== undefined) {
        updateData.sent_at = patchSentAt
      }
      if (hasPatchSentVia) {
        updateData.sent_via = body.sent_via || null
      }
      if (hasPatchSentNotes) {
        updateData.sent_notes = body.sent_notes || null
      }
      updateData.sent_by = admin.userId
    }

    // Update purchase order
    const { data: updatedOrder, error } = await supabase
      .from('purchase_orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single()

    if (error) {
      console.error('Database error updating purchase order:', error)
      return NextResponse.json(
        { error: 'Failed to update purchase order', details: error.message },
        { status: 500 }
      )
    }

    if (!updatedOrder) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    // If status changed to 'received', update inventory levels
    if (targetStatus === 'received') {
      console.log('Updating inventory levels for received order')

      // Get purchase order items
      const { data: orderItems, error: itemsError } = await supabase
        .from('purchase_order_items')
        .select(`
          id,
          inventory_item_id,
          quantity_ordered,
          quantity_received,
          ordered_pack_qty,
          pack_size,
          inventory_items!purchase_order_items_inventory_item_id_fkey (
            square_item_id,
            pack_size
          )
        `)
        .eq('purchase_order_id', orderId)

      if (itemsError) {
        console.error('Failed to fetch order items:', itemsError)
      } else if (orderItems && orderItems.length > 0) {
        // Update inventory levels for each item
        for (const item of orderItems as PurchaseOrderItemRow[]) {
          const itemPackSize = item.pack_size ?? item.inventory_items?.pack_size ?? 1
          const unitQuantity = (item.quantity_ordered ?? ((item.ordered_pack_qty || 0) * itemPackSize)) || 0

          // Determine target inventory item to increment (prefer single-unit item with same Square ID)
          let targetInventoryId = item.inventory_item_id
          const squareId = item.inventory_items?.square_item_id || null
          if (squareId) {
            const { data: baseItem } = await supabase
              .from('inventory_items')
              .select('id')
              .eq('square_item_id', squareId)
              .eq('pack_size', 1)
              .is('deleted_at', null)
              .maybeSingle()
            if (baseItem?.id) {
              targetInventoryId = baseItem.id
            }
          }

          const { error: updateError } = await supabase
            .rpc('increment_inventory_stock', {
              item_id: targetInventoryId,
              quantity: unitQuantity
            })

          if (updateError) {
            console.error('Failed to update inventory for item:', item.inventory_item_id, updateError)
          } else {
            // Ensure purchase_order_items.quantity_received reflects what was received
            const { error: poUpdateError } = await supabase
              .from('purchase_order_items')
              .update({ quantity_received: unitQuantity })
              .eq('id', item.id)

            if (poUpdateError) {
              console.warn('Failed to update quantity_received for item:', item.id, poUpdateError)
            }
          }

          // Create stock movement record
          await supabase
            .from('stock_movements')
            .insert({
              inventory_item_id: targetInventoryId,
              movement_type: 'in',
              quantity: unitQuantity,
              reference_type: 'purchase_order',
              reference_id: orderId,
              notes: `Received from purchase order #${updatedOrder.order_number}`
            })
        }
      }
    }

    console.log('✅ Successfully updated purchase order:', orderId)

    if (targetStatus && canonicalStatus(currentStatus) !== targetStatus) {
      await insertStatusHistory(
        supabase,
        orderId,
        canonicalStatus(currentStatus),
        targetStatus,
        admin.userId,
        body.status_note || null
      )
    }

    return NextResponse.json({
      success: true,
      order: updatedOrder,
      message: 'Purchase order updated successfully'
    })

  } catch (error) {
    console.error('Failed to update purchase order:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update purchase order', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }
    const admin = authResult as AdminAuthSuccess

    const resolvedParams = await params
    const { orderId } = resolvedParams

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const body = await request.json() as {
      supplier_id: string
      order_number: string
      expected_delivery_date?: string | null
      notes?: string | null
      items: PurchaseOrderPutItemInput[]
      status?: string
      sent_at?: string | null
      sent_via?: string | null
      sent_notes?: string | null
      actual_delivery_date?: string | null
      status_note?: string | null
    }
    const {
      supplier_id,
      order_number,
      expected_delivery_date,
      notes,
      items,
      status,
      sent_at,
      sent_via,
      sent_notes,
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

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'At least one item is required' },
        { status: 400 }
      )
    }

    const sanitizedItems: SanitizedOrderItem[] = items.map(item => ({
      inventory_item_id: item.inventory_item_id,
      quantity_ordered: Number(item.quantity_ordered) || 0,
      quantity_received: Number(item.quantity_received || 0) || 0,
      unit_cost: Number(item.unit_cost) || 0
    }))

    for (const item of sanitizedItems) {
      if (!item.inventory_item_id || item.quantity_ordered <= 0) {
        return NextResponse.json(
          { error: 'All items must have a valid inventory item and quantity' },
          { status: 400 }
        )
      }
    }

    const supabase = await createCurrentTenantClient()

    const { data: existingOrder, error: fetchError } = await supabase
      .from('purchase_orders')
      .select('id, status, expected_delivery_date')
      .eq('id', orderId)
      .maybeSingle()

    if (fetchError) {
      console.error('Database error fetching purchase order:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch purchase order', details: fetchError.message },
        { status: 500 }
      )
    }

    if (!existingOrder) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const currentStatus = existingOrder.status
    let targetStatus = currentStatus

    if (status !== undefined) {
      if (!isValidStatus(status)) {
        return NextResponse.json(
          { error: 'Invalid status provided' },
          { status: 400 }
        )
      }
      const candidate = canonicalStatus(status) || status
      if (!canTransition(currentStatus, candidate)) {
        return NextResponse.json(
          { error: `Cannot transition purchase order from ${currentStatus} to ${candidate}` },
          { status: 400 }
        )
      }
      targetStatus = candidate
    }

    const subtotal = sanitizedItems.reduce((sum, item) => sum + item.quantity_ordered * item.unit_cost, 0)

    const updatePayload: PurchaseOrderFullUpdatePayload = {
      supplier_id,
      order_number: order_number.trim(),
      expected_delivery_date: expected_delivery_date || null,
      notes: notes?.trim() || null,
      total_amount: subtotal
    }

    if (Object.prototype.hasOwnProperty.call(body, 'actual_delivery_date')) {
      updatePayload.actual_delivery_date = actual_delivery_date || null
    }

    updatePayload.status = targetStatus

    const hasSentAtProp = Object.prototype.hasOwnProperty.call(body, 'sent_at')
    const hasSentViaProp = Object.prototype.hasOwnProperty.call(body, 'sent_via')
    const hasSentNotesProp = Object.prototype.hasOwnProperty.call(body, 'sent_notes')
    let normalizedSentAt: string | null | undefined
    if (hasSentAtProp) {
      normalizedSentAt = sent_at ? new Date(sent_at).toISOString() : null
    } else if (targetStatus === 'sent') {
      normalizedSentAt = new Date().toISOString()
    }

    const touchedSentMetadata = normalizedSentAt !== undefined || hasSentViaProp || hasSentNotesProp
    if (touchedSentMetadata) {
      if (normalizedSentAt !== undefined) {
        updatePayload.sent_at = normalizedSentAt
      }
      if (hasSentViaProp) {
        updatePayload.sent_via = sent_via || null
      }
      if (hasSentNotesProp) {
        updatePayload.sent_notes = sent_notes || null
      }
      updatePayload.sent_by = admin.userId
    }

    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update(updatePayload)
      .eq('id', orderId)

    if (updateError) {
      console.error('Database error updating purchase order:', updateError)
      return NextResponse.json(
        { error: 'Failed to update purchase order', details: updateError.message },
        { status: 500 }
      )
    }

    const { error: deleteError } = await supabase
      .from('purchase_order_items')
      .delete()
      .eq('purchase_order_id', orderId)

    if (deleteError) {
      console.error('Failed to reset purchase order items:', deleteError)
      return NextResponse.json(
        { error: 'Failed to update purchase order items', details: deleteError.message },
        { status: 500 }
      )
    }

    const itemsToInsert = sanitizedItems.map(item => ({
      purchase_order_id: orderId,
      inventory_item_id: item.inventory_item_id,
      quantity_ordered: item.quantity_ordered,
      quantity_received: item.quantity_received,
      unit_cost: item.unit_cost
    }))

    if (itemsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('purchase_order_items')
        .insert(itemsToInsert)

      if (insertError) {
        console.error('Failed to insert purchase order items:', insertError)
        return NextResponse.json(
          { error: 'Failed to insert purchase order items', details: insertError.message },
          { status: 500 }
        )
      }
    }

    console.log('✅ Successfully updated purchase order (full update):', orderId)

    if (canonicalStatus(currentStatus) !== targetStatus) {
      await insertStatusHistory(
        supabase,
        orderId,
        canonicalStatus(currentStatus),
        targetStatus,
        admin.userId,
        body.status_note || null
      )
    }

    return NextResponse.json({
      success: true,
      order_id: orderId
    })
  } catch (error) {
    console.error('Failed to fully update purchase order:', error)
    return NextResponse.json(
      {
        error: 'Failed to update purchase order',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { orderId } = resolvedParams
    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    console.log('Deleting purchase order:', orderId)

    const supabase = await createCurrentTenantClient()

    // Check if order can be deleted (only draft orders)
    const { data: order, error: checkError } = await supabase
      .from('purchase_orders')
      .select('status')
      .eq('id', orderId)
      .single()

    if (checkError) {
      console.error('Error checking order status:', checkError)
      return NextResponse.json(
        { error: 'Failed to verify order status', details: checkError.message },
        { status: 500 }
      )
    }

    if (!order) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    if (order.status !== 'draft') {
      return NextResponse.json(
        { error: 'Can only delete draft purchase orders' },
        { status: 400 }
      )
    }

    // Delete purchase order items first (due to foreign key constraint)
    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .delete()
      .eq('purchase_order_id', orderId)

    if (itemsError) {
      console.error('Database error deleting purchase order items:', itemsError)
      return NextResponse.json(
        { error: 'Failed to delete purchase order items', details: itemsError.message },
        { status: 500 }
      )
    }

    // Delete purchase order
    const { error } = await supabase
      .from('purchase_orders')
      .delete()
      .eq('id', orderId)

    if (error) {
      console.error('Database error deleting purchase order:', error)
      return NextResponse.json(
        { error: 'Failed to delete purchase order', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Successfully deleted purchase order:', orderId)

    return NextResponse.json({
      success: true,
      message: 'Purchase order deleted successfully'
    })

  } catch (error) {
    console.error('Failed to delete purchase order:', error)
    return NextResponse.json(
      { 
        error: 'Failed to delete purchase order', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
