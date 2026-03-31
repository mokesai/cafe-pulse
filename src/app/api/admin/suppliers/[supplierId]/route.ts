import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

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
      return apiError('Supplier ID is required to update a supplier.')
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
      return apiError('Supplier name is required.')
    }

    console.log('Updating supplier:', supplierId)

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

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
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) {
      return formatApiError('update supplier', error)
    }

    if (!updatedSupplier) {
      return apiError(
        'Supplier not found. It may have been deleted — refresh and try again.',
        404,
        'NOT_FOUND'
      )
    }

    console.log('✅ Successfully updated supplier:', supplierId)

    return NextResponse.json({
      success: true,
      supplier: updatedSupplier,
      message: 'Supplier updated successfully'
    })

  } catch (error) {
    return unexpectedError('update supplier', error)
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
      return apiError('Supplier ID is required to update a supplier.')
    }

    const body: SupplierPartialUpdatePayload = await request.json()

    console.log('Partially updating supplier:', supplierId, body)

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

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
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) {
      return formatApiError('update supplier', error)
    }

    if (!updatedSupplier) {
      return apiError(
        'Supplier not found. It may have been deleted — refresh and try again.',
        404,
        'NOT_FOUND'
      )
    }

    console.log('✅ Successfully updated supplier:', supplierId)

    return NextResponse.json({
      success: true,
      supplier: updatedSupplier,
      message: 'Supplier updated successfully'
    })

  } catch (error) {
    return unexpectedError('update supplier', error)
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
      return apiError('Supplier ID is required to delete a supplier.')
    }

    console.log('Deleting supplier:', supplierId)

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Check if supplier has associated inventory items
    const { data: inventoryItems, error: checkError } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('supplier_id', supplierId)
      .eq('tenant_id', tenantId)
      .limit(1)

    if (checkError) {
      return formatApiError('check supplier inventory items before deletion', checkError)
    }

    if (inventoryItems && inventoryItems.length > 0) {
      return apiError(
        'This supplier has associated inventory items and cannot be deleted. ' +
        'Deactivate the supplier instead, or reassign its inventory items first.',
        400,
        'SUPPLIER_HAS_INVENTORY'
      )
    }

    // Delete supplier
    const { error } = await supabase
      .from('suppliers')
      .delete()
      .eq('id', supplierId)
      .eq('tenant_id', tenantId)

    if (error) {
      return formatApiError('delete supplier', error)
    }

    console.log('✅ Successfully deleted supplier:', supplierId)

    return NextResponse.json({
      success: true,
      message: 'Supplier deleted successfully'
    })

  } catch (error) {
    return unexpectedError('delete supplier', error)
  }
}
