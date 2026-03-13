import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseIsoDate(value: unknown): string | null {
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

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()
  const url = new URL(request.url)
  const modifierOptionId = normalizeText(url.searchParams.get('modifierOptionId'))

  const supabase = createServiceClient()
  let query = supabase
    .from('cogs_modifier_option_recipes')
    .select('id, modifier_option_id, version, effective_from, effective_to, notes, created_at, updated_at, cogs_modifier_options(name, square_modifier_id)')
    .eq('tenant_id', tenantId)
    .order('effective_from', { ascending: false })

  if (modifierOptionId) {
    query = query.eq('modifier_option_id', modifierOptionId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ recipes: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()

  const body = (await request.json().catch(() => ({}))) as {
    modifier_option_id?: unknown
    effective_from?: unknown
    effective_to?: unknown
    notes?: unknown
    lines?: unknown
  }

  const modifierOptionId = normalizeText(body.modifier_option_id)
  const effectiveFrom = parseIsoDate(body.effective_from)
  const effectiveTo = parseIsoDate(body.effective_to)
  const notes = typeof body.notes === 'string' ? body.notes : null

  if (!modifierOptionId || !effectiveFrom) {
    return NextResponse.json({ error: 'modifier_option_id and effective_from are required' }, { status: 400 })
  }
  if (effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) {
    return NextResponse.json({ error: 'effective_to must be after effective_from' }, { status: 400 })
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
  const { data: recipe, error: recipeError } = await supabase
    .from('cogs_modifier_option_recipes')
    .insert([{
      tenant_id: tenantId,
      modifier_option_id: modifierOptionId,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      notes,
      approved_by: authResult.userId ?? null,
    }])
    .select()
    .single()

  if (recipeError || !recipe) {
    return NextResponse.json({ error: recipeError?.message ?? 'Failed to create recipe' }, { status: 500 })
  }

  const { error: linesError } = await supabase
    .from('cogs_modifier_option_recipe_lines')
    .insert(lines.map(line => ({
      tenant_id: tenantId,
      recipe_id: recipe.id,
      inventory_item_id: line.inventory_item_id,
      qty: line.qty,
      unit: line.unit,
      loss_pct: line.loss_pct ?? 0,
    })))

  if (linesError) {
    return NextResponse.json({ error: `Failed to create recipe lines: ${linesError.message}` }, { status: 500 })
  }

  return NextResponse.json({ recipeId: recipe.id })
}
