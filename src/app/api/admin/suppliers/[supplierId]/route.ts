import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'

interface SupplierUpdateBody {
  name: string
  contact_person?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  payment_terms?: string | null
  notes?: string | null
  is_active?: boolean
}

type SupplierPartialUpdatePayload = Partial<{
  name: string | null
  contact_person: string | null
  email: string | null
  phone: string | null
  address: string | null
  payment_terms: string | null
  notes: string | null
  is_active: boolean
}>

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { supplierId } = resolvedParams
    if (!supplierId) {
      return NextResponse.json(
        { error: 'Supplier ID is required' },
        { status: 400 }
      )
    }

    const body: SupplierUpdateBody = await request.json()
    const { 
      name,
      contact_person,
      email,
      phone,
      address,
      payment_terms,
      notes,
      is_active
    } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Supplier name is required' },
        { status: 400 }
      )
    }

    console.log('Updating supplier:', supplierId)

    const supabase = await createCurrentTenantClient()

    // Update supplier
    const { data: updatedSupplier, error } = await supabase
      .from('suppliers')
      .update({
        name: name.trim(),
        contact_person: contact_person?.trim() || null,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        payment_terms: payment_terms?.trim() || null,
        notes: notes?.trim() || null,
        is_active
      })
      .eq('id', supplierId)
      .select()
      .single()

    if (error) {
      console.error('Database error updating supplier:', error)
      return NextResponse.json(
        { error: 'Failed to update supplier', details: error.message },
        { status: 500 }
      )
    }

    if (!updatedSupplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      )
    }

    console.log('✅ Successfully updated supplier:', supplierId)

    return NextResponse.json({
      success: true,
      supplier: updatedSupplier,
      message: 'Supplier updated successfully'
    })

  } catch (error) {
    console.error('Failed to update supplier:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update supplier', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { supplierId } = resolvedParams
    if (!supplierId) {
      return NextResponse.json(
        { error: 'Supplier ID is required' },
        { status: 400 }
      )
    }

    const body: SupplierPartialUpdatePayload = await request.json()
    
    console.log('Partially updating supplier:', supplierId, body)

    const supabase = await createCurrentTenantClient()

    // Build update object with only provided fields
    const updateData: SupplierPartialUpdatePayload = {}
    if (body.name !== undefined) updateData.name = body.name?.trim() || null
    if (body.contact_person !== undefined) updateData.contact_person = body.contact_person?.trim() || null
    if (body.email !== undefined) updateData.email = body.email?.trim() || null
    if (body.phone !== undefined) updateData.phone = body.phone?.trim() || null
    if (body.address !== undefined) updateData.address = body.address?.trim() || null
    if (body.payment_terms !== undefined) updateData.payment_terms = body.payment_terms?.trim() || null
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null
    if (body.is_active !== undefined) updateData.is_active = body.is_active

    // Update supplier
    const { data: updatedSupplier, error } = await supabase
      .from('suppliers')
      .update(updateData)
      .eq('id', supplierId)
      .select()
      .single()

    if (error) {
      console.error('Database error updating supplier:', error)
      return NextResponse.json(
        { error: 'Failed to update supplier', details: error.message },
        { status: 500 }
      )
    }

    if (!updatedSupplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      )
    }

    console.log('✅ Successfully updated supplier:', supplierId)

    return NextResponse.json({
      success: true,
      supplier: updatedSupplier,
      message: 'Supplier updated successfully'
    })

  } catch (error) {
    console.error('Failed to update supplier:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update supplier', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { supplierId } = resolvedParams
    if (!supplierId) {
      return NextResponse.json(
        { error: 'Supplier ID is required' },
        { status: 400 }
      )
    }

    console.log('Deleting supplier:', supplierId)

    const supabase = await createCurrentTenantClient()

    // Check if supplier has associated inventory items
    const { data: inventoryItems, error: checkError } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('supplier_id', supplierId)
      .limit(1)

    if (checkError) {
      console.error('Error checking inventory items:', checkError)
      return NextResponse.json(
        { error: 'Failed to verify supplier usage', details: checkError.message },
        { status: 500 }
      )
    }

    if (inventoryItems && inventoryItems.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete supplier with associated inventory items. Deactivate instead.' },
        { status: 400 }
      )
    }

    // Delete supplier
    const { error } = await supabase
      .from('suppliers')
      .delete()
      .eq('id', supplierId)

    if (error) {
      console.error('Database error deleting supplier:', error)
      return NextResponse.json(
        { error: 'Failed to delete supplier', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Successfully deleted supplier:', supplierId)

    return NextResponse.json({
      success: true,
      message: 'Supplier deleted successfully'
    })

  } catch (error) {
    console.error('Failed to delete supplier:', error)
    return NextResponse.json(
      { 
        error: 'Failed to delete supplier', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
