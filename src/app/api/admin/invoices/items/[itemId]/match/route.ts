import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

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
      return NextResponse.json(
        { error: 'matched_item_id is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Verify the invoice item exists
    const { data: invoiceItem, error: fetchError } = await supabase
      .from('invoice_items')
      .select('id, invoice_id, item_description')
      .eq('id', itemId)
      .single()

    if (fetchError || !invoiceItem) {
      return NextResponse.json(
        { error: 'Invoice item not found' },
        { status: 404 }
      )
    }

    // Verify the inventory item exists
    const { data: inventoryItem, error: inventoryError } = await supabase
      .from('inventory_items')
      .select('id, item_name, current_stock, unit_cost')
      .eq('id', matched_item_id)
      .single()

    if (inventoryError || !inventoryItem) {
      return NextResponse.json(
        { error: 'Inventory item not found' },
        { status: 404 }
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
      console.error('Error updating invoice item match:', updateError)
      return NextResponse.json(
        { error: 'Failed to update item match', details: updateError.message },
        { status: 500 }
      )
    }

    console.log(`✅ Updated item match: ${invoiceItem.item_description} -> ${inventoryItem.item_name}`)

    return NextResponse.json({
      success: true,
      data: updatedItem,
      message: 'Item match updated successfully'
    })

  } catch (error) {
    console.error('Failed to update item match:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update item match', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
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
      .select('id, item_description')
      .single()

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to remove item match', details: updateError.message },
        { status: 500 }
      )
    }

    console.log(`✅ Removed item match for: ${updatedItem?.item_description}`)

    return NextResponse.json({
      success: true,
      message: 'Item match removed successfully'
    })

  } catch (error) {
    console.error('Failed to remove item match:', error)
    return NextResponse.json(
      { 
        error: 'Failed to remove item match', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}