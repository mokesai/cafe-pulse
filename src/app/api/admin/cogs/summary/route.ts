/**
 * GET /api/admin/cogs/summary
 *
 * Returns pre-computed daily COGS summaries from ai_cogs_daily_summaries.
 * Query params: start_at (ISO date), end_at (ISO date)
 *
 * Per Jerry's decision (OQ-09): on-demand computation is acceptable.
 * If no pre-computed data exists for the requested range, triggers on-demand
 * computation for dates that are missing.
 *
 * AC-21: Response from pre-computed data — fast, no N+1 queries.
 *
 * FR-19, AC-20, AC-21
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

function parseDate(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]  // YYYY-MM-DD
}

/**
 * Compute daily COGS on-demand for a specific date.
 * Uses periodic method: Beginning Inventory + Purchases − Ending Inventory.
 * This is called only when no pre-computed row exists for the date.
 */
async function computeCogsDailyOnDemand(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  date: string
): Promise<{
  beginning_inventory_value: number
  purchases_value: number
  ending_inventory_value: number
  periodic_cogs: number
  contributing_invoice_ids: string[]
}> {
  const dayStart = `${date}T00:00:00.000Z`
  const dayEnd = `${date}T23:59:59.999Z`

  // Purchases: sum of confirmed invoices for this date
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, total_amount')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .gte('invoice_date', dayStart.split('T')[0])
    .lte('invoice_date', dayEnd.split('T')[0])

  const purchasesValue = (invoices ?? []).reduce((sum, inv) => {
    const amount = typeof inv.total_amount === 'number' ? inv.total_amount : 0
    return sum + amount
  }, 0)

  const contributingInvoiceIds = (invoices ?? []).map(inv => inv.id as string)

  // Inventory snapshot: current total value (approximation for on-demand)
  // For a proper periodic calculation, we'd need point-in-time snapshots.
  // On-demand uses current inventory value as ending_inventory approximation.
  const { data: inventoryItems } = await supabase
    .from('inventory_items')
    .select('current_stock, unit_cost')
    .eq('tenant_id', tenantId)

  const currentInventoryValue = (inventoryItems ?? []).reduce((sum, item) => {
    const stock = typeof item.current_stock === 'number' ? item.current_stock : 0
    const cost = typeof item.unit_cost === 'number' ? item.unit_cost : 0
    return sum + stock * cost
  }, 0)

  // Beginning inventory = ending inventory - purchases (simplified on-demand)
  const beginningInventoryValue = Math.max(0, currentInventoryValue - purchasesValue)
  const periodicCogs = Math.max(0, beginningInventoryValue + purchasesValue - currentInventoryValue)

  return {
    beginning_inventory_value: Math.round(beginningInventoryValue * 100) / 100,
    purchases_value: Math.round(purchasesValue * 100) / 100,
    ending_inventory_value: Math.round(currentInventoryValue * 100) / 100,
    periodic_cogs: Math.round(periodicCogs * 100) / 100,
    contributing_invoice_ids: contributingInvoiceIds,
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    const tenantId = await getCurrentTenantId()
    const supabase = createServiceClient()

    const { searchParams } = new URL(request.url)
    const startAt = parseDate(searchParams.get('start_at'))
    const endAt = parseDate(searchParams.get('end_at'))

    if (!startAt || !endAt) {
      return NextResponse.json(
        { error: 'start_at and end_at query params are required (ISO date format: YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    if (startAt > endAt) {
      return NextResponse.json(
        { error: 'start_at must be on or before end_at' },
        { status: 400 }
      )
    }

    // AC-21: Read from pre-computed summaries — fast, no N+1
    const { data: summaries, error: summaryError } = await supabase
      .from('ai_cogs_daily_summaries')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('summary_date', startAt)
      .lte('summary_date', endAt)
      .order('summary_date', { ascending: true })

    if (summaryError) {
      return NextResponse.json({ error: summaryError.message }, { status: 500 })
    }

    // Identify missing dates and compute on-demand (Jerry's decision: on-demand acceptable)
    const existingDates = new Set((summaries ?? []).map(s => s.summary_date as string))
    const allDates: string[] = []
    const start = new Date(startAt)
    const end = new Date(endAt)
    // Only compute on-demand for dates in the past (not future dates)
    const today = new Date().toISOString().split('T')[0]

    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      if (!existingDates.has(dateStr) && dateStr <= today) {
        allDates.push(dateStr)
      }
    }

    // Compute on-demand for missing dates (up to 7 at a time to avoid timeouts)
    const onDemandRows = []
    for (const date of allDates.slice(0, 7)) {
      try {
        const computed = await computeCogsDailyOnDemand(supabase, tenantId, date)
        const row = {
          tenant_id: tenantId,
          summary_date: date,
          ...computed,
          computation_method: 'periodic' as const,
          computed_at: new Date().toISOString(),
        }

        // Store for future fast retrieval (AC-21)
        const { data: saved } = await supabase
          .from('ai_cogs_daily_summaries')
          .upsert(row, { onConflict: 'tenant_id,summary_date' })
          .select('*')
          .single()

        onDemandRows.push(saved ?? row)
      } catch (err) {
        console.warn(`[cogs/summary] On-demand computation failed for ${date}:`, err)
      }
    }

    // Merge pre-computed + on-demand, sort by date
    const allSummaries = [
      ...(summaries ?? []),
      ...onDemandRows,
    ].sort((a, b) => {
      const aDate = (a as { summary_date: string }).summary_date
      const bDate = (b as { summary_date: string }).summary_date
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0
    })

    // Deduplicate by summary_date (prefer pre-computed over on-demand)
    const deduped = Array.from(
      new Map(allSummaries.map(s => [(s as { summary_date: string }).summary_date, s])).values()
    )

    return NextResponse.json({
      success: true,
      data: deduped,
      date_range: { start_at: startAt, end_at: endAt },
      total_days: deduped.length,
    })
  } catch (err) {
    console.error('[cogs/summary] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
