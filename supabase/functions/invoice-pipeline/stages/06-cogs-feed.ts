/**
 * Stage 06 — COGS Feed (P2)
 *
 * Called at the end of the pipeline after Stage 05 (auto-confirmation) succeeds.
 * Updates ai_cogs_daily_summaries for today's date with the confirmed invoice's
 * cost impact (purchases_value contribution).
 *
 * Uses service role, scoped to tenant_id.
 * This stage is NON-FATAL — failure does not block confirmation.
 *
 * Architecture: §6 Task 7
 * Runtime: Deno (Supabase Edge Function)
 * FR-18, AC-20
 */

import type { PipelineContext } from '../context.ts'
import type { StageResult } from '../orchestrator.ts'

const STAGE = 'cogs_feed'

export async function runCogsFeed(ctx: PipelineContext): Promise<StageResult> {
  console.log(JSON.stringify({
    event: 'stage_start',
    stage: STAGE,
    invoice_id: ctx.invoiceId,
    tenant_id: ctx.tenantId,
  }))

  try {
    // Only run if invoice was just auto-confirmed (no blocking exceptions)
    if (ctx.hasBlockingExceptions) {
      console.log(JSON.stringify({
        event: 'cogs_feed_skipped',
        reason: 'invoice_not_confirmed',
        invoice_id: ctx.invoiceId,
        tenant_id: ctx.tenantId,
      }))
      return { ok: true }
    }

    // Fetch the confirmed invoice to get total_amount, total_fees, and invoice_date
    const { data: invoice, error: invoiceError } = await ctx.supabase
      .from('invoices')
      .select('id, total_amount, total_fees, invoice_date')
      .eq('id', ctx.invoiceId)
      .eq('tenant_id', ctx.tenantId)
      .single()

    if (invoiceError || !invoice) {
      console.warn('[06-cogs-feed] Could not fetch invoice:', invoiceError?.message)
      return { ok: true }  // Non-fatal
    }

    // Use invoice_date or today as the summary date
    const today = new Date().toISOString().split('T')[0]
    const summaryDate = (invoice.invoice_date as string | null)
      ? (invoice.invoice_date as string).split('T')[0]
      : today

    // purchases_value includes product total + supplier fees (both are COGS)
    const invoiceTotalAmount = typeof invoice.total_amount === 'number'
      ? invoice.total_amount
      : 0
    const invoiceTotalFees = typeof (invoice as { total_fees?: unknown }).total_fees === 'number'
      ? (invoice as { total_fees: number }).total_fees
      : 0
    const invoicePurchasesValue = Math.round((invoiceTotalAmount + invoiceTotalFees) * 100) / 100

    // Fetch current inventory value for ending_inventory_value
    const { data: inventoryItems } = await ctx.supabase
      .from('inventory_items')
      .select('current_stock, unit_cost')
      .eq('tenant_id', ctx.tenantId)

    const currentInventoryValue = (inventoryItems ?? []).reduce(
      (sum: number, item: { current_stock: unknown; unit_cost: unknown }) => {
        const stock = typeof item.current_stock === 'number' ? item.current_stock : 0
        const cost = typeof item.unit_cost === 'number' ? item.unit_cost : 0
        return sum + stock * cost
      },
      0
    )
    const roundedInventoryValue = Math.round(currentInventoryValue * 100) / 100

    // Check if a summary already exists for this date
    const { data: existing } = await ctx.supabase
      .from('ai_cogs_daily_summaries')
      .select('id, purchases_value, contributing_invoice_ids, beginning_inventory_value')
      .eq('tenant_id', ctx.tenantId)
      .eq('summary_date', summaryDate)
      .maybeSingle()

    if (existing) {
      // Update existing row: add this invoice's purchases value (product + fees) to purchases_value
      const newPurchases = Math.round(
        ((existing.purchases_value as number) + invoicePurchasesValue) * 100
      ) / 100

      const existingIds = (existing.contributing_invoice_ids as string[]) ?? []
      const newIds = existingIds.includes(ctx.invoiceId)
        ? existingIds
        : [...existingIds, ctx.invoiceId]

      const beginningInventory = existing.beginning_inventory_value as number
      const newPeriodicCogs = Math.max(
        0,
        Math.round((beginningInventory + newPurchases - roundedInventoryValue) * 100) / 100
      )

      const { error: updateError } = await ctx.supabase
        .from('ai_cogs_daily_summaries')
        .update({
          purchases_value: newPurchases,
          ending_inventory_value: roundedInventoryValue,
          periodic_cogs: newPeriodicCogs,
          contributing_invoice_ids: newIds,
          computed_at: new Date().toISOString(),
        })
        .eq('id', existing.id as string)
        .eq('tenant_id', ctx.tenantId)

      if (updateError) {
        console.warn('[06-cogs-feed] Failed to update daily summary:', updateError.message)
        return { ok: true }  // Non-fatal
      }

      console.log(JSON.stringify({
        event: 'cogs_feed_updated',
        summary_date: summaryDate,
        invoice_id: ctx.invoiceId,
        purchases_value: newPurchases,
        fees_included: invoiceTotalFees,
        periodic_cogs: newPeriodicCogs,
        tenant_id: ctx.tenantId,
      }))
    } else {
      // Insert new summary row for this date
      const beginningInventory = Math.max(
        0,
        Math.round((roundedInventoryValue - invoicePurchasesValue) * 100) / 100
      )
      const periodicCogs = Math.max(
        0,
        Math.round((beginningInventory + invoicePurchasesValue - roundedInventoryValue) * 100) / 100
      )

      const { error: insertError } = await ctx.supabase
        .from('ai_cogs_daily_summaries')
        .insert({
          tenant_id: ctx.tenantId,
          summary_date: summaryDate,
          beginning_inventory_value: beginningInventory,
          purchases_value: Math.round(invoicePurchasesValue * 100) / 100,
          ending_inventory_value: roundedInventoryValue,
          periodic_cogs: periodicCogs,
          contributing_invoice_ids: [ctx.invoiceId],
          computation_method: 'periodic',
          computed_at: new Date().toISOString(),
        })

      if (insertError) {
        // May be a conflict race — try update instead
        if (insertError.code === '23505') {
          console.log('[06-cogs-feed] Conflict on insert — retrying as update')
          await ctx.supabase
            .from('ai_cogs_daily_summaries')
            .update({
              purchases_value: Math.round(invoicePurchasesValue * 100) / 100,
              contributing_invoice_ids: [ctx.invoiceId],
              computed_at: new Date().toISOString(),
            })
            .eq('tenant_id', ctx.tenantId)
            .eq('summary_date', summaryDate)
        } else {
          console.warn('[06-cogs-feed] Failed to insert daily summary:', insertError.message)
          return { ok: true }  // Non-fatal
        }
      }

      console.log(JSON.stringify({
        event: 'cogs_feed_inserted',
        summary_date: summaryDate,
        invoice_id: ctx.invoiceId,
        purchases_value: invoicePurchasesValue,
        fees_included: invoiceTotalFees,
        periodic_cogs: periodicCogs,
        tenant_id: ctx.tenantId,
      }))
    }

    return { ok: true }
  } catch (err) {
    // Non-fatal — log and continue
    console.error('[06-cogs-feed] Unexpected error:', err)
    return { ok: true }
  }
}
