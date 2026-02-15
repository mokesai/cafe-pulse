import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const supabase = await createCurrentTenantClient()

    // Fetch all unit types
    const { data: units, error } = await supabase
      .from('inventory_unit_types')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      console.error('Database error fetching inventory unit types:', error)
      return NextResponse.json(
        { error: 'Failed to fetch inventory unit types', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      units: units || [],
      total: units?.length || 0,
      message: 'Inventory unit types fetched successfully'
    })

  } catch (error) {
    console.error('Failed to fetch inventory unit types:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch inventory unit types', 
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
    const { name, symbol, category } = body

    if (!name?.trim() || !symbol?.trim()) {
      return NextResponse.json(
        { error: 'Unit name and symbol are required' },
        { status: 400 }
      )
    }

    console.log('Creating new inventory unit type:', { name, symbol, category })

    const supabase = await createCurrentTenantClient()

    // Check if symbol already exists
    const { data: existingUnit } = await supabase
      .from('inventory_unit_types')
      .select('id')
      .eq('symbol', symbol.trim())
      .single()

    if (existingUnit) {
      return NextResponse.json(
        { error: 'A unit type with this symbol already exists' },
        { status: 400 }
      )
    }

    // Insert new unit type
    const { data: newUnit, error } = await supabase
      .from('inventory_unit_types')
      .insert({
        name: name.trim(),
        symbol: symbol.trim(),
        category: category || 'Count',
        is_active: true
      })
      .select()
      .single()

    if (error) {
      console.error('Database error creating inventory unit type:', error)
      return NextResponse.json(
        { error: 'Failed to create inventory unit type', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Successfully created inventory unit type:', newUnit.id)

    return NextResponse.json({
      success: true,
      unit: newUnit,
      message: 'Inventory unit type created successfully'
    })

  } catch (error) {
    console.error('Failed to create inventory unit type:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create inventory unit type', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}