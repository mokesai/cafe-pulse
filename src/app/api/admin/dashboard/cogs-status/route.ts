import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { computeCogsStatus } from '@/lib/cogs/dashboard-status'
import { getCostJumpItems } from '@/lib/inventory/cost-jump'

// B1 / MOK-173: consolidated payload for the dashboard COGS strip — this-week vs prior-week COGS
// (from ai_cogs_daily_summaries) and revenue (from orders), the tenant target %, the derived
// good/bad signal, a 14-day sparkline, and the open block-exception count.

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Rolling 7-day windows: this week = [today-6 .. today]; prior = [today-13 .. today-7].
    const today = new Date()
    const dayOffset = (n: number) => {
      const x = new Date(today)
      x.setUTCDate(x.getUTCDate() - n)
      return x
    }
    const startOfDay = (d: Date) => {
      const x = new Date(d)
      x.setUTCHours(0, 0, 0, 0)
      return x
    }
    const endOfDay = (d: Date) => {
      const x = new Date(d)
      x.setUTCHours(23, 59, 59, 999)
      return x
    }

    const thisStart = dayOffset(6)
    const priorStart = dayOffset(13)
    const priorEnd = dayOffset(7)
    const thisStartStr = dateStr(thisStart)

    // ── Daily COGS for the last 14 days ──
    const { data: summaries } = await supabase
      .from('ai_cogs_daily_summaries')
      .select('summary_date, periodic_cogs')
      .eq('tenant_id', tenantId)
      .gte('summary_date', dateStr(priorStart))
      .lte('summary_date', dateStr(today))
      .order('summary_date', { ascending: true })

    let weeklyCogs = 0
    let priorWeeklyCogs = 0
    const sparkline: number[] = []
    for (const row of summaries ?? []) {
      const cogs = Number(row.periodic_cogs) || 0
      sparkline.push(Number(cogs.toFixed(2)))
      if ((row.summary_date as string) >= thisStartStr) weeklyCogs += cogs
      else priorWeeklyCogs += cogs
    }

    // ── Revenue per window (orders.total_amount is in cents; exclude cancelled) ──
    const sumRevenue = async (start: Date, end: Date): Promise<number> => {
      const { data } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('tenant_id', tenantId)
        .neq('status', 'cancelled')
        .gte('created_at', startOfDay(start).toISOString())
        .lte('created_at', endOfDay(end).toISOString())
      return (data ?? []).reduce((s, o) => s + (Number(o.total_amount) || 0), 0) / 100
    }
    const weeklyRevenue = await sumRevenue(thisStart, today)
    const priorWeeklyRevenue = await sumRevenue(priorStart, priorEnd)

    // ── Open block-severity exceptions (the "needs attention" count) ──
    const { count: openBlockExceptions } = await supabase
      .from('invoice_exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .eq('severity', 'block')

    // ── Tenant target % ──
    const { data: tenant } = await supabase
      .from('tenants')
      .select('target_cogs_percentage_pct')
      .eq('id', tenantId)
      .single()
    const targetPct = Number(tenant?.target_cogs_percentage_pct ?? 30)

    const status = computeCogsStatus({
      weeklyCogs,
      weeklyRevenue,
      priorWeeklyCogs,
      priorWeeklyRevenue,
      targetPct,
    })

    // B3 (MOK-175): count of items whose supplier cost jumped recently — a "review menu price" nudge.
    const priceReviewItems = await getCostJumpItems(supabase, tenantId)

    return NextResponse.json({
      success: true,
      data: {
        ...status,
        openBlockExceptions: openBlockExceptions ?? 0,
        itemsNeedingPriceReview: priceReviewItems.length,
        sparkline,
        weekRange: { start: thisStartStr, end: dateStr(today) },
      },
    })
  } catch (error) {
    console.error('Failed to compute COGS status:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
