import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const supabase = createServiceClient()

    // Fetch all locations
    const { data: locations, error } = await supabase
      .from('inventory_locations')
      .select('*')
      .order('name')

    if (error) {
      console.error('Database error fetching inventory locations:', error)
      return NextResponse.json(
        { error: 'Failed to fetch inventory locations', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      locations: locations || [],
      total: locations?.length || 0,
      message: 'Inventory locations fetched successfully'
    })

  } catch (error) {
    console.error('Failed to fetch inventory locations:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch inventory locations', 
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
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const body = await request.json()
    const { name, description } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Location name is required' },
        { status: 400 }
      )
    }

    console.log('Creating new inventory location:', name)

    const supabase = createServiceClient()

    // Insert new location
    const { data: newLocation, error } = await supabase
      .from('inventory_locations')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        is_active: true
      })
      .select()
      .single()

    if (error) {
      console.error('Database error creating inventory location:', error)
      return NextResponse.json(
        { error: 'Failed to create inventory location', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Successfully created inventory location:', newLocation.id)

    return NextResponse.json({
      success: true,
      location: newLocation,
      message: 'Inventory location created successfully'
    })

  } catch (error) {
    console.error('Failed to create inventory location:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create inventory location', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}