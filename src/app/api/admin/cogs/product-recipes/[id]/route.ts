import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface RouteContext {
  params: Promise<{ id: string }>
}

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

type RecipeLineInput = {
  inventory_item_id: string
  qty: number
  unit: string
  loss_pct?: number
}

type RecipeLineCandidate = Record<string, unknown>

export async function GET(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()
  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'Missing recipe id' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: recipe, error: recipeError } = await supabase
    .from('cogs_product_recipes')
    .select('id, product_id, version, effective_from, effective_to, yield_qty, yield_unit, notes, created_at, updated_at, cogs_products(id, name, square_item_id)')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single()

  if (recipeError || !recipe) {
    return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
  }

  const { data: lines, error: linesError } = await supabase
    .from('cogs_product_recipe_lines')
    .select('id, inventory_item_id, qty, unit, loss_pct, created_at, inventory_items(id, item_name, unit_type)')
    .eq('tenant_id', tenantId)
    .eq('recipe_id', id)
    .order('created_at', { ascending: true })

  if (linesError) {
    return NextResponse.json({ error: linesError.message }, { status: 500 })
  }

  return NextResponse.json({ recipe, lines: lines ?? [] })
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()
  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'Missing recipe id' }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as {
    effective_from?: unknown
    effective_to?: unknown
    yield_qty?: unknown
    yield_unit?: unknown
    notes?: unknown
    lines?: unknown
  }

  const effectiveFrom = parseIsoDate(body.effective_from)
  const effectiveTo = body.effective_to === null ? null : parseIsoDate(body.effective_to)
  const yieldQty = parseNumber(body.yield_qty)
  const yieldUnit = normalizeText(body.yield_unit)
  const notes = typeof body.notes === 'string' ? body.notes : null

  if (!effectiveFrom) {
    return NextResponse.json({ error: 'effective_from is required' }, { status: 400 })
  }
  if (effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) {
    return NextResponse.json({ error: 'effective_to must be after effective_from' }, { status: 400 })
  }
  if (yieldQty === null || yieldQty <= 0) {
    return NextResponse.json({ error: 'yield_qty must be > 0' }, { status: 400 })
  }
  if (!yieldUnit) {
    return NextResponse.json({ error: 'yield_unit is required' }, { status: 400 })
  }

  const linesRaw = Array.isArray(body.lines) ? body.lines : []
  const lines: RecipeLineInput[] = []
  for (const line of linesRaw) {
    if (!line || typeof line !== 'object') continue
    const candidate = line as RecipeLineCandidate
    const inventoryItemId = normalizeText(candidate.inventory_item_id)
    const qty = parseNumber(candidate.qty)
    const unit = normalizeText(candidate.unit)
    const lossPct = parseNumber(candidate.loss_pct)
    if (!inventoryItemId || !qty || qty <= 0 || !unit) continue
    lines.push({
      inventory_item_id: inventoryItemId,
      qty,
      unit,
      loss_pct: lossPct ?? 0,
    })
  }

  if (lines.length === 0) {
    return NextResponse.json({ error: 'At least one recipe line is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: existing, error: existingError } = await supabase
    .from('cogs_product_recipes')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()

  if (existingError || !existing) {
    return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
  }

  const { error: updateError } = await supabase
    .from('cogs_product_recipes')
    .update({
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      yield_qty: yieldQty,
      yield_unit: yieldUnit,
      notes,
      approved_by: authResult.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const { error: deleteError } = await supabase
    .from('cogs_product_recipe_lines')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('recipe_id', id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  const { error: insertError } = await supabase
    .from('cogs_product_recipe_lines')
    .insert(lines.map(line => ({
      tenant_id: tenantId,
      recipe_id: id,
      inventory_item_id: line.inventory_item_id,
      qty: line.qty,
      unit: line.unit,
      loss_pct: line.loss_pct ?? 0,
    })))

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
