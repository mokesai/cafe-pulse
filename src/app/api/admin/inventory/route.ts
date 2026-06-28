import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

// MOK-170: a free-form package_label distinguishes multiple supplier products that share the
// same square_item_id + pack_size. Empty/whitespace collapses to NULL (the default packaging).
function normalizePackageLabel(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

// MOK-170: the (tenant, supplier, square_item_id, pack_size, package_label) unique index raises
// 23505 when a second packaging lacks a distinct label. Surface an actionable message instead of
// the raw Postgres duplicate-key error.
const DUPLICATE_PACKAGE_MESSAGE =
  'This supplier already has an item with the same Square item ID, pack size, and package label. ' +
  'Give this packaging a distinct Package Label to add it alongside the existing one.'

// MOK-171: package_cost (the entered pack/case price) is canonical for pack rows; unit_cost is the
// derived per-unit value used by stock/COGS math. Whichever the caller supplies, derive the other
// so the two stay consistent and the entered package cost never drifts from 4dp unit_cost rounding.
function resolveCosts(opts: {
  unit_cost?: unknown
  package_cost?: unknown
  packSize: unknown
  fallbackUnitCost?: number
}): { unit_cost: number; package_cost: number } {
  const packSize = Math.max(1, Number(opts.packSize) || 1)
  const round4 = (n: number) => Number((Number.isFinite(n) ? n : 0).toFixed(4))
  const hasPackage =
    opts.package_cost !== undefined && opts.package_cost !== null && opts.package_cost !== ''
  if (hasPackage) {
    const packageCost = Number(opts.package_cost) || 0
    return { package_cost: round4(packageCost), unit_cost: round4(packageCost / packSize) }
  }
  const unitCost = Number(opts.unit_cost ?? opts.fallbackUnitCost ?? 0) || 0
  return { unit_cost: round4(unitCost), package_cost: round4(unitCost * packSize) }
}

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
    // MOK-142: search and limit support — used by NoItemMatchForm's
    // "search all inventory items" autocomplete. Pre-MOK-142 these query
    // params were silently dropped, and the form read response.data
    // (undefined since the route returns `items`), so the search input
    // appeared to do nothing.
    const search = searchParams.get('search')?.trim() ?? ''
    const limitRaw = parseInt(searchParams.get('limit') ?? '0', 10)
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : null
    // MOK-144: re-match panel needs to surface pack-pair siblings of the
    // currently-matched row. Two query modes:
    //   ?square_item_id=…  → return all rows sharing that square_item_id
    //   ?siblings_of=<id>  → resolve the row's square_item_id then return its
    //                        pack-pair group (excluding the row itself)
    // Both ignore the search box; they're the "pinned siblings" payload the
    // form merges with typed-search results.
    const siblingsSquareItemId = searchParams.get('square_item_id')?.trim() ?? ''
    const siblingsOfId = searchParams.get('siblings_of')?.trim() ?? ''

    // Get tenant ID
    const tenantId = await getCurrentTenantId()

    // Resolve `siblings_of=<id>` → the row's square_item_id, so the form can
    // pass just the matched item id without a second round-trip.
    let resolvedSquareId = siblingsSquareItemId
    if (!resolvedSquareId && siblingsOfId) {
      const { data: anchorRow } = await supabase
        .from('inventory_items')
        .select('square_item_id')
        .eq('id', siblingsOfId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      resolvedSquareId = anchorRow?.square_item_id ?? ''
    }

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

    if (resolvedSquareId) {
      // Sibling-group lookup wins over the search box — the form uses this
      // path for the "pack-pair siblings" panel and applies search separately.
      query = query.eq('square_item_id', resolvedSquareId)
      if (siblingsOfId) {
        query = query.neq('id', siblingsOfId)
      }
    } else if (search.length > 0) {
      query = query.ilike('item_name', `%${search}%`)
    }

    if (limit) {
      query = query.limit(limit)
    }

    const { data: inventoryItems, error } = await query

    if (error) {
      return formatApiError('fetch inventory items', error)
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
      // MOK-142: alias under `data` for form callers (NoItemMatchForm)
      // reading `data.data ?? []`. Existing callers reading `items`
      // continue to work.
      data: processedItems,
      total: processedItems.length,
      message: 'Inventory items fetched successfully'
    })

  } catch (error) {
    return unexpectedError('fetch inventory items', error)
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
      pack_size,
      package_label,
      package_cost
    } = body

    const finalItemType = item_type || (is_ingredient ? 'ingredient' : 'prepackaged')
    const derivedIsIngredient = finalItemType === 'ingredient' || !!is_ingredient
    // Prepackaged and prepared items require a Square item ID (they're sold through Square).
    // Ingredients and supplies (cups, straws, lids, sleeves, etc.)
    // are managed internally and don't need a Square catalog entry.
    const requiresSquareId = finalItemType === 'prepackaged' || finalItemType === 'prepared'

    if (!item_name || current_stock === undefined) {
      return apiError('Item name and current stock are required to create an inventory item.')
    }

    if (requiresSquareId && !square_item_id) {
      return apiError(
        'A Square item ID is required for prepackaged and prepared items. ' +
        'Link this item to a Square catalog entry or change the item type.'
      )
    }

    const finalSquareId =
      square_item_id && square_item_id.trim().length > 0
        ? square_item_id.trim()
        : `manual-${crypto.randomUUID()}`

    console.log('Creating new inventory item:', { square_item_id: finalSquareId, item_name, current_stock })

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // MOK-171: keep package_cost (entered) and unit_cost (derived) consistent.
    const costs = resolveCosts({ unit_cost, package_cost, packSize: pack_size })

    // Insert new inventory item
    const { data: newItem, error } = await supabase
      .from('inventory_items')
      .insert({
        tenant_id: tenantId,
        square_item_id: finalSquareId,
        item_name,
        current_stock,
        minimum_threshold: minimum_threshold || 5,
        reorder_point: reorder_point || 10,
        unit_cost: costs.unit_cost,
        unit_type: unit_type || 'each',
        pack_size: pack_size || 1,
        package_cost: costs.package_cost,
        is_ingredient: derivedIsIngredient,
        item_type: finalItemType,
        supplier_id: supplier_id || null,
        location: location || 'main',
        notes: notes || null,
        package_label: normalizePackageLabel(package_label),
        last_restocked_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return apiError(DUPLICATE_PACKAGE_MESSAGE, 409, 'DUPLICATE_PACKAGE')
      }
      return formatApiError('create inventory item', error)
    }

    // Create initial stock movement record
    const { error: movementError } = await supabase
      .from('stock_movements')
      .insert({
        tenant_id: tenantId,
        inventory_item_id: newItem.id,
        movement_type: 'adjustment',
        quantity_change: current_stock,
        previous_stock: 0,
        new_stock: current_stock,
        unit_cost: costs.unit_cost,
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
    return unexpectedError('create inventory item', error)
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
      pack_size,
      package_label,
      package_cost
    } = body

    if (!id) {
      return apiError('Inventory item ID is required to update an item.')
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Load current values for change tracking (unit_cost, pack_size)
    const { data: existing, error: existingError } = await supabase
      .from('inventory_items')
      .select('unit_cost, pack_size')
      .eq('id', id)
      .single()

    if (existingError || !existing) {
      return apiError(
        'Inventory item not found. It may have been deleted — refresh and try again.',
        404,
        'NOT_FOUND'
      )
    }

    console.log('Updating inventory item:', id)

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {}
    if (item_name !== undefined) updateData.item_name = item_name
    if (minimum_threshold !== undefined) updateData.minimum_threshold = minimum_threshold
    if (reorder_point !== undefined) updateData.reorder_point = reorder_point
    if (pack_size !== undefined) updateData.pack_size = pack_size
    // MOK-171: when either cost is supplied, derive the other so package_cost (entered) and
    // unit_cost (per-unit) stay consistent. package_cost wins for pack rows; uses the new
    // pack size when it's being changed in the same request.
    if (unit_cost !== undefined || package_cost !== undefined) {
      const packSizeForCalc = pack_size !== undefined ? pack_size : existing.pack_size
      const costs = resolveCosts({
        unit_cost,
        package_cost,
        packSize: packSizeForCalc,
        fallbackUnitCost: Number(existing.unit_cost) || 0,
      })
      updateData.unit_cost = costs.unit_cost
      updateData.package_cost = costs.package_cost
    }
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
    if (package_label !== undefined) updateData.package_label = normalizePackageLabel(package_label)

    // Update inventory item
    const { data: updatedItem, error } = await supabase
      .from('inventory_items')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return apiError(DUPLICATE_PACKAGE_MESSAGE, 409, 'DUPLICATE_PACKAGE')
      }
      return formatApiError('update inventory item', error)
    }

    // Cost history: log when the (derived) unit_cost changes — covers edits made via either the
    // unit cost or the package cost field (MOK-171).
    const newUnitCost = updateData.unit_cost as number | undefined
    if (newUnitCost !== undefined && Number(existing.unit_cost) !== Number(newUnitCost)) {
      const packSize = Number(updatedItem.pack_size) || 1
      await supabase
        .from('inventory_item_cost_history')
        .insert({
          tenant_id: tenantId,
          inventory_item_id: id,
          previous_unit_cost: existing.unit_cost,
          new_unit_cost: newUnitCost,
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
    return unexpectedError('update inventory item', error)
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
      return apiError('Inventory item ID is required to archive an item.')
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('inventory_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return formatApiError('archive inventory item', error)
    }

    return NextResponse.json({
      success: true,
      item: data,
      message: 'Inventory item archived'
    })
  } catch (error) {
    return unexpectedError('archive inventory item', error)
  }
}
