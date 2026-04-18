import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

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
      return apiError('Both inventory_item_id and new_stock are required to adjust stock.')
    }

    const parsedStock = Number(new_stock)
    const targetStock = Math.round(parsedStock)
    if (!Number.isFinite(parsedStock) || targetStock < 0) {
      return apiError('New stock must be a non-negative number (e.g. 0, 10, 25.5).')
    }

    const supabase = createServiceClient()
    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
      .select('id, item_name, current_stock, unit_cost, minimum_threshold, reorder_point, square_item_id, pack_size, deleted_at')
      .eq('tenant_id', tenantId)
      .eq('id', inventory_item_id)
      .single()

    if (fetchError || !currentItem) {
      return apiError(
        'Inventory item not found. It may have been deleted — refresh and try again.',
        404,
        'NOT_FOUND'
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
        return apiError(
          'Stock adjustments must be made on the base (single-unit) item, not a pack variant. ' +
          'Find the base item and adjust stock there.',
          400,
          'PACK_VARIANT_ADJUSTMENT_NOT_ALLOWED'
        )
      }
    }

    if (previousStock === targetStock) {
      return apiError(
        `The new stock level (${targetStock}) is the same as the current stock. No adjustment is needed.`
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
      return formatApiError('adjust inventory stock', updateError)
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
    return unexpectedError('adjust inventory stock', error)
  }
}
