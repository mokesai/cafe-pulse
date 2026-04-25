/**
 * Stage 01 — Invoice Extraction (MOK-110: Vision-first)
 *
 * Order of operations for both PDFs and images:
 *   1. Call OpenRouter Vision (file-parser plugin auto-rasterizes PDFs for
 *      non-native models). This is the PRIMARY path.
 *   2. If Vision throws OR returns 0 line items, AND the file is a PDF,
 *      fall back to text extraction via Next.js
 *      /api/admin/invoices/[id]/extract-text → AI text parse.
 *   3. If both fail (or it's an image with no Vision output), raise a
 *      parse_error exception.
 *
 * Previously (pre-MOK-110), PDFs went through pdf2json first and only
 * reached Vision if a confidence threshold was met — meaning Vision was
 * effectively never invoked for image-based or low-OCR PDFs. That gate is
 * removed: Vision always runs first.
 *
 * Architecture: §3.2, §3.3, §2.7
 * Runtime: Deno (Supabase Edge Function)
 */

import type { PipelineContext } from '../context.ts'
import type { StageResult } from '../orchestrator.ts'
import { createException, sanitizeError } from '../exceptions.ts'
import {
  extractInvoiceWithVision,
  withRetry,
  logVisionTokenUsage,
  fetchExtractedText,
  parseInvoiceTextWithAI,
} from '../vision-service.ts'

const STAGE = 'extracting'

