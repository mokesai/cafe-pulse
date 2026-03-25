import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { id } = await context.params
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    const { data: alias, error } = await supabase
      .from('supplier_item_aliases')
      .select(`
        id,
        tenant_id,
        supplier_id,
        supplier_description,
        inventory_item_id,
        confidence,
        source,
        use_count,
        last_seen_invoice_id,
        last_seen_at,
        created_at,
        updated_at,
        suppliers (
          id,
          name
        ),
        inventory_items (
          id,
          item_name,
          unit_cost
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Alias not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'Failed to fetch alias', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data: alias })
  } catch (error) {
    console.error('Failed to fetch alias:', error)
    return NextResponse.json(
      { error: 'Failed to fetch alias', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { id } = await context.params
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    let body: { inventory_item_id?: string; description?: string; confidence?: number }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { inventory_item_id, description, confidence } = body

    // Must provide at least one field to update
    if (!inventory_item_id && !description && confidence === undefined) {
      return NextResponse.json(
        { error: 'Provide at least one field to update: inventory_item_id, description, or confidence' },
        { status: 400 }
      )
    }

    // Validate confidence range if provided
    if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
      return NextResponse.json(
        { error: 'confidence must be between 0.0 and 1.0' },
        { status: 400 }
      )
    }

    // Verify alias exists and belongs to tenant
    const { data: existing, error: fetchError } = await supabase
      .from('supplier_item_aliases')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Alias not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'Failed to fetch alias', details: fetchError.message },
        { status: 500 }
      )
    }

    if (!existing) {
      return NextResponse.json({ error: 'Alias not found' }, { status: 404 })
    }

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (inventory_item_id !== undefined) updatePayload.inventory_item_id = inventory_item_id
    if (description !== undefined) updatePayload.supplier_description = description
    if (confidence !== undefined) updatePayload.confidence = confidence

    const { data: updatedAlias, error: updateError } = await supabase
      .from('supplier_item_aliases')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(`
        id,
        tenant_id,
        supplier_id,
        supplier_description,
        inventory_item_id,
        confidence,
        source,
        use_count,
        last_seen_invoice_id,
        last_seen_at,
        created_at,
        updated_at,
        suppliers (
          id,
          name
        ),
        inventory_items (
          id,
          item_name,
          unit_cost
        )
      `)
      .single()

    if (updateError) {
      console.error('Error updating alias:', updateError)
      return NextResponse.json(
        { error: 'Failed to update alias', details: updateError.message },
        { status: 500 }
      )
    }

    console.log(`✅ Updated supplier item alias ${id}`)

    return NextResponse.json({ success: true, data: updatedAlias })
  } catch (error) {
    console.error('Failed to update alias:', error)
    return NextResponse.json(
      { error: 'Failed to update alias', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { id } = await context.params
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Verify alias exists and belongs to tenant
    const { data: alias, error: fetchError } = await supabase
      .from('supplier_item_aliases')
      .select('id, supplier_description')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Alias not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'Failed to fetch alias', details: fetchError.message },
        { status: 500 }
      )
    }

    if (!alias) {
      return NextResponse.json({ error: 'Alias not found' }, { status: 404 })
    }

    const { error: deleteError } = await supabase
      .from('supplier_item_aliases')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (deleteError) {
      console.error('Error deleting alias:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete alias', details: deleteError.message },
        { status: 500 }
      )
    }

    console.log(`✅ Deleted supplier item alias ${id} (${alias.supplier_description})`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete alias:', error)
    return NextResponse.json(
      { error: 'Failed to delete alias', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
