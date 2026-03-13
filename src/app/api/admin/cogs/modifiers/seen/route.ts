import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

type ModifierSeen = {
  square_modifier_id: string
  name: string | null
  count: number
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()
  const url = new URL(request.url)
  const days = parsePositiveInt(url.searchParams.get('days'), 30)
  const limit = parsePositiveInt(url.searchParams.get('limit'), 200)

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('sales_transaction_items')
    .select('metadata, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .not('metadata', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const counts = new Map<string, ModifierSeen>()
  for (const row of data ?? []) {
    const metadata = row.metadata as Record<string, unknown> | null
    const modifiers = metadata?.modifiers
    if (!Array.isArray(modifiers)) continue
    for (const mod of modifiers) {
      if (!mod || typeof mod !== 'object') continue
      const m = mod as Record<string, unknown>
      const squareModifierId = typeof m.catalog_object_id === 'string' ? m.catalog_object_id : null
      if (!squareModifierId) continue
      const name = typeof m.name === 'string' ? m.name : null
      const existing = counts.get(squareModifierId)
      if (existing) {
        existing.count += 1
        if (!existing.name && name) existing.name = name
      } else {
        counts.set(squareModifierId, { square_modifier_id: squareModifierId, name, count: 1 })
      }
    }
  }

  const seen = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)

  return NextResponse.json({ since, days, seen })
}
