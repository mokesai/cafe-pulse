import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import type { ExceptionResolutionAction } from '@/types/invoice-exceptions'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface ResolveRequestBody {
  resolution_notes?: string
  action: ExceptionResolutionAction
}

/**
 * Auto-confirm an invoice when all exceptions are resolved/dismissed.
 * Mirrors the logic in /api/admin/invoices/[id]/confirm, but triggered
 * automatically when the last open exception is cleared.
 * Also distributes any supplier fees to inventory_item_cost_history.
 */
async function tryAutoConfirmInvoice(
  supabase: ReturnType<typeof createServiceClient>,
  invoiceId: string,
  tenantId: string
): Promise<boolean> {
  // Check if there are any remaining open exceptions
  const { count: openCount } = await supabase
    .from('invoice_exceptions')
    .select('*', { count: 'exact', head: true })
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .eq('status', 'open')

  if ((openCount || 0) > 0) {
    return false
  }

  // Check invoice current status — only auto-confirm if it was pending_exceptions
  const { data: invoice } = await supabase
    .from('invoices')
    .select('status, total_fees, fee_cogs_distributed, invoice_number, suppliers(name)')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (!invoice || invoice.status !== 'pending_exceptions') {
    return false
  }

  // Set invoice to confirmed
  const totalFees = Number((invoice as { total_fees?: unknown }).total_fees ?? 0)
  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'confirmed',
      pipeline_stage: 'completed',
      pipeline_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(totalFees > 0 && { fee_cogs_distributed: true }),
    })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)

  if (error) {
    console.error('Auto-confirm failed:', error)
    return false
  }

  // Distribute supplier fees proportionally to cost history (non-fatal)
  if (totalFees > 0 && !(invoice as { fee_cogs_distributed?: unknown }).fee_cogs_distributed) {
    try {
      await distributeFeesToCostHistory(supabase, invoiceId, tenantId, totalFees, invoice)
    } catch (feeErr) {
      console.error('[auto-confirm] Fee distribution failed (non-fatal):', feeErr)
    }
  }

  console.log(`✅ Auto-confirmed invoice ${invoiceId} after last exception resolved`)
  return true
}

/**
 * Proportionally allocate invoice supplier fees across matched line items.
 * Records each allocation as an `invoice_fee` entry in inventory_item_cost_history.
 */
