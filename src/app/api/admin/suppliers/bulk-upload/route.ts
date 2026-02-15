import { NextRequest, NextResponse } from 'next/server'
import { createCurrentTenantClient } from '@/lib/supabase/server'

interface SupplierImportPayload {
  suppliers: SupplierInput[]
  replaceExisting?: boolean
}

interface SupplierInput {
  name: string
  contact_person?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  payment_terms?: string | null
  notes?: string | null
  is_active?: boolean
}

type ValidatedSupplier = Required<Pick<SupplierInput, 'name'>> &
  Omit<SupplierInput, 'name'> & {
    contact_person: string | null
    email: string | null
    phone: string | null
    address: string | null
    payment_terms: string | null
    notes: string | null
    is_active: boolean
  }

export async function POST(request: NextRequest) {
  try {
    const supabase = await createCurrentTenantClient()

    // Check authentication and admin role
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Check if user has admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json() as SupplierImportPayload
    const { suppliers, replaceExisting = false } = body

    if (!Array.isArray(suppliers)) {
      return NextResponse.json({ error: 'Suppliers must be an array' }, { status: 400 })
    }

    // Validate supplier data
    const validatedSuppliers: ValidatedSupplier[] = suppliers.map((supplier, index: number) => {
      if (!supplier.name || typeof supplier.name !== 'string') {
        throw new Error(`Supplier at index ${index} must have a name`)
      }
      
      return {
        name: supplier.name.trim(),
        contact_person: supplier.contact_person?.trim() || null,
        email: supplier.email?.trim() || null,
        phone: supplier.phone?.trim() || null,
        address: supplier.address?.trim() || null,
        payment_terms: supplier.payment_terms?.trim() || null,
        notes: supplier.notes?.trim() || null,
        is_active: supplier.is_active !== undefined ? Boolean(supplier.is_active) : true
      }
    })

    // Check for duplicate names within the upload
    const supplierNames = validatedSuppliers.map(s => s.name)
    const duplicateNames = supplierNames.filter((name, index) => supplierNames.indexOf(name) !== index)
    if (duplicateNames.length > 0) {
      return NextResponse.json({ 
        error: 'Duplicate supplier names found', 
        duplicates: [...new Set(duplicateNames)]
      }, { status: 400 })
    }

    const result = { created: 0, updated: 0, errors: [] as string[] }

    // If replace existing, clear all current suppliers first
    if (replaceExisting) {
      const { error: deleteError } = await supabase
        .from('suppliers')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all
        
      if (deleteError) {
        return NextResponse.json({ 
          error: 'Failed to clear existing suppliers',
          details: deleteError.message 
        }, { status: 500 })
      }
    }

    // Process each supplier
    for (const supplier of validatedSuppliers) {
      try {
        if (replaceExisting) {
          // Insert new supplier
          const { error: insertError } = await supabase
            .from('suppliers')
            .insert([supplier])
            
          if (insertError) {
            result.errors.push(`Failed to create ${supplier.name}: ${insertError.message}`)
          } else {
            result.created++
          }
        } else {
          // Try to update existing, or insert if not exists
          const { data: existing } = await supabase
            .from('suppliers')
            .select('id')
            .eq('name', supplier.name)
            .single()

          if (existing) {
            const { error: updateError } = await supabase
              .from('suppliers')
              .update(supplier)
              .eq('id', existing.id)
              
            if (updateError) {
              result.errors.push(`Failed to update ${supplier.name}: ${updateError.message}`)
            } else {
              result.updated++
            }
          } else {
            const { error: insertError } = await supabase
              .from('suppliers')
              .insert([supplier])
              
            if (insertError) {
              result.errors.push(`Failed to create ${supplier.name}: ${insertError.message}`)
            } else {
              result.created++
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        result.errors.push(`Error processing ${supplier.name}: ${message}`)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Bulk upload completed. Created: ${result.created}, Updated: ${result.updated}`,
      result
    })

  } catch (error) {
    console.error('Bulk upload error:', error)
    return NextResponse.json({
      error: 'Failed to process bulk upload',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
