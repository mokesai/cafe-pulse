import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface InvoiceUpdateRequestBody {
  invoice_number?: string
  invoice_date?: string
  due_date?: string
  total_amount?: number
  status?: string
  parsed_data?: Record<string, unknown> | null
  parsing_confidence?: number | null
  parsing_error?: string | null
}

interface InvoiceUpdatePayload extends InvoiceUpdateRequestBody {
  processed_at?: string
  processed_by?: string
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const resolvedParams = await context.params
    const { id } = resolvedParams
    const supabase = await createCurrentTenantClient()

    // Get invoice with related data
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        total_amount,
        status,
        file_url,
        file_path,
        file_name,
        file_type,
        file_size,
        raw_text,
        clean_text,
        text_analysis,
        parsed_data,
        parsing_confidence,
        parsing_error,
        created_at,
        updated_at,
        processed_at,
        suppliers (
          id,
          name,
          contact_person,
          email
        ),
        invoice_items (
          id,
          line_number,
          item_description,
          supplier_item_code,
          quantity,
          unit_price,
          total_price,
          package_size,
          unit_type,
          units_per_package,
          matched_item_id,
          match_confidence,
          match_method,
          is_reviewed,
          review_notes,
          inventory_items (
            id,
            item_name,
            current_stock,
            unit_cost
          )
        ),
        order_invoice_matches (
          id,
          match_confidence,
          match_method,
          status,
          quantity_variance,
          amount_variance,
          variance_notes,
          review_notes,
          purchase_orders (
            id,
            order_number,
            status,
            order_date,
            expected_delivery_date,
            total_amount
          )
        )
      `)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Invoice not found' },
          { status: 404 }
        )
      }
      console.error('Error fetching invoice:', error)
      return NextResponse.json(
        { error: 'Failed to fetch invoice', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: invoice
    })

  } catch (error) {
    console.error('Failed to fetch invoice:', error)
    return NextResponse.json(
      { error: 'Failed to fetch invoice', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const adminAuth = authResult

    const resolvedParams = await context.params
    const { id } = resolvedParams
    const body: InvoiceUpdateRequestBody = await request.json()
    const {
      invoice_number,
      invoice_date,
      due_date,
      total_amount,
      status,
      parsed_data,
      parsing_confidence,
      parsing_error
    } = body

    const supabase = await createCurrentTenantClient()

    // Update invoice
    const updateData: InvoiceUpdatePayload = {}
    if (invoice_number !== undefined) updateData.invoice_number = invoice_number
    if (invoice_date !== undefined) updateData.invoice_date = invoice_date
    if (due_date !== undefined) updateData.due_date = due_date
    if (total_amount !== undefined) updateData.total_amount = total_amount
    if (status !== undefined) updateData.status = status
    if (parsed_data !== undefined) updateData.parsed_data = parsed_data
    if (parsing_confidence !== undefined) updateData.parsing_confidence = parsing_confidence
    if (parsing_error !== undefined) updateData.parsing_error = parsing_error

    // Add processing metadata if status is being updated
    if (status && ['parsed', 'matched', 'confirmed'].includes(status)) {
      updateData.processed_at = new Date().toISOString()
      updateData.processed_by = adminAuth.userId
    }

    const { data: updatedInvoice, error } = await supabase
      .from('invoices')
      .update(updateData)
      .eq('id', id)
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        total_amount,
        status,
        parsing_confidence,
        updated_at,
        suppliers (
          id,
          name
        )
      `)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Invoice not found' },
          { status: 404 }
        )
      }
      console.error('Error updating invoice:', error)
      return NextResponse.json(
        { error: 'Failed to update invoice', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Successfully updated invoice:', updatedInvoice.invoice_number)

    return NextResponse.json({
      success: true,
      data: updatedInvoice,
      message: 'Invoice updated successfully'
    })

  } catch (error) {
    console.error('Failed to update invoice:', error)
    return NextResponse.json(
      { error: 'Failed to update invoice', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const resolvedParams = await context.params
    const { id } = resolvedParams
    const supabase = await createCurrentTenantClient()

    // Check if invoice exists and get file info for cleanup
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('id, invoice_number, file_url')
      .eq('id', id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Invoice not found' },
          { status: 404 }
        )
      }
      console.error('Error fetching invoice for deletion:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch invoice', details: fetchError.message },
        { status: 500 }
      )
    }

    // Delete invoice (cascade will handle related records)
    const { error: deleteError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting invoice:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete invoice', details: deleteError.message },
        { status: 500 }
      )
    }

    // TODO: Clean up file from storage if needed
    // if (invoice.file_url) {
    //   // Delete file from Supabase Storage
    // }

    console.log('✅ Successfully deleted invoice:', invoice.invoice_number)

    return NextResponse.json({
      success: true,
      message: 'Invoice deleted successfully'
    })

  } catch (error) {
    console.error('Failed to delete invoice:', error)
    return NextResponse.json(
      { error: 'Failed to delete invoice', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
