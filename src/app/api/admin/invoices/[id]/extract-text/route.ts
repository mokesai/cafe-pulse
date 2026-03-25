/**
 * GET /api/admin/invoices/[id]/extract-text
 *
 * Internal utility route for PDF text extraction.
 * Called by the Supabase Edge Function (invoice-pipeline) via fetch()
 * when a native PDF with sufficient text quality is detected.
 *
 * This route uses the existing pdf-processor.ts cascade:
 *   pdf2json → pdfjs-dist → Tesseract OCR
 *
 * Authentication:
 * - Supports both admin session auth (for UI debugging)
 * - AND internal pipeline service key (X-Pipeline-Service-Key header)
 *   for calls from the Supabase Edge Function
 *
 * Note on Walmart Business PDFs:
 * Encrypted/image-only PDFs will return low confidence here.
 * The calling Edge Function will then route to Vision extraction instead.
 *
 * Architecture: §2.1 (OTQ-07), §3.2
 * Runtime: Node.js (Next.js App Router)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { processInvoiceFile, validateInvoiceText } from '@/lib/document/pdf-processor'

interface RouteParams {
  params: Promise<{ id: string }>
}

// ============================================================
// Route handler
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const { id: invoiceId } = await params

  if (!invoiceId) {
    return NextResponse.json(
      { success: false, error: 'Missing invoice ID' },
      { status: 400 }
    )
  }

  // ── Authentication: admin session OR internal pipeline service key ────────
  let tenantId: string | null = null

  const pipelineServiceKey = request.headers.get('X-Pipeline-Service-Key')
  const pipelineTenantId = request.headers.get('X-Tenant-Id')
  const expectedServiceKey = process.env.SUPABASE_SECRET_KEY

  if (pipelineServiceKey && expectedServiceKey) {
    // Internal pipeline call — verify service key
    if (pipelineServiceKey !== expectedServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Invalid service key' },
        { status: 401 }
      )
    }
    tenantId = pipelineTenantId
  } else {
    // Regular admin session auth
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult as NextResponse
    }
    tenantId = authResult.tenantId
  }

  if (!tenantId) {
    return NextResponse.json(
      { success: false, error: 'Missing tenant ID' },
      { status: 400 }
    )
  }

  // ── Load invoice record ───────────────────────────────────────────────────
  const supabase = createServiceClient()

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, file_url, file_path, file_type, status, tenant_id')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (invoiceError || !invoice) {
    return NextResponse.json(
      { success: false, error: 'Invoice not found' },
      { status: 404 }
    )
  }

  // ── Validate file info ────────────────────────────────────────────────────
  if (!invoice.file_url && !invoice.file_path) {
    return NextResponse.json(
      { success: false, error: 'Invoice has no file URL or path' },
      { status: 422 }
    )
  }

  const fileType = invoice.file_type ?? 'application/pdf'

  console.log(
    `[extract-text] Processing invoice ${invoiceId} | type: ${fileType} | url: ${invoice.file_url}`
  )

  // ── Run text extraction ───────────────────────────────────────────────────
  try {
    const result = await processInvoiceFile(
      invoice.file_url ?? '',
      fileType,
      invoice.file_path ?? undefined
    )

    if (!result.success || !result.text) {
      return NextResponse.json({
        success: false,
        error: result.errors?.join('; ') ?? 'Text extraction failed',
        text: '',
        confidence: 0,
        method: 'failed',
      })
    }

    // Validate the extracted text quality
    const validation = validateInvoiceText(result.text)
    const extractionMethod = result.metadata?.extractionMethod ?? 'unknown'

    // Use the OCR confidence if available, otherwise use validation score
    const confidence = result.metadata?.confidence ?? validation.confidence

    console.log(
      `[extract-text] Invoice ${invoiceId}: confidence=${confidence.toFixed(2)} ` +
        `method=${extractionMethod} text_length=${result.text.length}`
    )

    return NextResponse.json({
      success: true,
      text: result.cleanText ?? result.text,
      raw_text: result.rawText,
      confidence,
      method: extractionMethod,
      metadata: {
        pages: result.metadata?.pages ?? 1,
        file_size: result.metadata?.fileSize ?? 0,
        needs_ocr: result.metadata?.needsOcr ?? false,
        validation: {
          is_valid: validation.isValid,
          keyword_matches: validation.keywordMatches,
          price_match_count: validation.priceMatchCount,
          date_match_count: validation.dateMatchCount,
          line_item_match_count: validation.lineItemMatchCount,
        },
      },
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[extract-text] Error for invoice ${invoiceId}:`, errorMessage)

    // Return structured error — Edge Function will fall back to Vision
    return NextResponse.json(
      {
        success: false,
        error: errorMessage.slice(0, 300),
        text: '',
        confidence: 0,
        method: 'error',
      },
      { status: 500 }
    )
  }
}
