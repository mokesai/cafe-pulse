import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

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
    const purchase_order_id = formData.get('purchase_order_id') as string

    if (!file) {
      return apiError('No file was provided. Please attach a PDF or image of the invoice.')
    }

    if (!invoice_number || !invoice_date) {
      return apiError('Invoice number and invoice date are required to upload an invoice.')
    }

    // MOK-120: invoices must be uploaded against an existing PO. The PO link
    // anchors the entire downstream pipeline (matching, variance checks,
    // confirmation). Standalone uploads are no longer supported.
    if (!purchase_order_id) {
      return apiError(
        'A purchase order is required to upload an invoice. ' +
        'Open the PO and use the "Upload Invoice" action.',
        400,
        'PURCHASE_ORDER_REQUIRED',
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return apiError(
        `The uploaded file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). ` +
        `Maximum allowed size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`
      )
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return apiError(
        `Unsupported file type "${file.type}". ` +
        `Please upload a PDF, PNG, JPEG, or WebP file.`
      )
    }

    // Validate file extension
    const fileName = file.name.toLowerCase()
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))
    if (!hasValidExtension) {
      return apiError(
        `Unsupported file extension. ` +
        `Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}.`
      )
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // MOK-120: validate the PO exists for this tenant, and (if a supplier is
    // provided on the invoice) that suppliers match. Done before file upload
    // so we don't waste storage on rejected requests.
    const { data: purchaseOrder, error: poFetchError } = await supabase
      .from('purchase_orders')
      .select('id, supplier_id, tenant_id')
      .eq('id', purchase_order_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (poFetchError) {
      console.error('Error looking up purchase order:', poFetchError)
      return apiError(
        'Failed to verify the purchase order. Please try again.',
        500,
        'PURCHASE_ORDER_LOOKUP_FAILED',
      )
    }

    if (!purchaseOrder) {
      return apiError(
        'The selected purchase order was not found.',
        404,
        'PURCHASE_ORDER_NOT_FOUND',
      )
    }

    if (
      supplier_id &&
      purchaseOrder.supplier_id &&
      supplier_id !== purchaseOrder.supplier_id
    ) {
      return apiError(
        'The invoice supplier does not match the purchase order supplier.',
        400,
        'SUPPLIER_MISMATCH',
      )
    }

    // MOK-115: detect a prior invoice for this PO. The user-supplied
    // invoice_number is NOT a stable lookup key — stage 1 extraction overwrites
    // it with the real number from the PDF, so a re-upload via the PO modal
    // (which auto-fills `${PO_number}-N`) misses the prior row by the time the
    // user retries. The PO link, by contrast, is stable for the invoice's
    // entire lifecycle.
    //
    // Policy:
    //   - Confirmed prior → 409, the row is immutable
    //   - Non-confirmed prior → re-upload target (DELETE+INSERT below, MOK-109)
    //   - No PO-link prior → fall back to (supplier_id, invoice_number),
    //     covering orphans / non-PO-modal paths
    //
    // Caveat: a PO can legitimately accumulate sibling invoices (partial
    // deliveries). We assume the prior must be confirmed before a sibling
    // arrives — any non-confirmed prior is treated as the re-upload target.
    // In practice partial-delivery flows wait on confirmation anyway, and an
    // accidental clobber here is recoverable (the original PDF is in storage).
    let existingInvoice: {
      id: string
      status: string
      file_path: string | null
    } | null = null

    const { data: priorPoMatches } = await supabase
      .from('order_invoice_matches')
      .select('invoice_id')
      .eq('tenant_id', tenantId)
      .eq('purchase_order_id', purchaseOrder.id)

    if (priorPoMatches && priorPoMatches.length > 0) {
      const priorInvoiceIds = priorPoMatches.map((m) => m.invoice_id)
      const { data: priorInvoices } = await supabase
        .from('invoices')
        .select('id, status, file_path, invoice_number')
        .eq('tenant_id', tenantId)
        .in('id', priorInvoiceIds)

      const confirmedPrior = (priorInvoices ?? []).find(
        (inv) => inv.status === 'confirmed',
      )
      if (confirmedPrior) {
        return apiError(
          `Invoice "${confirmedPrior.invoice_number}" for this purchase order has already been ` +
            'confirmed and cannot be replaced. Contact support if you need to add another invoice.',
          409,
          'INVOICE_ALREADY_CONFIRMED',
        )
      }

      const replacementCandidate = (priorInvoices ?? []).find(
        (inv) => inv.status !== 'confirmed',
      )
      if (replacementCandidate) {
        existingInvoice = {
          id: replacementCandidate.id,
          status: replacementCandidate.status,
          file_path: replacementCandidate.file_path,
        }
      }
    }

    // Fallback: legacy (supplier_id, invoice_number) lookup. Covers cases
    // where the PO link is missing (data from before MOK-120) or the user
    // typed an invoice_number that already exists under a different PO.
    if (!existingInvoice && supplier_id) {
      const { data } = await supabase
        .from('invoices')
        .select('id, status, file_path')
        .eq('tenant_id', tenantId)
        .eq('supplier_id', supplier_id)
        .eq('invoice_number', invoice_number)
        .maybeSingle()

      if (data) {
        existingInvoice = data
        if (data.status === 'confirmed') {
          return apiError(
            `Invoice "${invoice_number}" has already been confirmed for this supplier and cannot be replaced. ` +
              'Use a different invoice number or contact support if this is an error.',
            409,
            'INVOICE_ALREADY_CONFIRMED',
          )
        }
      }
    }

    // MOK-143: same-file fallback. Catches re-upload when the prior invoice
    // has no PO link (pre-MOK-120 data) AND the user-supplied invoice_number
    // doesn't match the prior (e.g. the upload form auto-fills a synthetic
    // ${PO}-N placeholder while the prior was named after the parsed value).
    // Match on (supplier_id, file_name, status != confirmed) — the user
    // picking the same PDF a second time is the dominant repro.
    if (!existingInvoice && supplier_id && file.name) {
      const { data } = await supabase
        .from('invoices')
        .select('id, status, file_path')
        .eq('tenant_id', tenantId)
        .eq('supplier_id', supplier_id)
        .eq('file_name', file.name)
        .neq('status', 'confirmed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data) {
        existingInvoice = data
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
      return apiError(
        'Failed to upload the invoice file to storage. Please try again. ' +
        'If the problem persists, check your file and contact support.',
        500,
        'STORAGE_UPLOAD_FAILED'
      )
    }

    // Generate a signed URL with 24-hour expiry
    // This allows secure access without making the bucket public
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('invoices')
      .createSignedUrl(uniqueFileName, 86400) // 24 hours in seconds

    if (signedUrlError || !signedUrlData) {
      console.error('Error generating signed URL:', signedUrlError)
      return apiError(
        'The file was uploaded but a secure access URL could not be generated. Please try uploading again.',
        500,
        'SIGNED_URL_FAILED'
      )
    }

    const file_url = signedUrlData.signedUrl

    // MOK-109: re-upload removes the prior invoice and inserts a fresh row.
    // Single INSERT path covers both first-upload and re-upload — keeps the
    // pipeline trigger surface to AFTER INSERT only. DELETE cascades
    // invoice_items, order_invoice_matches, invoice_import_sessions, and
    // invoice_exceptions; supplier_item_aliases.last_seen_invoice_id is set
    // NULL. Behavior change vs prior UPDATE path: invoice id, created_at, and
    // created_by reflect the latest upload (audit trail intent).
    if (existingInvoice) {
      if (existingInvoice.file_path) {
        await supabase.storage.from('invoices').remove([existingInvoice.file_path])
      }

      const { error: deleteError } = await supabase
        .from('invoices')
        .delete()
        .eq('id', existingInvoice.id)
        .eq('tenant_id', tenantId)

      if (deleteError) {
        console.error('Error deleting prior invoice during re-upload:', deleteError)
        return apiError(
          'Failed to clear the prior invoice during re-upload. Please try again.',
          500,
          'INVOICE_REPLACE_FAILED'
        )
      }
    }

    const { data: insertedInvoice, error: dbError } = await supabase
      .from('invoices')
      .insert({
        tenant_id: tenantId,
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

    const newInvoice = insertedInvoice as UploadedInvoiceRecord | null

    if (dbError) {
      // If database insert fails, clean up uploaded file
      try {
        await supabase.storage
          .from('invoices')
          .remove([uniqueFileName])
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file after DB failure:', cleanupError)
      }

      return formatApiError('save invoice record', dbError)
    }

    if (!newInvoice) {
      throw new Error('Invoice record not returned after upload')
    }

    // MOK-120: create the manual PO link in the same operation as the invoice
    // INSERT. This used to be a separate POST from InvoiceUploadModal, with a
    // race window where the pipeline could fire before the link was in place.
    // The link uses match_method='manual' so stage 3 short-circuits via
    // MOK-117's manual-match check.
    const { error: linkError } = await supabase
      .from('order_invoice_matches')
      .insert({
        tenant_id: tenantId,
        invoice_id: newInvoice.id,
        purchase_order_id: purchaseOrder.id,
        match_method: 'manual',
        match_confidence: 1,
        status: 'pending',
      })

    if (linkError) {
      console.error('Error creating order_invoice_matches link:', linkError)
      // Roll back the invoice so the data layer's invariant holds: every
      // invoice has a PO link.
      await supabase
        .from('invoices')
        .delete()
        .eq('id', newInvoice.id)
        .eq('tenant_id', tenantId)
      try {
        await supabase.storage.from('invoices').remove([uniqueFileName])
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file after link failure:', cleanupError)
      }
      return apiError(
        'Failed to link the invoice to the purchase order. Please try again.',
        500,
        'INVOICE_LINK_FAILED',
      )
    }

    console.log('✅ Successfully uploaded invoice file and created record:', newInvoice.invoice_number)

    return NextResponse.json({
      success: true,
      data: newInvoice,
      message: 'Invoice uploaded successfully'
    }, { status: 201 })

  } catch (error) {
    return unexpectedError('upload invoice', error)
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
