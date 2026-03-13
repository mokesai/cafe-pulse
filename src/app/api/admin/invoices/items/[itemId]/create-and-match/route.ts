import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { itemId } = await context.params
    const { new_item_data, match_method } = await request.json()
    
    console.log('🔨 Creating new inventory item and matching:', {
      itemId,
      new_item_data,
      match_method
    })

    if (!new_item_data || !new_item_data.name) {
      return NextResponse.json({
        success: false,
        error: 'New item data is required'
      }, { status: 400 })
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Create new inventory item
    const { data: newItem, error: createError } = await supabase
      .from('inventory_items')
      .insert({
        tenant_id: tenantId,
        item_name: new_item_data.name,
        current_stock: 0, // Start with 0 stock, will be updated when invoice is confirmed
        unit_cost: new_item_data.unit_cost,
        unit_type: new_item_data.unit_type,
        location: new_item_data.location,
        minimum_threshold: new_item_data.minimum_threshold || 5,
        reorder_point: new_item_data.reorder_point || 10,
        is_ingredient: false, // Default to false, can be updated later
        notes: `Created from invoice import: ${new Date().toISOString()}`,
        // Store category info in notes if provided
        ...(new_item_data.category_id && { 
          notes: `Created from invoice import: ${new Date().toISOString()}. Category: ${new_item_data.category_id}` 
        })
      })
      .select()
      .single()

    if (createError) {
      console.error('Failed to create inventory item:', createError)
      return NextResponse.json({
        success: false,
        error: `Failed to create inventory item: ${createError.message}`
      }, { status: 500 })
    }

    console.log('✅ Created new inventory item:', newItem)

    // Update the invoice item to match with the new inventory item
    const { error: matchError } = await supabase
      .from('invoice_items')
      .update({
        matched_item_id: newItem.id,
        match_confidence: 1.0, // High confidence for manual creation
        match_method: match_method || 'manual_create',
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .eq('tenant_id', tenantId)

    if (matchError) {
      console.error('Failed to match invoice item:', matchError)
      // Try to clean up the created item
      await supabase
        .from('inventory_items')
        .delete()
        .eq('id', newItem.id)
      
      return NextResponse.json({
        success: false,
        error: `Failed to match invoice item: ${matchError.message}`
      }, { status: 500 })
    }

    console.log('✅ Matched invoice item to new inventory item')

    return NextResponse.json({
      success: true,
      data: {
        inventory_item: newItem,
        message: 'New inventory item created and matched successfully'
      }
    })

  } catch (error) {
    console.error('Error creating and matching item:', error)
    return NextResponse.json({
      success: false,
      error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 })
  }
}