async function distributeFeesToCostHistory(
  supabase: ReturnType<typeof createServiceClient>,
  invoiceId: string,
  tenantId: string,
  totalFees: number,
  invoiceMeta: { invoice_number?: string; suppliers?: { name?: string } | null }
): Promise<void> {
  const { data: matchedItems } = await supabase
    .from('invoice_items')
    .select('id, matched_item_id, quantity, total_price')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .not('matched_item_id', 'is', null)

  if (!matchedItems || matchedItems.length === 0) return

  type MatchedItem = { id: string; matched_item_id: string; quantity: unknown; total_price: unknown }

  const totalMatchedValue = (matchedItems as MatchedItem[]).reduce(
    (sum, item) => sum + Math.max(0, Number(item.total_price ?? 0)),
    0
  )
  if (totalMatchedValue <= 0) return

  const historyRows: Record<string, unknown>[] = []
  const invoiceNumber = invoiceMeta.invoice_number ?? invoiceId
  const supplierName = (invoiceMeta.suppliers as { name?: string } | null)?.name ?? 'Unknown Supplier'

  for (const item of matchedItems as MatchedItem[]) {
    if (!item.matched_item_id) continue
    const itemValue = Math.max(0, Number(item.total_price ?? 0))
    const feeShare = Math.round(((itemValue / totalMatchedValue) * totalFees) * 10000) / 10000
    if (feeShare <= 0) continue

    const { data: invRow } = await supabase
      .from('inventory_items')
      .select('unit_cost')
      .eq('id', item.matched_item_id)
      .eq('tenant_id', tenantId)
      .single()

    const currentCost = Number((invRow as { unit_cost?: unknown } | null)?.unit_cost ?? 0)
    const qty = Math.max(1, Number(item.quantity ?? 1))
    const feePerUnit = Math.round((feeShare / qty) * 10000) / 10000
    if (feePerUnit <= 0) continue

    historyRows.push({
      tenant_id: tenantId,
      inventory_item_id: item.matched_item_id,
      previous_unit_cost: currentCost,
      new_unit_cost: Math.round((currentCost + feePerUnit) * 10000) / 10000,
      pack_size: 1,
      source: 'invoice_fee',
      source_ref: invoiceId,
      notes: `Fee allocation from Invoice ${invoiceNumber} (${supplierName}): $${feeShare.toFixed(4)} of $${totalFees.toFixed(2)} total fees`,
      changed_by: null,
      fee_amount: feeShare,
    })
  }

  if (historyRows.length > 0) {
    const { error } = await supabase
      .from('inventory_item_cost_history')
      .insert(historyRows)
    if (error) {
      console.error('[auto-confirm] Failed to insert fee history rows:', error)
    } else {
      console.log(`✅ [auto-confirm] Distributed fees for invoice ${invoiceId}: ${historyRows.length} items`)
    }
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const adminAuth = authResult

    const { id } = await context.params
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    let body: ResolveRequestBody
    try {
      body = await request.json()
    } catch {
      return apiError('Request body is invalid JSON. Please check the request format.')
    }

    const { resolution_notes, action } = body

    if (!action || !action.type) {
      return apiError('An action type is required to resolve an exception. Please select a resolution action.')
    }

    // Fetch the exception
    const { data: exception, error: fetchError } = await supabase
      .from('invoice_exceptions')
      .select('id, status, exception_type, invoice_id, invoice_item_id, exception_context')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError) {
      return formatApiError('fetch invoice exception', fetchError)
    }

    if (exception.status !== 'open') {
      return apiError(
        `This exception is already ${exception.status} and cannot be resolved again.`,
        422,
        'EXCEPTION_ALREADY_RESOLVED'
      )
    }

    // Validate: price_variance rejection requires notes
    if (
      exception.exception_type === 'price_variance' &&
      action.type === 'reject_cost_update' &&
      !resolution_notes?.trim()
    ) {
      return apiError(
        'A resolution note is required when rejecting a price variance. ' +
        'Please explain why the cost update was rejected.',
        400,
        'RESOLUTION_NOTES_REQUIRED'
      )
    }

    // Apply type-specific side effects
    let pipelineContinued = false

    try {
      switch (action.type) {
        case 'select_supplier': {
          // Link the invoice to the selected supplier
          await supabase
            .from('invoices')
            .update({ supplier_id: action.supplier_id, updated_at: new Date().toISOString() })
            .eq('id', exception.invoice_id)
            .eq('tenant_id', tenantId)
          pipelineContinued = true
          break
        }

        case 'create_supplier': {
          // Create a new supplier and link to invoice
          const { data: newSupplier } = await supabase
            .from('suppliers')
            .insert({
              tenant_id: tenantId,
              name: action.supplier_name,
              email: action.contact_email || null
            })
            .select('id')
            .single()

          if (newSupplier) {
            await supabase
              .from('invoices')
              .update({ supplier_id: newSupplier.id, updated_at: new Date().toISOString() })
              .eq('id', exception.invoice_id)
              .eq('tenant_id', tenantId)
          }
          pipelineContinued = true
          break
        }

        case 'link_po': {
          // Link invoice to a purchase order
          await supabase
            .from('order_invoice_matches')
            .upsert({
              tenant_id: tenantId,
              invoice_id: exception.invoice_id,
              purchase_order_id: action.purchase_order_id,
              match_method: 'manual',
              match_confidence: 1.0,
              status: 'confirmed'
            }, { onConflict: 'invoice_id,purchase_order_id' })
          pipelineContinued = true
          break
        }

        case 'match_item': {
          // Update the invoice item with the matched inventory item
          if (exception.invoice_item_id) {
            await supabase
              .from('invoice_items')
              .update({
                matched_item_id: action.inventory_item_id,
                match_method: 'manual',
                match_confidence: 1.0,
                is_reviewed: true
              })
              .eq('id', exception.invoice_item_id)
              .eq('invoice_id', exception.invoice_id)

            // Upsert alias for future use
            const ctx = exception.exception_context as Record<string, unknown>
            if (ctx.invoice_description) {
              // Get supplier_id from invoice
              const { data: inv } = await supabase
                .from('invoices')
                .select('supplier_id')
                .eq('id', exception.invoice_id)
                .eq('tenant_id', tenantId)
                .single()

              if (inv?.supplier_id) {
                await supabase
                  .from('supplier_item_aliases')
                  .upsert({
                    tenant_id: tenantId,
                    supplier_id: inv.supplier_id,
                    supplier_description: ctx.invoice_description as string,
                    inventory_item_id: action.inventory_item_id,
                    confidence: 1.0,
                    source: 'manual',
                    last_seen_invoice_id: exception.invoice_id,
                    last_seen_at: new Date().toISOString()
                  }, { onConflict: 'tenant_id,supplier_id,supplier_description' })
              }
            }
          }
          pipelineContinued = true
          break
        }

        case 'create_and_match_item': {
          if (exception.invoice_item_id) {
            // Create the new inventory item
            const { data: newItem } = await supabase
              .from('inventory_items')
              .insert({
                tenant_id: tenantId,
                item_name: action.item_name,
                unit: action.unit,
                unit_cost: action.unit_cost,
                category_id: action.category_id || null,
                sku: action.sku || null
              })
              .select('id')
              .single()

            if (newItem) {
              await supabase
                .from('invoice_items')
                .update({
                  matched_item_id: newItem.id,
                  match_method: 'manual',
                  match_confidence: 1.0,
                  is_reviewed: true
                })
                .eq('id', exception.invoice_item_id)
                .eq('invoice_id', exception.invoice_id)

              // Create alias for future matching
              const ctx = exception.exception_context as Record<string, unknown>
              if (ctx.invoice_description) {
                const { data: inv } = await supabase
                  .from('invoices')
                  .select('supplier_id')
                  .eq('id', exception.invoice_id)
                  .eq('tenant_id', tenantId)
                  .single()

                if (inv?.supplier_id) {
                  await supabase
                    .from('supplier_item_aliases')
                    .upsert({
                      tenant_id: tenantId,
                      supplier_id: inv.supplier_id,
                      supplier_description: ctx.invoice_description as string,
                      inventory_item_id: newItem.id,
                      confidence: 1.0,
                      source: 'manual',
                      last_seen_invoice_id: exception.invoice_id,
                      last_seen_at: new Date().toISOString()
                    }, { onConflict: 'tenant_id,supplier_id,supplier_description' })
                }
              }
            }
          }
          pipelineContinued = true
          break
        }

        case 'approve_cost_update': {
          // Apply the new unit price to inventory
          if (exception.invoice_item_id) {
            const ctx = exception.exception_context as Record<string, unknown>
            if (ctx.inventory_item_id && ctx.invoice_unit_price) {
              // Update inventory item unit cost
              await supabase
                .from('inventory_items')
                .update({
                  unit_cost: ctx.invoice_unit_price as number,
                  updated_at: new Date().toISOString()
                })
                .eq('id', ctx.inventory_item_id as string)
                .eq('tenant_id', tenantId)

              // Write cost history
              await supabase
                .from('inventory_item_cost_history')
                .insert({
                  tenant_id: tenantId,
                  inventory_item_id: ctx.inventory_item_id as string,
                  unit_cost: ctx.invoice_unit_price as number,
                  previous_unit_cost: ctx.previous_unit_cost as number | null,
                  source: 'invoice',
                  source_invoice_id: exception.invoice_id
                })
                .select()
                .maybeSingle() // Non-fatal if table doesn't exist yet
            }
          }
          pipelineContinued = true
          break
        }

        case 'retry_pipeline': {
          // Reset invoice to uploaded to retrigger pipeline
          await supabase
            .from('invoices')
            .update({
              status: 'uploaded',
              pipeline_stage: null,
              pipeline_error: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', exception.invoice_id)
            .eq('tenant_id', tenantId)
          pipelineContinued = true
          break
        }

        // Actions that don't require additional side effects:
        // approve_and_continue, reupload_required, confirm_without_po,
        // skip_item, reject_cost_update, confirm_quantity,
        // dismiss_as_duplicate, process_as_correction, keep_both
        default:
          break
      }
    } catch (sideEffectError) {
      console.error('Error applying resolution side effect:', sideEffectError)
      // Continue — we still mark the exception as resolved even if side effect partially failed
    }

    // Mark exception as resolved
    const { error: resolveError } = await supabase
      .from('invoice_exceptions')
      .update({
        status: 'resolved',
        resolution_notes: resolution_notes || null,
        resolved_by: adminAuth.userId,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (resolveError) {
      return formatApiError('resolve invoice exception', resolveError)
    }

    // Attempt auto-confirmation if this was the last open exception
    const invoiceAutoConfirmed = await tryAutoConfirmInvoice(supabase, exception.invoice_id, tenantId)

    console.log(`✅ Exception ${id} resolved with action=${action.type}`)

    return NextResponse.json({
      success: true,
      exception_id: id,
      invoice_auto_confirmed: invoiceAutoConfirmed,
      pipeline_continued: pipelineContinued
    })
  } catch (error) {
    return unexpectedError('resolve invoice exception', error)
  }
}
