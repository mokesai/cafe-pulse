import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const supabase = createServiceClient()

    // Get tenant ID from cookie
    const cookieStore = await cookies()
    const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'
    console.log('Using tenantId for suppliers query:', tenantId)

    // Build query
    let query = supabase
      .from('suppliers')
      .select('*')
      .eq('tenant_id', tenantId)

    // Filter by active status unless including inactive
    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    // Fetch suppliers
    const { data: suppliers, error } = await query.order('name')

    if (error) {
      console.error('Database error fetching suppliers:', error)
      return NextResponse.json(
        { error: 'Failed to fetch suppliers', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Fetched', suppliers?.length || 0, 'suppliers')

    return NextResponse.json({
      success: true,
      suppliers: suppliers || [],
      total: suppliers?.length || 0,
      message: 'Suppliers fetched successfully'
    })

  } catch (error) {
    console.error('Failed to fetch suppliers:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch suppliers', 
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
    const { 
      name,
      contact_person,
      email,
      phone,
      address,
      payment_terms,
      notes,
      is_active = true
    } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Supplier name is required' },
        { status: 400 }
      )
    }

    console.log('Creating new supplier:', name)

    const supabase = createServiceClient()

    // Insert new supplier
    const { data: newSupplier, error } = await supabase
      .from('suppliers')
      .insert({
        name: name.trim(),
        contact_person: contact_person?.trim() || null,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        payment_terms: payment_terms?.trim() || null,
        notes: notes?.trim() || null,
        is_active
      })
      .select()
      .single()

    if (error) {
      console.error('Database error creating supplier:', error)
      return NextResponse.json(
        { error: 'Failed to create supplier', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Successfully created supplier:', newSupplier.id)

    return NextResponse.json({
      success: true,
      supplier: newSupplier,
      message: 'Supplier created successfully'
    })

  } catch (error) {
    console.error('Failed to create supplier:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create supplier', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}