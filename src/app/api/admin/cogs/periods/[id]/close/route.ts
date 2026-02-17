import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function parseDateRange(period: { start_at: string; end_at: string }) {
  const start = new Date(period.start_at)
  const end = new Date(period.end_at)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid period date range')
  }
  return { start, end }
}

async function computePurchasesValue(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  start: Date,
  end: Date
) {
  const startIso = start.toISOString()
  const endIso = end.toISOString()

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, total_amount, status, invoice_date, confirmed_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')

  if (error) {
    throw new Error(`Failed to load invoices: ${error.message}`)
  }

  let total = 0
  for (const invoice of invoices ?? []) {
    const confirmedAt = invoice.confirmed_at ? new Date(invoice.confirmed_at) : null
    const invoiceDate = invoice.invoice_date ? new Date(`${invoice.invoice_date}T00:00:00.000Z`) : null

    const dateForRange = confirmedAt ?? invoiceDate
    if (!dateForRange || Number.isNaN(dateForRange.getTime())) continue

    if (dateForRange >= new Date(startIso) && dateForRange <= new Date(endIso)) {
      total += Number(invoice.total_amount ?? 0)
    }
  }

  return roundMoney(total)
}

async function snapshotInventory(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  periodId: string
) {
  const { data: inventoryItems, error } = await supabase
    .from('inventory_items')
    .select('id, current_stock, unit_cost')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)

  if (error) {
    throw new Error(`Failed to load inventory items: ${error.message}`)
  }

  const rows = (inventoryItems ?? []).map(item => {
    const qtyOnHand = Number(item.current_stock ?? 0)
    const unitCost = Number(item.unit_cost ?? 0)
    const value = roundMoney(qtyOnHand * unitCost)

    return {
      tenant_id: tenantId,
      period_id: periodId,
      inventory_item_id: item.id,
      qty_on_hand: qtyOnHand,
      unit_cost: unitCost,
      value,
      method: 'wac',
    }
  })

  if (rows.length === 0) return 0

  const { error: insertError } = await supabase
    .from('inventory_valuations')
    .insert(rows)

  if (insertError) {
    throw new Error(`Failed to insert inventory valuation snapshot: ${insertError.message}`)
  }

  return roundMoney(rows.reduce((sum, row) => sum + Number(row.value || 0), 0))
}

async function getBeginInventoryValue(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  startAt: string
) {
  const { data: priorPeriods, error } = await supabase
    .from('cogs_periods')
    .select('id, end_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'closed')
    .lt('end_at', startAt)
    .order('end_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(`Failed to load prior periods: ${error.message}`)
  const priorPeriod = priorPeriods?.[0]
  if (!priorPeriod) return 0

  const { data: report, error: reportError } = await supabase
    .from('cogs_reports')
    .select('end_inventory_value')
    .eq('tenant_id', tenantId)
    .eq('period_id', priorPeriod.id)
    .maybeSingle()

  if (reportError) throw new Error(`Failed to load prior report: ${reportError.message}`)
  return roundMoney(Number(report?.end_inventory_value ?? 0))
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()
  const { id: periodId } = await context.params
  if (!periodId) {
    return NextResponse.json({ error: 'Missing period id' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: period, error: periodError } = await supabase
    .from('cogs_periods')
    .select('id, period_type, start_at, end_at, status')
    .eq('tenant_id', tenantId)
    .eq('id', periodId)
    .single()

  if (periodError || !period) {
    return NextResponse.json({ error: 'Period not found' }, { status: 404 })
  }
  if (period.status === 'closed') {
    return NextResponse.json({ error: 'Period is already closed' }, { status: 400 })
  }

  try {
    const { start, end } = parseDateRange(period)

    const beginInventoryValue = await getBeginInventoryValue(supabase, tenantId, period.start_at)
    const endInventoryValue = await snapshotInventory(supabase, tenantId, period.id)
    const purchasesValue = await computePurchasesValue(supabase, tenantId, start, end)
    const periodicCogsValue = roundMoney(beginInventoryValue + purchasesValue - endInventoryValue)

    const { error: reportError } = await supabase
      .from('cogs_reports')
      .insert([{
        tenant_id: tenantId,
        period_id: period.id,
        begin_inventory_value: beginInventoryValue,
        purchases_value: purchasesValue,
        end_inventory_value: endInventoryValue,
        periodic_cogs_value: periodicCogsValue,
        currency: 'USD',
        inputs: {
          invoices_method: 'confirmed_at_or_invoice_date',
          inventory_method: 'current_stock_snapshot',
        }
      }])

    if (reportError) {
      return NextResponse.json({ error: `Failed to create report: ${reportError.message}` }, { status: 500 })
    }

    const { error: closeError } = await supabase
      .from('cogs_periods')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: authResult.userId ?? null
      })
      .eq('tenant_id', tenantId)
      .eq('id', period.id)

    if (closeError) {
      return NextResponse.json({ error: `Failed to close period: ${closeError.message}` }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      periodId: period.id,
      periodic: {
        beginInventoryValue,
        purchasesValue,
        endInventoryValue,
        periodicCogsValue
      }
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
