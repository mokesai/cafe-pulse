import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'
import type { PostgrestError } from '@supabase/supabase-js'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp']

interface UploadedInvoiceRecord {
  id: string
  invoice_number: string
  invoice_date: string
  total_amount: number
  status: string
  file_name: string | null
  file_type: string | null
  file_size: number | null
  file_url: string | null
  created_at: string
  suppliers: {
    id: string
    name: string | null
  } | null
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const adminAuth = authResult

    const formData = await request.formData()
    const file = formData.get('file') as File
    const supplier_id = formData.get('supplier_id') as string
    const invoice_number = formData.get('invoice_number') as string
    const invoice_date = formData.get('invoice_date') as string

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    if (!invoice_number || !invoice_date) {
      return NextResponse.json(
        { error: 'Missing required fields: invoice_number, invoice_date' },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate file extension
    const fileName = file.name.toLowerCase()
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))
    if (!hasValidExtension) {
      return NextResponse.json(
        { error: `Invalid file extension. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}` },
        { status: 400 }
      )
    }

    const supabase = await createCurrentTenantClient()

    // Check for duplicate invoice (only if supplier_id is provided)
    let existingInvoice: {
      id: string
      status: string
      file_path: string | null
    } | null = null

    if (supplier_id) {
      const { data } = await supabase
        .from('invoices')
        .select('id, status, file_path')
        .eq('supplier_id', supplier_id)
        .eq('invoice_number', invoice_number)
        .maybeSingle()

      if (data) {
        existingInvoice = data
        if (data.status === 'confirmed') {
          return NextResponse.json(
            { error: 'Invoice with this number already exists for this supplier' },
            { status: 409 }
          )
        }
      }
    }


    // Generate unique file name
    const fileExtension = fileName.split('.').pop()
    const timestamp = new Date().getTime()
    const supplierFolder = supplier_id || 'unknown'
    const uniqueFileName = `${supplierFolder}/${invoice_number.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.${fileExtension}`

    console.log('Uploading file:', uniqueFileName, 'size:', file.size)

    // Convert file to buffer
    const buffer = await file.arrayBuffer()
    const fileBuffer = new Uint8Array(buffer)

    // Upload file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(uniqueFileName, fileBuffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false
      })

    if (uploadError) {
      console.error('Error uploading file:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload file', details: uploadError.message },
        { status: 500 }
      )
    }

    // Get public URL for the uploaded file
    const { data: urlData } = supabase.storage
      .from('invoices')
      .getPublicUrl(uniqueFileName)

    const file_url = urlData.publicUrl

    // When an invoice already exists (non-confirmed), replace it in-place; otherwise insert.
    let newInvoice: UploadedInvoiceRecord | null = null
    let dbError: PostgrestError | null = null

    if (existingInvoice) {
      // Remove any previous file so we do not leave stale blobs around
      if (existingInvoice.file_path) {
        await supabase.storage.from('invoices').remove([existingInvoice.file_path])
      }

      // Clear matches and items so the new upload starts clean
      const { error: deleteMatchesError } = await supabase
        .from('order_invoice_matches')
        .delete()
        .eq('invoice_id', existingInvoice.id)

      if (deleteMatchesError) {
        console.error('Error clearing invoice matches before replacement:', deleteMatchesError)
      }

      // Reset invoice content so it can be re-parsed cleanly
      const { error: deleteItemsError } = await supabase
        .from('invoice_items')
        .delete()
        .eq('invoice_id', existingInvoice.id)

      if (deleteItemsError) {
        console.error('Error clearing invoice items before replacement:', deleteItemsError)
      }

      const { data, error } = await supabase
        .from('invoices')
        .update({
          invoice_number,
          supplier_id: supplier_id || null,
          invoice_date,
          total_amount: 0,
          file_url,
          file_path: uniqueFileName,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          status: 'uploaded',
          raw_text: null,
          clean_text: null,
          text_analysis: {},
          parsed_data: null,
          parsing_confidence: null,
          parsing_error: null,
          processed_at: null,
          processed_by: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingInvoice.id)
        .select(`
          id,
          invoice_number,
          invoice_date,
          total_amount,
          status,
          file_name,
          file_type,
          file_size,
          file_url,
          created_at,
          suppliers (
            id,
            name
          )
        `)
        .single()

      newInvoice = data as UploadedInvoiceRecord | null
      dbError = error
    } else {
      const { data, error } = await supabase
        .from('invoices')
        .insert({
          supplier_id: supplier_id || null,
          invoice_number,
          invoice_date,
          total_amount: 0, // Will be updated after parsing
          file_url,
          file_path: uniqueFileName,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          status: 'uploaded',
          created_by: adminAuth.userId
        })
        .select(`
          id,
          invoice_number,
          invoice_date,
          total_amount,
          status,
          file_name,
          file_type,
          file_size,
          file_url,
          created_at,
          suppliers (
            id,
            name
          )
        `)
        .single()

      newInvoice = data as UploadedInvoiceRecord | null
      dbError = error
    }

    if (dbError) {
      // If database insert fails, clean up uploaded file
      try {
        await supabase.storage
          .from('invoices')
          .remove([uniqueFileName])
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file:', cleanupError)
      }

      console.error('Error creating invoice record:', dbError)
      return NextResponse.json(
        {
          error: 'Failed to create invoice record',
          details: dbError.message,
          code: dbError.code,
          hint: dbError.hint
        },
        { status: 500 }
      )
    }

    if (!newInvoice) {
      throw new Error('Invoice record not returned after upload')
    }

    console.log('✅ Successfully uploaded invoice file and created record:', newInvoice.invoice_number)

    return NextResponse.json({
      success: true,
      data: newInvoice,
      message: 'Invoice uploaded successfully'
    }, { status: 201 })

  } catch (error) {
    console.error('Failed to upload invoice:', error)
    return NextResponse.json(
      { error: 'Failed to upload invoice', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Handle preflight CORS requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
