import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ unitId: string }> }
) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { unitId } = resolvedParams
    if (!unitId) {
      return NextResponse.json(
        { error: 'Unit ID is required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    
    console.log('Updating inventory unit type:', unitId, body)

    const supabase = createServiceClient()

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {}
    if (body.name !== undefined) updateData.name = body.name?.trim() || null
    if (body.symbol !== undefined) updateData.symbol = body.symbol?.trim() || null
    if (body.category !== undefined) updateData.category = body.category
    if (body.is_active !== undefined) updateData.is_active = body.is_active

    // Update unit type
    const { data: updatedUnit, error } = await supabase
      .from('inventory_unit_types')
      .update(updateData)
      .eq('id', unitId)
      .select()
      .single()

    if (error) {
      console.error('Database error updating inventory unit type:', error)
      return NextResponse.json(
        { error: 'Failed to update inventory unit type', details: error.message },
        { status: 500 }
      )
    }

    if (!updatedUnit) {
      return NextResponse.json(
        { error: 'Inventory unit type not found' },
        { status: 404 }
      )
    }

    console.log('✅ Successfully updated inventory unit type:', unitId)

    return NextResponse.json({
      success: true,
      unit: updatedUnit,
      message: 'Inventory unit type updated successfully'
    })

  } catch (error) {
    console.error('Failed to update inventory unit type:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update inventory unit type', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
