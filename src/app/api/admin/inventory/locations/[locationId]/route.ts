import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { locationId } = resolvedParams
    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    
    console.log('Updating inventory location:', locationId, body)

    const supabase = createServiceClient()

    // Build update object with only provided fields
    const updateData: { name?: string | null; description?: string | null; is_active?: boolean } = {}
    if (body.name !== undefined) updateData.name = body.name?.trim() || null
    if (body.description !== undefined) updateData.description = body.description?.trim() || null
    if (body.is_active !== undefined) updateData.is_active = body.is_active

    // Update location
    const { data: updatedLocation, error } = await supabase
      .from('inventory_locations')
      .update(updateData)
      .eq('id', locationId)
      .select()
      .single()

    if (error) {
      console.error('Database error updating inventory location:', error)
      return NextResponse.json(
        { error: 'Failed to update inventory location', details: error.message },
        { status: 500 }
      )
    }

    if (!updatedLocation) {
      return NextResponse.json(
        { error: 'Inventory location not found' },
        { status: 404 }
      )
    }

    console.log('✅ Successfully updated inventory location:', locationId)

    return NextResponse.json({
      success: true,
      location: updatedLocation,
      message: 'Inventory location updated successfully'
    })

  } catch (error) {
    console.error('Failed to update inventory location:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update inventory location', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
