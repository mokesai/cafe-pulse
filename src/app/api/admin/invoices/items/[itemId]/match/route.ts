import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

interface RouteContext {
  params: Promise<{ itemId: string }>
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await context.params
    const { itemId } = resolvedParams
    const body = await request.json()
    const {
      matched_item_id,
      match_confidence,
      match_method,
      review_notes
    } = body

    if (!matched_item_id) {
      return apiError('A matched_item_id is required to link an invoice item to inventory.')
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Verify the invoice item exists
    const { data: invoiceItem, error: fetchError } = await supabase
      .from('invoice_items')
      .select('id, invoice_id, item_description')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError || !invoiceItem) {
      return apiError(
        'Invoice item not found. It may have been deleted — refresh and try again.',
        404,
        'NOT_FOUND'
      )
    }

    // Verify the inventory item exists
    const { data: inventoryItem, error: inventoryError } = await supabase
      .from('inventory_items')
      .select('id, item_name, current_stock, unit_cost')
      .eq('id', matched_item_id)
      .eq('tenant_id', tenantId)
      .single()

    if (inventoryError || !inventoryItem) {
      return apiError(
        'The selected inventory item was not found. It may have been deleted — refresh the inventory list and try again.',
        404,
        'INVENTORY_ITEM_NOT_FOUND'
      )
    }

    // Update the invoice item with the match
    const { data: updatedItem, error: updateError } = await supabase
      .from('invoice_items')
      .update({
        matched_item_id,
        match_confidence: match_confidence || 1.0,
        match_method: match_method || 'manual',
        is_reviewed: true,
        review_notes
      })
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .select(`
        id,
        item_description,
        matched_item_id,
        match_confidence,
        match_method,
        is_reviewed,
        review_notes,
        inventory_items (
          id,
          item_name,
          current_stock,
          unit_cost
        )
      `)
      .single()

    if (updateError) {
      return formatApiError('match invoice item to inventory', updateError)
    }

    console.log(`✅ Updated item match: ${invoiceItem.item_description} -> ${inventoryItem.item_name}`)

    return NextResponse.json({
      success: true,
      data: updatedItem,
      message: 'Item match updated successfully'
    })

  } catch (error) {
    return unexpectedError('match invoice item to inventory', error)
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await context.params
    const { itemId } = resolvedParams
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Remove the match from the invoice item
    const { data: updatedItem, error: updateError } = await supabase
      .from('invoice_items')
      .update({
        matched_item_id: null,
        match_confidence: null,
        match_method: null,
        is_reviewed: true,
        review_notes: 'Match removed manually'
      })
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .select('id, item_description')
      .single()

    if (updateError) {
      return formatApiError('remove invoice item match', updateError)
    }

    console.log(`✅ Removed item match for: ${updatedItem?.item_description}`)

    return NextResponse.json({
      success: true,
      message: 'Item match removed successfully'
    })

  } catch (error) {
    return unexpectedError('remove invoice item match', error)
  }
}