export async function runExtraction(ctx: PipelineContext): Promise<StageResult> {
  console.log(JSON.stringify({
    event: 'stage_start',
    stage: STAGE,
    invoice_id: ctx.invoiceId,
    tenant_id: ctx.tenantId,
    file_type: ctx.invoice.file_type,
    file_url: ctx.invoice.file_url,
  }))

  const { file_url, file_type } = ctx.invoice
  // Normalize file type: handle both extensions (.pdf) and MIME types (application/pdf)
  const fileTypeLower = file_type
    .toLowerCase()
    .replace('application/', '')  // Strip MIME type prefix
    .replace('image/', '')         // Strip image/ prefix
    .replace('.', '')              // Strip dot prefix

  try {
    // ── Idempotency: clear any existing invoice_items for this invoice ────────
    // This ensures retries don't create duplicate line items
    const { error: deleteError } = await ctx.supabase
      .from('invoice_items')
      .delete()
      .eq('invoice_id', ctx.invoiceId)
      .eq('tenant_id', ctx.tenantId)

    if (deleteError) {
      console.warn('[01-extract] Failed to clear existing invoice_items:', deleteError.message)
      // Non-fatal — continue anyway
    }

    // ── Vision-first extraction (MOK-110) ─────────────────────────────────────
    // PDFs and images both go through Vision via OpenRouter. Vision-service
    // routes PDFs through OpenRouter's file-parser plugin so any model can
    // process them. pdf2json+text remains as a last-resort fallback inside
    // runVisionExtraction if Vision fails or returns an empty result.
    return await runVisionExtraction(ctx, file_url, fileTypeLower, false)
  } catch (err) {
    // Unhandled extraction error
    const errorMessage = sanitizeError(err)
    console.error('[01-extract] Unhandled extraction error:', errorMessage)

    await createException(ctx, {
      type: 'parse_error',
      message: `Invoice extraction failed: ${errorMessage}`,
      context: {
        stage: STAGE,
        error_message: errorMessage,
        retry_count: 0,
        fallback_attempted: false,
      },
      pipelineStage: STAGE,
    })

    return { ok: false, fatal: true, error: errorMessage }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vision extraction path
// ─────────────────────────────────────────────────────────────────────────────

async function runVisionExtraction(
  ctx: PipelineContext,
  fileUrl: string,
  fileType: string,
  isFallback: boolean
): Promise<StageResult> {
  let retryCount = 0

  try {
    const output = await withRetry(
      () => {
        retryCount++
        return extractInvoiceWithVision({
          fileUrl,
          fileType,
          supplierName: undefined, // no supplier hint yet at Stage 1
        })
      },
      2,
      5000
    )

    logVisionTokenUsage(ctx.invoiceId, ctx.tenantId, output.tokenUsage)

    const { parsed } = output

    console.log(JSON.stringify({
      event: 'vision_extraction_complete',
      invoice_id: ctx.invoiceId,
      overall_confidence: parsed.overall_confidence,
      line_item_count: parsed.line_items.length,
      extraction_method: isFallback ? 'vision_fallback' : 'vision',
    }))

    // Structural validation: model self-confidence is unreliable (MOK-110 spike
    // showed gpt-4o-mini reporting overall_confidence=1.0 on extractions that
    // returned 0 line items). If Vision returns no line items but we have a
    // text-extraction path available, fall back to it before accepting the result.
    if (parsed.line_items.length === 0 && fileType === 'pdf') {
      console.warn('[01-extract] Vision returned 0 line items for PDF — attempting text fallback')
      throw new Error('Vision returned 0 line items')
    }

    // Store parsed data in context
    ctx.parsedData = {
      ...parsed,
      extraction_method: isFallback ? 'text_fallback' : 'vision',
    }
    ctx.invoice.extractionFallbackUsed = isFallback

    // Save extracted data to DB
    return await saveExtractedData(ctx, parsed.overall_confidence)
  } catch (visionErr) {
    const errorMessage = sanitizeError(visionErr)
    console.error('[01-extract] Vision extraction failed after retries:', errorMessage)

    // For non-image files, we can attempt text extraction as last resort
    if (fileType !== 'pdf') {
      // Image files with no text extraction possible — fatal
      await createException(ctx, {
        type: 'parse_error',
        message: `Vision extraction failed for ${fileType.toUpperCase()} file: ${errorMessage}`,
        context: {
          stage: STAGE,
          error_message: errorMessage,
          retry_count: retryCount,
          fallback_attempted: false,
        },
        pipelineStage: STAGE,
      })
      return { ok: false, fatal: true, error: errorMessage }
    }

    // PDF: try text extraction as last resort
    try {
      const textResult = await fetchExtractedText(ctx.invoiceId, ctx.tenantId)
      if (textResult.text.length > 100) {
        console.log('[01-extract] Vision failed, falling back to text extraction')
        ctx.invoice.extractionFallbackUsed = true
        return await runTextBasedExtraction(ctx, textResult.text, textResult.confidence)
      }
    } catch (textErr) {
      console.warn('[01-extract] Text fallback also failed:', sanitizeError(textErr))
    }

    // Both failed — create exception and halt
    await createException(ctx, {
      type: 'parse_error',
      message: `Invoice extraction failed (Vision + text fallback both failed): ${errorMessage}`,
      context: {
        stage: STAGE,
        error_message: errorMessage,
        retry_count: retryCount,
        fallback_attempted: true,
      },
      pipelineStage: STAGE,
    })

    return { ok: false, fatal: true, error: errorMessage }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text-based extraction path
// ─────────────────────────────────────────────────────────────────────────────

async function runTextBasedExtraction(
  ctx: PipelineContext,
  text: string,
  textConfidence: number
): Promise<StageResult> {
  try {
    const parsed = await parseInvoiceTextWithAI(text)
    // Use the text extraction confidence as a floor if AI returns higher
    const effectiveConfidence = Math.min(
      parsed.overall_confidence,
      Math.max(textConfidence, parsed.overall_confidence)
    )

    ctx.parsedData = {
      ...parsed,
      overall_confidence: effectiveConfidence,
      extraction_method: 'text_fallback',
    }
    ctx.invoice.extractionFallbackUsed = true

    console.log(JSON.stringify({
      event: 'text_extraction_complete',
      invoice_id: ctx.invoiceId,
      overall_confidence: effectiveConfidence,
      line_item_count: parsed.line_items.length,
    }))

    return await saveExtractedData(ctx, effectiveConfidence)
  } catch (err) {
    const errorMessage = sanitizeError(err)
    await createException(ctx, {
      type: 'parse_error',
      message: `Text-based extraction failed: ${errorMessage}`,
      context: {
        stage: STAGE,
        error_message: errorMessage,
        retry_count: 1,
        fallback_attempted: true,
      },
      pipelineStage: STAGE,
    })
    return { ok: false, fatal: true, error: errorMessage }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Save extracted data to DB
// ─────────────────────────────────────────────────────────────────────────────

async function saveExtractedData(
  ctx: PipelineContext,
  overallConfidence: number
): Promise<StageResult> {
  const parsed = ctx.parsedData!

  // ── Update invoice header ────────────────────────────────────────────────
  // Include supplier fees if the AI extracted any; mark fee_source accordingly
  const hasFees = parsed.total_fees > 0
  const { error: invoiceUpdateError } = await ctx.supabase
    .from('invoices')
    .update({
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date,
      total_amount: parsed.total_amount,
      vision_confidence: overallConfidence,
      pipeline_stage: STAGE,
      ...(hasFees && {
        supplier_fees: parsed.supplier_fees,
        total_fees: parsed.total_fees,
        fee_source: 'ai_extracted',
      }),
    })
    .eq('id', ctx.invoiceId)
    .eq('tenant_id', ctx.tenantId)

  if (invoiceUpdateError) {
    console.error('[01-extract] Failed to update invoice header:', invoiceUpdateError.message)
    return { ok: false, fatal: true, error: invoiceUpdateError.message }
  }

  // ── Insert invoice_items ─────────────────────────────────────────────────
  if (parsed.line_items.length > 0) {
    const itemsToInsert = parsed.line_items.map((item) => ({
      invoice_id: ctx.invoiceId,
      tenant_id: ctx.tenantId,
      line_number: item.line_number,
      item_description: item.description,
      supplier_item_code: item.supplier_item_code,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      package_size: item.package_size,
      unit_type: item.unit_type,
      units_per_package: 1, // default; updated in Stage 4 if package_size is set
      vision_item_confidence: item.confidence,
      is_reviewed: false,
    }))

    const { error: insertError } = await ctx.supabase
      .from('invoice_items')
      .insert(itemsToInsert)

    if (insertError) {
      console.error('[01-extract] Failed to insert invoice_items:', insertError.message)
      return { ok: false, fatal: true, error: insertError.message }
    }
  }

  // ── Check confidence threshold for low_extraction_confidence exception ───
  const visionThreshold = ctx.tenantSettings.visionConfidenceThresholdPct / 100
  if (overallConfidence < visionThreshold) {
    // Flag-count the low-confidence items
    const flaggedItemCount = parsed.line_items.filter(
      (item) => item.confidence < visionThreshold
    ).length

    await createException(ctx, {
      type: 'low_extraction_confidence',
      message: `Invoice extraction confidence ${(overallConfidence * 100).toFixed(0)}% is below the ${ctx.tenantSettings.visionConfidenceThresholdPct}% threshold. Please review the extracted data.`,
      context: {
        overall_confidence: overallConfidence,
        threshold: visionThreshold,
        per_field_confidence: {
          invoice_number: parsed.invoice_number ? 0.9 : 0.1,
          invoice_date: parsed.invoice_date ? 0.9 : 0.1,
          supplier_name: parsed.supplier_info.name ? 0.8 : 0.1,
          total_amount: parsed.total_amount ? 0.9 : 0.1,
        },
        flagged_item_count: flaggedItemCount,
        file_url: ctx.invoice.file_url,
      },
      pipelineStage: STAGE,
    })

    // AC-02: Low confidence stops the pipeline — do not proceed to downstream stages.
    // Set status to pending_exceptions so the exception queue shows this invoice.
    await ctx.supabase
      .from('invoices')
      .update({ status: 'pending_exceptions', pipeline_stage: STAGE })
      .eq('id', ctx.invoiceId)
      .eq('tenant_id', ctx.tenantId)

    console.log(JSON.stringify({
      event: 'low_extraction_confidence_halt',
      invoice_id: ctx.invoiceId,
      overall_confidence: overallConfidence,
      threshold: visionThreshold,
      flagged_item_count: flaggedItemCount,
    }))

    // Return ok:false with fatal:false — creates exception but signals orchestrator to stop.
    return { ok: false, fatal: false, error: 'Low extraction confidence — pipeline halted pending human review' }
  }

  // ── Check for duplicate invoice ──────────────────────────────────────────
  if (parsed.invoice_number) {
    const { data: existingInvoice } = await ctx.supabase
      .from('invoices')
      .select('id, invoice_number, total_amount, updated_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('invoice_number', parsed.invoice_number)
      .eq('status', 'confirmed')
      .neq('id', ctx.invoiceId)
      .maybeSingle()

    if (existingInvoice) {
      await createException(ctx, {
        type: 'duplicate_invoice',
        message: `Invoice number ${parsed.invoice_number} was already confirmed. Please review to determine if this is a re-submission or a different invoice.`,
        context: {
          existing_invoice_id: existingInvoice.id,
          existing_invoice_number: existingInvoice.invoice_number,
          existing_confirmed_at: existingInvoice.updated_at,
          existing_total_amount: existingInvoice.total_amount ?? 0,
          new_total_amount: parsed.total_amount ?? 0,
        },
        pipelineStage: STAGE,
      })

      // Mark invoice as duplicate
      await ctx.supabase
        .from('invoices')
        .update({ status: 'duplicate', pipeline_stage: 'failed' })
        .eq('id', ctx.invoiceId)
        .eq('tenant_id', ctx.tenantId)

      return { ok: false, fatal: true, error: 'Duplicate invoice detected' }
    }
  }

  console.log(JSON.stringify({
    event: 'stage_complete',
    stage: STAGE,
    invoice_id: ctx.invoiceId,
    line_items_saved: parsed.line_items.length,
    overall_confidence: overallConfidence,
  }))

  return { ok: true }
}
