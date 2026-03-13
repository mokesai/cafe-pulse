import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface RouteContext {
  params: Promise<{ id: string }>
}

function toCsvRow(fields: Array<string | number | boolean | null | undefined>) {
  return fields
    .map(value => {
      if (value === null || value === undefined) return ''
      const text = String(value)
      if (text.includes('"') || text.includes(',') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`
      }
      return text
    })
    .join(',')
}

export async function GET(request: NextRequest, context: RouteContext) {
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
    .select('id, period_type, start_at, end_at, status, closed_at')
    .eq('tenant_id', tenantId)
    .eq('id', periodId)
    .single()

  if (periodError || !period) {
    return NextResponse.json({ error: 'Period not found' }, { status: 404 })
  }

  const { data: report, error: reportError } = await supabase
    .from('cogs_reports')
    .select('begin_inventory_value, purchases_value, end_inventory_value, periodic_cogs_value, currency, created_at')
    .eq('tenant_id', tenantId)
    .eq('period_id', periodId)
    .maybeSingle()

  if (reportError) {
    return NextResponse.json({ error: reportError.message }, { status: 500 })
  }

  const { data: valuations, error: valuationsError } = await supabase
    .from('inventory_valuations')
    .select('inventory_item_id, qty_on_hand, unit_cost, value, method, computed_at, inventory_items(item_name)')
    .eq('tenant_id', tenantId)
    .eq('period_id', periodId)
    .order('value', { ascending: false })

  if (valuationsError) {
    return NextResponse.json({ error: valuationsError.message }, { status: 500 })
  }

  const lines: string[] = []
  lines.push(toCsvRow(['report_type', 'periodic_cogs_summary']))
  lines.push(toCsvRow(['period_id', period.id]))
  lines.push(toCsvRow(['period_type', period.period_type]))
  lines.push(toCsvRow(['start_at', period.start_at]))
  lines.push(toCsvRow(['end_at', period.end_at]))
  lines.push(toCsvRow(['status', period.status]))
  lines.push(toCsvRow(['closed_at', period.closed_at ?? '']))
  lines.push(toCsvRow(['currency', report?.currency ?? 'USD']))
  lines.push(toCsvRow(['begin_inventory_value', report?.begin_inventory_value ?? 0]))
  lines.push(toCsvRow(['purchases_value', report?.purchases_value ?? 0]))
  lines.push(toCsvRow(['end_inventory_value', report?.end_inventory_value ?? 0]))
  lines.push(toCsvRow(['periodic_cogs_value', report?.periodic_cogs_value ?? 0]))
  lines.push('')

  lines.push(toCsvRow(['report_type', 'inventory_valuations']))
  lines.push(toCsvRow(['inventory_item_id', 'inventory_item_name', 'qty_on_hand', 'unit_cost', 'value', 'method', 'computed_at']))
  for (const row of valuations ?? []) {
    const inventoryItems = row.inventory_items as unknown as
      | { item_name?: string | null }
      | Array<{ item_name?: string | null }>
      | null

    const inventoryItemName = Array.isArray(inventoryItems)
      ? (inventoryItems[0]?.item_name ?? '')
      : (inventoryItems?.item_name ?? '')

    lines.push(toCsvRow([
      row.inventory_item_id,
      inventoryItemName,
      row.qty_on_hand,
      row.unit_cost,
      row.value,
      row.method,
      row.computed_at,
    ]))
  }

  const csv = lines.join('\n') + '\n'
  const filename = `cogs_period_${period.id}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    }
  })
}
