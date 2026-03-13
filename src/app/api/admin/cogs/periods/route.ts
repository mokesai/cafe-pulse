import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

type PeriodType = 'weekly' | 'monthly' | 'annual' | 'custom'

function isPeriodType(value: unknown): value is PeriodType {
  return value === 'weekly' || value === 'monthly' || value === 'annual' || value === 'custom'
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('cogs_periods')
    .select('id, period_type, start_at, end_at, status, closed_at, closed_by, notes, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('start_at', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ periods: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()

  const body = (await request.json().catch(() => ({}))) as {
    period_type?: unknown
    start_at?: unknown
    end_at?: unknown
    notes?: unknown
  }

  if (!isPeriodType(body.period_type)) {
    return NextResponse.json({ error: 'Invalid period_type' }, { status: 400 })
  }

  const startAt = parseIsoDate(body.start_at)
  const endAt = parseIsoDate(body.end_at)
  if (!startAt || !endAt) {
    return NextResponse.json({ error: 'start_at and end_at are required ISO dates' }, { status: 400 })
  }
  if (new Date(endAt) <= new Date(startAt)) {
    return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 })
  }

  const notes = typeof body.notes === 'string' ? body.notes : null

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('cogs_periods')
    .insert([{
      tenant_id: tenantId,
      period_type: body.period_type,
      start_at: startAt,
      end_at: endAt,
      notes,
      status: 'open',
      closed_at: null,
      closed_by: null,
    }])
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create period' }, { status: 500 })
  }

  return NextResponse.json({ period: data })
}
