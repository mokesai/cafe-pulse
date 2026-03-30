import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    console.log('Admin fetching inventory items...')

    const supabase = createServiceClient()
    const { searchParams } = new URL(request.url)
    const includeArchived = searchParams.get('includeArchived') === '1'

    // Get tenant ID
    const tenantId = await getCurrentTenantId()

    // Fetch inventory items with supplier information (excluding archived)
    let query = supabase
      .from('inventory_items')
      .select(`
        *,
        suppliers (
          id,
          name
        )
      `)
      .eq('tenant_id', tenantId)
      .order('item_name')

    if (!includeArchived) {
      query = query.is('deleted_at', null)
    }

    const { data: inventoryItems, error } = await query

    if (error) {
      console.error('Database error fetching inventory:', error)
      return NextResponse.json(
        { error: 'Failed to fetch inventory items', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Fetched', inventoryItems?.length || 0, 'inventory items')

    // Process the data to include supplier name
    const processedItems = inventoryItems?.map(item => ({
      ...item,
      supplier_name: item.suppliers?.name || null
    })) || []

    return NextResponse.json({
      success: true,
      items: processedItems,
      total: processedItems.length,
      message: 'Inventory items fetched successfully'
    })

  } catch (error) {
    console.error('Failed to fetch inventory:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch inventory', 
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
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const { userId } = authResult

    const body = await request.json()
    const { 
      square_item_id, 
      item_name, 
      current_stock, 
      minimum_threshold, 
      reorder_point, 
      unit_cost, 
      unit_type, 
      is_ingredient, 
      item_type,
      supplier_id, 
      location, 
      notes,
      pack_size
    } = body

    const finalItemType = item_type || (is_ingredient ? 'ingredient' : 'prepackaged')
    const derivedIsIngredient = finalItemType === 'ingredient' || !!is_ingredient
    // Only prepackaged items require a Square item ID.
    // Ingredients, prepared items, and supplies (cups, straws, lids, sleeves, etc.)
    // are managed internally and don't need a Square catalog entry.
    const requiresSquareId = finalItemType === 'prepackaged'

    if (!item_name || current_stock === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: item_name, current_stock' },
        { status: 400 }
      )
    }

    if (requiresSquareId && !square_item_id) {
      return NextResponse.json(
        { error: 'Missing required field: square_item_id' },
        { status: 400 }
      )
    }

    const finalSquareId =
      square_item_id && square_item_id.trim().length > 0
        ? square_item_id.trim()
        : `manual-${crypto.randomUUID()}`

    console.log('Creating new inventory item:', { square_item_id: finalSquareId, item_name, current_stock })

    const supabase = createServiceClient()

    // Insert new inventory item
    const { data: newItem, error } = await supabase
      .from('inventory_items')
      .insert({
        square_item_id: finalSquareId,
        item_name,
        current_stock,
        minimum_threshold: minimum_threshold || 5,
        reorder_point: reorder_point || 10,
        unit_cost: unit_cost || 0,
        unit_type: unit_type || 'each',
        pack_size: pack_size || 1,
        is_ingredient: derivedIsIngredient,
        item_type: finalItemType,
        supplier_id: supplier_id || null,
        location: location || 'main',
        notes: notes || null,
        last_restocked_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Database error creating inventory item:', error)
      return NextResponse.json(
        { error: 'Failed to create inventory item', details: error.message },
        { status: 500 }
      )
    }

    // Create initial stock movement record
    const { error: movementError } = await supabase
      .from('stock_movements')
      .insert({
        inventory_item_id: newItem.id,
        movement_type: 'adjustment',
        quantity_change: current_stock,
        previous_stock: 0,
        new_stock: current_stock,
        unit_cost: unit_cost || 0,
        notes: 'Initial stock entry',
        created_by: userId
      })

    if (movementError) {
      console.log('Warning: Could not create stock movement record:', movementError)
    }

    console.log('✅ Successfully created inventory item:', newItem.id)

    return NextResponse.json({
      success: true,
      item: newItem,
      message: 'Inventory item created successfully'
    })

  } catch (error) {
    console.error('Failed to create inventory item:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create inventory item', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const body = await request.json()
    const { 
      id,
      item_name, 
      minimum_threshold, 
      reorder_point, 
      unit_cost, 
      unit_type, 
      is_ingredient, 
      item_type,
      square_item_id,
      auto_decrement,
      supplier_id, 
      location, 
      notes,
      pack_size
    } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Load current values for change tracking (unit_cost, pack_size)
    const { data: existing, error: existingError } = await supabase
      .from('inventory_items')
      .select('unit_cost, pack_size')
      .eq('id', id)
      .single()

    if (existingError || !existing) {
      console.error('Failed to load inventory item before update:', existingError)
      return NextResponse.json(
        { error: 'Inventory item not found' },
        { status: 404 }
      )
    }

    console.log('Updating inventory item:', id)

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {}
    if (item_name !== undefined) updateData.item_name = item_name
    if (minimum_threshold !== undefined) updateData.minimum_threshold = minimum_threshold
    if (reorder_point !== undefined) updateData.reorder_point = reorder_point
    if (unit_cost !== undefined) updateData.unit_cost = unit_cost
    if (pack_size !== undefined) updateData.pack_size = pack_size
    if (unit_type !== undefined) updateData.unit_type = unit_type
    if (square_item_id !== undefined) {
      const trimmed = typeof square_item_id === 'string' ? square_item_id.trim() : ''
      updateData.square_item_id = trimmed || null
    }
    if (is_ingredient !== undefined) updateData.is_ingredient = is_ingredient
    if (item_type !== undefined) updateData.item_type = item_type
    if (auto_decrement !== undefined) updateData.auto_decrement = auto_decrement
    if (supplier_id !== undefined) updateData.supplier_id = supplier_id || null
    if (location !== undefined) updateData.location = location
    if (notes !== undefined) updateData.notes = notes || null

    // Update inventory item
    const { data: updatedItem, error } = await supabase
      .from('inventory_items')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Database error updating inventory item:', error)
      return NextResponse.json(
        { error: 'Failed to update inventory item', details: error.message },
        { status: 500 }
      )
    }

    // Cost history: log when unit_cost changes
    if (unit_cost !== undefined && Number(existing.unit_cost) !== Number(unit_cost)) {
      const packSize = Number(updatedItem.pack_size) || 1
      await supabase
        .from('inventory_item_cost_history')
        .insert({
          inventory_item_id: id,
          previous_unit_cost: existing.unit_cost,
          new_unit_cost: unit_cost,
          pack_size: packSize,
          source: 'manual_edit',
          source_ref: null,
          notes: 'Inventory edit',
          changed_by: authResult.userId
        })
    }

    console.log('✅ Successfully updated inventory item:', id)

    return NextResponse.json({
      success: true,
      item: updatedItem,
      message: 'Inventory item updated successfully'
    })

  } catch (error) {
    console.error('Failed to update inventory item:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update inventory item', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required parameter: id' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('inventory_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Failed to archive inventory item:', error)
      return NextResponse.json(
        { error: 'Failed to archive inventory item', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      item: data,
      message: 'Inventory item archived'
    })
  } catch (error) {
    console.error('Failed to archive inventory item:', error)
    return NextResponse.json(
      { 
        error: 'Failed to archive inventory item', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
