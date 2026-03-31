import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

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

    // Get tenant ID
    const tenantId = await getCurrentTenantId()

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
      return formatApiError('fetch suppliers', error)
    }

    console.log('✅ Fetched', suppliers?.length || 0, 'suppliers')

    return NextResponse.json({
      success: true,
      suppliers: suppliers || [],
      total: suppliers?.length || 0,
      message: 'Suppliers fetched successfully'
    })

  } catch (error) {
    return unexpectedError('fetch suppliers', error)
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
      return apiError('Supplier name is required.')
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
      return formatApiError('create supplier', error)
    }

    console.log('✅ Successfully created supplier:', newSupplier.id)

    return NextResponse.json({
      success: true,
      supplier: newSupplier,
      message: 'Supplier created successfully'
    })

  } catch (error) {
    return unexpectedError('create supplier', error)
  }
}