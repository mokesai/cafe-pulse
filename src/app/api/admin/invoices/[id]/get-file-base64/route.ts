/**
 * Internal API route to download an invoice file and return it as base64.
 * Called by the invoice-pipeline Edge Function when Vision API needs the file as base64.
 * 
 * Used to avoid OpenRouter Vision API issues downloading from Supabase storage URLs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { addSecurityHeaders } from '@/lib/security/headers'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params
    const tenantId = request.headers.get('X-Tenant-Id')
    const serviceKey = request.headers.get('X-Pipeline-Service-Key')

    // Validate tenant context
    if (!tenantId || !serviceKey) {
      return addSecurityHeaders(
        NextResponse.json(
          { error: 'Missing tenant or service key' },
          { status: 400 }
        )
      )
    }

    // Get invoice with file URL
    const supabase = createServiceClient()
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, file_url, file_type, tenant_id')
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single()

    if (invoiceError || !invoice) {
      return addSecurityHeaders(
        NextResponse.json(
          { error: 'Invoice not found' },
          { status: 404 }
        )
      )
    }

    // Download file from Supabase storage using service role
    // Extract bucket and file path from file_path column
    const filePath = invoice.file_path // e.g., "supplier-id/filename.pdf"
    
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('invoices')
      .download(filePath)

    if (downloadError || !fileData) {
      console.error('[get-file-base64] Download error:', downloadError)
      return addSecurityHeaders(
        NextResponse.json(
          { error: `Failed to download file: ${downloadError?.message ?? 'unknown error'}` },
          { status: 500 }
        )
      )
    }

    const fileBuffer = await fileData.arrayBuffer()
    const fileBase64 = Buffer.from(fileBuffer).toString('base64')

    return addSecurityHeaders(
      NextResponse.json({
        success: true,
        base64: fileBase64,
        mimeType: getMimeType(invoice.file_type),
        fileSize: fileBuffer.byteLength,
      })
    )
  } catch (error) {
    console.error('[get-file-base64] Error:', error)
    return addSecurityHeaders(
      NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    )
  }
}

function getMimeType(fileType: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  }
  const cleaned = fileType.toLowerCase().replace('.', '')
  return map[cleaned] ?? 'application/octet-stream'
}
