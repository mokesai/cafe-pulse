import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { parseInvoiceWithAI } from '@/lib/ai/openai-service'
import { processInvoiceFile, validateInvoiceText } from '@/lib/document/pdf-processor'
import { InvoiceTextAnalysis } from '@/types/invoice'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface SupplierInfoRow {
  id: string
  name: string | null
}

interface SupplierTemplateRow {
  id: string
  format_config: Record<string, unknown> | null
  parsing_rules: Record<string, unknown> | null
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const adminAuth = authResult

    const { id } = await context.params
    if (!process.env.OPENAI_API_KEY) {
      return apiError(
        'AI parsing is not configured on this server. Contact your administrator.',
        500,
        'AI_NOT_CONFIGURED'
      )
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    console.log('🤖 Starting invoice parsing for ID:', id)

    // Get invoice details
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        status,
        file_url,
        file_path,
        file_type,
        supplier_id,
        suppliers (
          id,
          name
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError || !invoice) {
      return apiError(
        'Invoice not found. It may have been deleted — refresh and try again.',
        404,
        'NOT_FOUND'
      )
    }

    // Check if invoice can be parsed
    if (!invoice.file_url) {
      return apiError(
        'This invoice has no file attached and cannot be parsed. Please re-upload the invoice file.',
        400,
        'NO_FILE_ATTACHED'
      )
    }

    if (invoice.status === 'parsing') {
      return apiError(
        'This invoice is already being parsed. Please wait for the current parse to complete.',
        409,
        'PARSE_IN_PROGRESS'
      )
    }

    // Update status to parsing
    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        status: 'parsing',
        processed_by: adminAuth.userId,
        processed_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) {
      return formatApiError('update invoice status before parsing', updateError)
    }

