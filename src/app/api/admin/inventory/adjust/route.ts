import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const { userId } = authResult

    const tenantId = await getCurrentTenantId()

    const body = await request.json()
    const { inventory_item_id, new_stock, reason, notes, reference_id } = body ?? {}

    if (!inventory_item_id || new_stock === undefined || new_stock === null) {
      return NextResponse.json(
        { error: 'Missing required fields: inventory_item_id and new_stock' },
        { status: 400 }
      )
    }

    const parsedStock = Number(new_stock)
    const targetStock = Math.round(parsedStock)
    if (!Number.isFinite(parsedStock) || targetStock < 0) {
      return NextResponse.json(
        { error: 'New stock value must be a non-negative number' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
      .select('id, item_name, current_stock, unit_cost, minimum_threshold, reorder_point, square_item_id, pack_size, deleted_at')
      .eq('tenant_id', tenantId)
      .eq('id', inventory_item_id)
      .single()

    if (fetchError || !currentItem) {
      console.error('Adjust stock: inventory item not found', fetchError)
      return NextResponse.json(
        { error: 'Inventory item not found', details: fetchError?.message },
        { status: 404 }
      )
    }

    const previousStock = currentItem.current_stock ?? 0

    const packSize = Number(currentItem.pack_size) || 1
    if (currentItem.square_item_id && packSize > 1) {
      const { data: baseItem } = await supabase
        .from('inventory_items')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('square_item_id', currentItem.square_item_id)
        .eq('pack_size', 1)
        .is('deleted_at', null)
        .maybeSingle()
      if (baseItem?.id && baseItem.id !== currentItem.id) {
        return NextResponse.json(
          { error: 'Cannot adjust stock for pack variants. Adjust the base (single-unit) item instead.', base_item_id: baseItem.id },
          { status: 400 }
        )
      }
    }

    if (previousStock === targetStock) {
      return NextResponse.json(
        { error: 'New stock is the same as the current stock. No adjustment needed.' },
        { status: 400 }
      )
    }

    const quantityChange = targetStock - previousStock
    const nowIso = new Date().toISOString()
    const updateData: Record<string, unknown> = {
      current_stock: targetStock
    }
    if (quantityChange > 0) {
      updateData.last_restocked_at = nowIso
    }

    const { data: updatedItem, error: updateError } = await supabase
      .from('inventory_items')
      .update(updateData)
      .eq('tenant_id', tenantId)
      .eq('id', inventory_item_id)
      .select()
      .single()

    if (updateError) {
      console.error('Adjust stock: failed to update inventory item', updateError)
      return NextResponse.json(
        { error: 'Failed to update inventory item', details: updateError.message },
        { status: 500 }
      )
    }

    const trimmedReason = typeof reason === 'string' && reason.trim().length > 0
      ? reason.trim()
      : 'Manual adjustment'
    const trimmedNotes = typeof notes === 'string' ? notes.trim() : ''
    const combinedNotes = trimmedNotes ? `${trimmedReason}: ${trimmedNotes}` : trimmedReason

    const { error: movementError } = await supabase
      .from('stock_movements')
      .insert({
        tenant_id: tenantId,
        inventory_item_id,
        movement_type: 'adjustment',
        quantity_change: quantityChange,
        previous_stock: previousStock,
        new_stock: targetStock,
        unit_cost: currentItem.unit_cost,
        reference_id: reference_id || null,
        notes: combinedNotes,
        created_by: userId
      })

    if (movementError) {
      console.error('Adjust stock: failed to log stock movement', movementError)
      // Do not fail request if movement logging fails
    }

    if (
      typeof currentItem.reorder_point === 'number' &&
      targetStock > currentItem.reorder_point
    ) {
      const { error: alertError } = await supabase
        .from('low_stock_alerts')
        .update({
          is_acknowledged: true,
          acknowledged_by: userId,
          acknowledged_at: nowIso
        })
        .eq('tenant_id', tenantId)
        .eq('inventory_item_id', inventory_item_id)
        .eq('is_acknowledged', false)

      if (alertError) {
        console.warn('Adjust stock: unable to update low stock alerts', alertError)
      }
    }

    console.log('✅ Adjusted inventory item stock', {
      inventory_item_id,
      previousStock,
      targetStock,
      quantityChange
    })

    return NextResponse.json({
      success: true,
      item: updatedItem,
      previousStock,
      newStock: targetStock,
      quantityChange,
      message: `Adjusted ${currentItem.item_name} by ${quantityChange > 0 ? '+' : ''}${quantityChange}`
    })
  } catch (error) {
    console.error('Failed to adjust inventory stock', error)
    return NextResponse.json(
      {
        error: 'Failed to adjust inventory stock',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
