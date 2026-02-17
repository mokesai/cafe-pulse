import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseIsoDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(n)) return null
  return n
}

type OverrideOpType = 'add' | 'remove' | 'replace' | 'multiplier'

type OverrideOpInput = {
  op_type: OverrideOpType
  target_inventory_item_id?: string | null
  new_inventory_item_id?: string | null
  qty?: number | null
  unit?: string | null
  multiplier?: number | null
  loss_pct?: number | null
}

type OverrideOpCandidate = Record<string, unknown>

function isOverrideOpType(value: unknown): value is OverrideOpType {
  return value === 'add' || value === 'remove' || value === 'replace' || value === 'multiplier'
}

function parseOverrideOps(value: unknown) {
  const raw = Array.isArray(value) ? value : []
  const ops: OverrideOpInput[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as OverrideOpCandidate
    if (!isOverrideOpType(candidate.op_type)) continue

    const opType = candidate.op_type
    const targetId = normalizeText(candidate.target_inventory_item_id) || null
    const newId = normalizeText(candidate.new_inventory_item_id) || null
    const qty = parseNumber(candidate.qty)
    const unit = normalizeText(candidate.unit) || null
    const multiplier = parseNumber(candidate.multiplier)
    const lossPct = parseNumber(candidate.loss_pct)

    if (opType === 'add') {
      if (!newId && !targetId) continue
      if (!qty || qty <= 0 || !unit) continue
      ops.push({
        op_type: 'add',
        target_inventory_item_id: null,
        new_inventory_item_id: newId || targetId,
        qty,
        unit,
        loss_pct: lossPct ?? 0,
      })
      continue
    }

    if (opType === 'remove') {
      if (!targetId) continue
      ops.push({ op_type: 'remove', target_inventory_item_id: targetId })
      continue
    }

    if (opType === 'replace') {
      if (!targetId || !newId) continue
      ops.push({
        op_type: 'replace',
        target_inventory_item_id: targetId,
        new_inventory_item_id: newId,
        qty: qty && qty > 0 ? qty : null,
        unit: unit || null,
        loss_pct: lossPct ?? null,
      })
      continue
    }

    if (opType === 'multiplier') {
      if (!multiplier || multiplier <= 0) continue
      ops.push({
        op_type: 'multiplier',
        target_inventory_item_id: targetId || null,
        multiplier,
      })
    }
  }

  return ops
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()
  const url = new URL(request.url)
  const sellableId = normalizeText(url.searchParams.get('sellableId'))
  if (!sellableId) {
    return NextResponse.json({ error: 'sellableId is required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('cogs_sellable_recipe_overrides')
    .select('id, sellable_id, version, effective_from, effective_to, notes, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('sellable_id', sellableId)
    .order('effective_from', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ overrides: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()

  const body = (await request.json().catch(() => ({}))) as {
    sellable_id?: unknown
    effective_from?: unknown
    effective_to?: unknown
    notes?: unknown
    ops?: unknown
  }

  const sellableId = normalizeText(body.sellable_id)
  const effectiveFrom = parseIsoDate(body.effective_from)
  const effectiveTo = body.effective_to === null ? null : parseIsoDate(body.effective_to)
  const notes = typeof body.notes === 'string' ? body.notes : null
  const ops = parseOverrideOps(body.ops)

  if (!sellableId || !effectiveFrom) {
    return NextResponse.json({ error: 'sellable_id and effective_from are required' }, { status: 400 })
  }
  if (effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) {
    return NextResponse.json({ error: 'effective_to must be after effective_from' }, { status: 400 })
  }
  if (ops.length === 0) {
    return NextResponse.json({ error: 'At least one override op is required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: override, error: overrideError } = await supabase
    .from('cogs_sellable_recipe_overrides')
    .insert([{
      tenant_id: tenantId,
      sellable_id: sellableId,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      notes,
      approved_by: authResult.userId ?? null,
    }])
    .select()
    .single()

  if (overrideError || !override) {
    return NextResponse.json({ error: overrideError?.message ?? 'Failed to create override' }, { status: 500 })
  }

  const { error: opsError } = await supabase
    .from('cogs_sellable_recipe_override_ops')
    .insert(ops.map(op => ({
      tenant_id: tenantId,
      override_id: override.id,
      op_type: op.op_type,
      target_inventory_item_id: op.target_inventory_item_id ?? null,
      new_inventory_item_id: op.new_inventory_item_id ?? null,
      qty: op.qty ?? null,
      unit: op.unit ?? null,
      multiplier: op.multiplier ?? null,
      loss_pct: op.loss_pct ?? null,
    })))

  if (opsError) {
    return NextResponse.json({ error: opsError.message }, { status: 500 })
  }

  return NextResponse.json({ overrideId: override.id })
}