    try {
      // Step 1: Extract text from the document
      console.log('📄 Processing document:', invoice.file_type)
      
      // Extract file path from URL for Supabase storage access
      const filePath = invoice.file_path || undefined

      const documentResult = await processInvoiceFile(
        invoice.file_url, 
        invoice.file_type || 'application/pdf',
        filePath
      )

      if (!documentResult.success || !documentResult.text) {
        const errSummary = documentResult.errors?.join('; ') ?? 'unknown error'
        // Update invoice with error status
        await supabase
          .from('invoices')
          .update({
            status: 'error',
            parsing_error: `Document processing failed: ${errSummary}`
          })
          .eq('id', id)

        return NextResponse.json({
          error:
            'The invoice file could not be read. It may be corrupted, password-protected, or in an unsupported format. ' +
            'Try re-uploading a clear PDF or image.',
          details: documentResult.errors
        }, { status: 400 })
      }

      // Step 2: Validate the extracted text
      const validation = validateInvoiceText(documentResult.text)
      console.log('✅ Text validation result:', validation)

      const textAnalysisPayload: InvoiceTextAnalysis = {
        ...(documentResult.analysis || {}),
        validation_confidence: validation.confidence,
        is_valid: validation.isValid,
        indicators: documentResult.analysis?.indicators || validation.indicators,
        warnings: documentResult.analysis?.warnings || validation.warnings
      }

      const { error: textPersistError } = await supabase
        .from('invoices')
        .update({
          raw_text: documentResult.rawText || documentResult.text,
          clean_text: documentResult.text,
          text_analysis: textAnalysisPayload
        })
        .eq('id', id)

      if (textPersistError) {
        console.error('Failed to persist extraction text:', textPersistError)
      }

      if (!validation.isValid) {
        await supabase
          .from('invoices')
          .update({
            status: 'error',
            parsing_error: `Invalid invoice text: ${validation.warnings.join(', ')}`
          })
          .eq('id', id)

        return NextResponse.json({
          error:
            'The extracted text does not appear to be a valid invoice. ' +
            'Make sure the uploaded file is a supplier invoice, not a receipt or other document.',
          details: validation.warnings
        }, { status: 400 })
      }

      // Step 3: Get supplier-specific template rules if available
      const { data: template } = await supabase
        .from('supplier_invoice_templates')
        .select('id, format_config, parsing_rules')
        .eq('supplier_id', invoice.supplier_id)
        .eq('is_active', true)
        .single()
      const activeTemplate = template as SupplierTemplateRow | null

      // Step 4: Parse with AI
      console.log('🤖 Starting AI parsing with OpenAI...')
      
      const supplierInfo = (invoice.suppliers as SupplierInfoRow[] | null)?.[0]
      const aiResult = await parseInvoiceWithAI({
        text: documentResult.text,
        supplier_name: supplierInfo?.name ?? undefined,
        template_rules: activeTemplate?.parsing_rules ?? {}
      })

      if (!aiResult.success || !aiResult.data) {
        const aiErrSummary = aiResult.errors?.join('; ') ?? 'unknown error'
        await supabase
          .from('invoices')
          .update({
            status: 'error',
            parsing_error: `AI parsing failed: ${aiErrSummary}`
          })
          .eq('id', id)

        return NextResponse.json({
          error:
            'AI parsing could not extract invoice data from this file. ' +
            'The document may be a scan with poor quality, or it may not be a standard invoice format. ' +
            'Try re-uploading a higher-quality file.',
          details: aiResult.errors
        }, { status: 400 })
      }

      // Step 5: Handle supplier creation if needed
      let finalSupplierId = invoice.supplier_id
      
      if (!invoice.supplier_id && aiResult.data.supplier_info && aiResult.data.supplier_info.name) {
        console.log('🏭 Creating new supplier from invoice data:', aiResult.data.supplier_info.name)
        
        // Check if supplier already exists by name
        const { data: existingSupplier } = await supabase
          .from('suppliers')
          .select('id, name')
          .ilike('name', aiResult.data.supplier_info.name)
          .single()
        
        if (existingSupplier) {
          console.log('📋 Found existing supplier:', existingSupplier.name)
          finalSupplierId = existingSupplier.id
        } else {
          // Create new supplier
          const { data: newSupplier, error: supplierError } = await supabase
            .from('suppliers')
            .insert({
              tenant_id: tenantId,
              name: aiResult.data.supplier_info.name,
              contact_person: null,
              email: aiResult.data.supplier_info.email || null,
              phone: aiResult.data.supplier_info.phone || null,
              address: aiResult.data.supplier_info.address || null,
              payment_terms: 'Net 30',
              notes: 'Auto-created from invoice import',
              is_active: true
            })
            .select('id, name')
            .single()
          
          if (supplierError) {
            console.error('Failed to create supplier:', supplierError)
            // Don't fail parsing, just log error
          } else {
            console.log('✅ Created new supplier:', newSupplier.name)
            finalSupplierId = newSupplier.id
          }
        }
      }

      // Step 6: Create purchase order if supplier was created/found
      let purchaseOrderId: string | null = null
      if (finalSupplierId && !invoice.supplier_id) {
        console.log('📦 Creating purchase order for invoice')
        
        const orderTotal = aiResult.data.total_amount || 0
        const { data: newOrder, error: orderError } = await supabase
          .from('purchase_orders')
          .insert({
            tenant_id: tenantId,
            supplier_id: finalSupplierId,
            order_number: `PO-${invoice.invoice_number}`,
            order_date: aiResult.data.invoice_date || new Date().toISOString().split('T')[0],
            expected_delivery_date: null,
            status: 'confirmed', // Mark as confirmed since we have the invoice
            total_amount: orderTotal,
            notes: `Auto-created from invoice ${invoice.invoice_number}`,
            created_by: adminAuth.userId
          })
          .select('id, order_number')
          .single()
        
        if (orderError) {
          console.error('Failed to create purchase order:', orderError)
        } else {
          console.log('✅ Created purchase order:', newOrder.order_number)
          purchaseOrderId = newOrder.id
          
          // Create purchase order items from invoice line items
          if (aiResult.data.line_items && aiResult.data.line_items.length > 0) {
            const orderItems = aiResult.data.line_items.map(item => ({
              purchase_order_id: purchaseOrderId,
              item_description: item.description || 'Unknown Item',
              supplier_item_code: item.item_code || null,
              quantity_ordered: item.quantity || 0,
              unit_cost: item.unit_price || 0,
              total_cost: item.total_price || 0,
              package_size: item.package_info || null,
              unit_type: item.unit_type || 'each',
              status: 'received' // Mark as received since we have the invoice
            }))
            
            const { error: orderItemsError } = await supabase
              .from('purchase_order_items')
              .insert(orderItems)
            
            if (orderItemsError) {
              console.error('Failed to create purchase order items:', orderItemsError)
            } else {
              console.log(`✅ Created ${orderItems.length} purchase order items`)
            }
          }
        }
      }

      // Step 7: Update invoice with parsed data and supplier
      const { error: saveError } = await supabase
        .from('invoices')
        .update({
          status: 'parsed',
          parsed_data: aiResult.data,
          parsing_confidence: aiResult.confidence,
          total_amount: aiResult.data.total_amount || 0,
          supplier_id: finalSupplierId
        })
        .eq('id', id)

      if (saveError) {
        return formatApiError('save invoice parsing results', saveError)
      }

      // Step 8: Create invoice items from parsed line items
      if (aiResult.data.line_items && aiResult.data.line_items.length > 0) {
        const invoiceItems = aiResult.data.line_items.map(item => ({
          invoice_id: id,
          line_number: item.line_number || 0,
          item_description: item.description || 'Unknown Item',
          supplier_item_code: item.item_code || null,
          quantity: item.quantity || 0,
          unit_price: item.unit_price || 0,
          total_price: item.total_price || 0,
          package_size: item.package_info || null,
          unit_type: item.unit_type || 'each',
          match_confidence: item.confidence || 0,
          match_method: 'ai' as const
        }))

        const { error: itemsError } = await supabase
          .from('invoice_items')
          .insert(invoiceItems)

        if (itemsError) {
          console.error('Failed to create invoice items:', itemsError)
          // Don't fail the entire parsing, just log the error
        } else {
          console.log(`✅ Created ${invoiceItems.length} invoice items`)
        }
      }

      // Step 9: Update supplier template success rate if template was used
      if (activeTemplate) {
        try {
          await supabase.rpc('increment_template_usage', {
            template_id: activeTemplate.id,
            success: true
          })
        } catch (err) {
          console.log('Template update failed:', err)
        }
      }

      console.log('✅ Invoice parsing completed successfully')

      // Return the updated invoice with parsed data
      const { data: updatedInvoice } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          status,
          parsing_confidence,
          parsed_data,
          clean_text,
          text_analysis,
          suppliers (name),
          invoice_items (
            id,
            item_description,
            quantity,
            unit_price,
            total_price,
            match_confidence
          )
        `)
        .eq('id', id)
        .single()

      return NextResponse.json({
        success: true,
        data: updatedInvoice,
        parsing_stats: {
          confidence: aiResult.confidence,
          line_items_extracted: aiResult.data.line_items?.length || 0,
          validation_confidence: validation.confidence,
          processing_method: documentResult.metadata?.extractionMethod
        },
        message: 'Invoice parsed successfully'
      })

    } catch (processingError) {
      const processingMsg = processingError instanceof Error ? processingError.message : 'Unknown error'
      console.error('Parsing process error:', processingError)

      // Update invoice with error status
      await supabase
        .from('invoices')
        .update({
          status: 'error',
          parsing_error: `Processing error: ${processingMsg}`
        })
        .eq('id', id)

      return NextResponse.json({
        error:
          'Invoice parsing failed due to an unexpected error. ' +
          'Please try again. If the problem persists, re-upload the invoice file.',
        ...(process.env.NODE_ENV !== 'production' && { details: processingMsg })
      }, { status: 500 })
    }

  } catch (error) {
    return unexpectedError('parse invoice', error)
  }
}
