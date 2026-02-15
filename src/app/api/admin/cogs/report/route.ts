import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'

function parseIso(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function parseBool(value: string | null, fallback: boolean) {
  if (value === null) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false
  return fallback
}

type Unit = 'each' | 'lb' | 'oz' | 'gallon' | 'liter' | 'ml'

function toUnit(value: unknown): Unit | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v === 'each' || v === 'lb' || v === 'oz' || v === 'gallon' || v === 'liter' || v === 'ml') return v
  return null
}

function convertQty(qty: number, from: Unit, to: Unit): number | null {
  if (!Number.isFinite(qty)) return null
  if (from === to) return qty

  // Mass
  if (from === 'lb' && to === 'oz') return qty * 16
  if (from === 'oz' && to === 'lb') return qty / 16

  // Volume (base = ml)
  const toMl: Record<Unit, number | null> = {
    each: null,
    lb: null,
    oz: null,
    gallon: 3785.411784,
    liter: 1000,
    ml: 1
  }
  const fromFactor = toMl[from]
  const toFactor = toMl[to]
  if (fromFactor && toFactor) {
    const inMl = qty * fromFactor
    return inMl / toFactor
  }

  return null
}

type RecipeLine = {
  inventory_item_id: string
  qty: number
  unit: string
  loss_pct: number
}

type OverrideOpType = 'add' | 'remove' | 'replace' | 'multiplier'

type OverrideOp = {
  op_type: OverrideOpType
  target_inventory_item_id: string | null
  new_inventory_item_id: string | null
  qty: number | null
  unit: string | null
  multiplier: number | null
  loss_pct: number | null
  created_at: string
}

function applyOverrideOps(
  baseLines: RecipeLine[],
  ops: OverrideOp[]
) {
  const byItem = new Map<string, RecipeLine>()
  for (const line of baseLines) {
    byItem.set(line.inventory_item_id, { ...line })
  }

  const sortedOps = [...ops].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  for (const op of sortedOps) {
    if (op.op_type === 'remove') {
      if (op.target_inventory_item_id) byItem.delete(op.target_inventory_item_id)
      continue
    }

    if (op.op_type === 'multiplier') {
      const multiplier = typeof op.multiplier === 'number' && Number.isFinite(op.multiplier) ? op.multiplier : null
      if (!multiplier) continue
      if (op.target_inventory_item_id) {
        const existing = byItem.get(op.target_inventory_item_id)
        if (existing) existing.qty *= multiplier
      } else {
        for (const line of byItem.values()) {
          line.qty *= multiplier
        }
      }
      continue
    }

    if (op.op_type === 'replace') {
      if (!op.target_inventory_item_id || !op.new_inventory_item_id) continue
      const existing = byItem.get(op.target_inventory_item_id)
      const base = existing ?? null
      byItem.delete(op.target_inventory_item_id)
      byItem.set(op.new_inventory_item_id, {
        inventory_item_id: op.new_inventory_item_id,
        qty: typeof op.qty === 'number' && Number.isFinite(op.qty) ? op.qty : base?.qty ?? 0,
        unit: typeof op.unit === 'string' ? op.unit : base?.unit ?? 'each',
        loss_pct: typeof op.loss_pct === 'number' && Number.isFinite(op.loss_pct) ? op.loss_pct : base?.loss_pct ?? 0
      })
      continue
    }

    if (op.op_type === 'add') {
      const newId = op.new_inventory_item_id || op.target_inventory_item_id
      if (!newId) continue
      const qty = typeof op.qty === 'number' && Number.isFinite(op.qty) ? op.qty : null
      const unit = typeof op.unit === 'string' ? op.unit : null
      if (!qty || !unit) continue
      byItem.set(newId, {
        inventory_item_id: newId,
        qty,
        unit,
        loss_pct: typeof op.loss_pct === 'number' && Number.isFinite(op.loss_pct) ? op.loss_pct : 0
      })
    }
  }

  return [...byItem.values()]
}

function extractSellableKey(row: { square_catalog_object_id: string; metadata: unknown }): string {
  if (row.metadata && typeof row.metadata === 'object') {
    const meta = row.metadata as Record<string, unknown>
    if (typeof meta.variation_id === 'string' && meta.variation_id) return meta.variation_id
    if (typeof meta.original_catalog_object_id === 'string' && meta.original_catalog_object_id) return meta.original_catalog_object_id
  }
  return row.square_catalog_object_id
}

function extractModifiers(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return []
  const meta = metadata as Record<string, unknown>
  const mods = meta.modifiers
  if (!Array.isArray(mods)) return []
  return mods.flatMap(mod => {
    if (!mod || typeof mod !== 'object') return []
    const m = mod as Record<string, unknown>
    const id = typeof m.catalog_object_id === 'string' ? m.catalog_object_id : null
    if (!id) return []
    const name = typeof m.name === 'string' ? m.name : null
    const quantity = typeof m.quantity === 'string' ? Number(m.quantity) : typeof m.quantity === 'number' ? m.quantity : 1
    const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
    return [{ square_modifier_id: id, name, quantity: qty }]
  })
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const url = new URL(request.url)
  const start = parseIso(url.searchParams.get('start_at'))
  const end = parseIso(url.searchParams.get('end_at'))
  const includeTheoretical = parseBool(url.searchParams.get('include_theoretical'), true)
  if (!start || !end) {
    return NextResponse.json({ error: 'start_at and end_at are required ISO dates' }, { status: 400 })
  }
  if (end <= start) {
    return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 })
  }

  // Get tenant ID from cookie
  const cookieStore = await cookies()
  const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'

  const supabase = createServiceClient()

  const { data: priorPeriods, error: priorError } = await supabase
    .from('cogs_periods')
    .select('id, end_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'closed')
    .lt('end_at', start.toISOString())
    .order('end_at', { ascending: false })
    .limit(1)

  if (priorError) {
    return NextResponse.json({ error: priorError.message }, { status: 500 })
  }

  const priorPeriodId = priorPeriods?.[0]?.id ?? null
  let beginInventoryValue = 0
  if (priorPeriodId) {
    const { data: report, error: reportError } = await supabase
      .from('cogs_reports')
      .select('end_inventory_value')
      .eq('tenant_id', tenantId)
      .eq('period_id', priorPeriodId)
      .maybeSingle()
    if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 })
    beginInventoryValue = roundMoney(Number(report?.end_inventory_value ?? 0))
  }

  const { data: inventoryItems, error: invError } = await supabase
    .from('inventory_items')
    .select('current_stock, unit_cost')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)

  if (invError) return NextResponse.json({ error: invError.message }, { status: 500 })

  const endInventoryValue = roundMoney((inventoryItems ?? []).reduce((sum, item) => {
    const qty = Number(item.current_stock ?? 0)
    const unitCost = Number(item.unit_cost ?? 0)
    return sum + qty * unitCost
  }, 0))

  const { data: invoices, error: invoiceError } = await supabase
    .from('invoices')
    .select('total_amount, invoice_date, confirmed_at, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')

  if (invoiceError) return NextResponse.json({ error: invoiceError.message }, { status: 500 })

  let purchasesValue = 0
  for (const inv of invoices ?? []) {
    const confirmedAt = inv.confirmed_at ? new Date(inv.confirmed_at) : null
    const invoiceDate = inv.invoice_date ? new Date(`${inv.invoice_date}T00:00:00.000Z`) : null
    const dateForRange = confirmedAt ?? invoiceDate
    if (!dateForRange || Number.isNaN(dateForRange.getTime())) continue
    if (dateForRange >= start && dateForRange <= end) {
      purchasesValue += Number(inv.total_amount ?? 0)
    }
  }
  purchasesValue = roundMoney(purchasesValue)

  const periodicCogsValue = roundMoney(beginInventoryValue + purchasesValue - endInventoryValue)

  if (!includeTheoretical) {
    return NextResponse.json({
      periodic: {
        beginInventoryValue,
        purchasesValue,
        endInventoryValue,
        periodicCogsValue
      },
      inputs: {
        invoices_method: 'confirmed_at_or_invoice_date',
        inventory_method: 'current_stock_live',
        begin_inventory_source: priorPeriodId ? 'prior_closed_period' : 'zero'
      }
    })
  }

  const startIso = start.toISOString()
  const endIso = end.toISOString()

  const { data: txs, error: txError } = await supabase
    .from('sales_transactions')
    .select('id, ordered_at')
    .eq('tenant_id', tenantId)
    .gte('ordered_at', startIso)
    .lte('ordered_at', endIso)

  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 })

  const txIds = (txs ?? []).map(t => t.id)
  const orderedAtByTxId = new Map<string, string>()
  for (const t of txs ?? []) {
    orderedAtByTxId.set(t.id, t.ordered_at)
  }

  let theoreticalCogsValue = 0
  let salesLines = 0
  let mappedSalesLines = 0
  let salesLinesWithRecipe = 0
  let modifiersSeen = 0
  let mappedModifiers = 0
  let modifiersWithRecipe = 0
  let missingCostLines = 0
  let unitConversionIssues = 0
  let wasteCostValue = 0

  if (txIds.length > 0) {
    const items: Array<{
      transaction_id: string
      square_catalog_object_id: string
      name: string
      quantity: number
      metadata: unknown
    }> = []

    const chunkSize = 200
    for (let i = 0; i < txIds.length; i += chunkSize) {
      const chunk = txIds.slice(i, i + chunkSize)
      const { data: chunkItems, error: itemsError } = await supabase
        .from('sales_transaction_items')
        .select('transaction_id, square_catalog_object_id, name, quantity, metadata')
        .in('transaction_id', chunk)

      if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })
      for (const row of chunkItems ?? []) {
        items.push(row as unknown as (typeof items)[number])
      }
    }

    salesLines = items.length

    const { data: sellablesData, error: sellablesError } = await supabase
      .from('cogs_sellables')
      .select('id, square_variation_id, product_id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
    if (sellablesError) return NextResponse.json({ error: sellablesError.message }, { status: 500 })

    const { data: aliasesData, error: aliasesError } = await supabase
      .from('cogs_sellable_aliases')
      .select('square_variation_id, sellable_id, valid_from, valid_to')
      .eq('tenant_id', tenantId)
    if (aliasesError) return NextResponse.json({ error: aliasesError.message }, { status: 500 })

    const sellableByVariation = new Map<string, { id: string; product_id: string; name: string }>()
    for (const s of sellablesData ?? []) {
      sellableByVariation.set(s.square_variation_id, { id: s.id, product_id: s.product_id, name: s.name })
    }
    const aliasToSellableId = new Map<string, string>()
    for (const a of aliasesData ?? []) {
      if (a.square_variation_id && a.sellable_id) aliasToSellableId.set(a.square_variation_id, a.sellable_id)
    }

    const sellableById = new Map<string, { id: string; product_id: string; name: string }>()
    for (const s of sellablesData ?? []) {
      sellableById.set(s.id, { id: s.id, product_id: s.product_id, name: s.name })
    }

    const productIds = [...new Set((sellablesData ?? []).map(s => s.product_id))]
    const sellableIds = [...new Set((sellablesData ?? []).map(s => s.id))]

    const { data: productRecipes, error: recipesError } = await supabase
      .from('cogs_product_recipes')
      .select('id, product_id, effective_from, effective_to, yield_qty, yield_unit')
      .eq('tenant_id', tenantId)
      .in('product_id', productIds.length ? productIds : ['00000000-0000-0000-0000-000000000000'])
    if (recipesError) return NextResponse.json({ error: recipesError.message }, { status: 500 })

    const recipeIds = (productRecipes ?? []).map(r => r.id)
    const { data: recipeLinesData, error: linesError } = await supabase
      .from('cogs_product_recipe_lines')
      .select('recipe_id, inventory_item_id, qty, unit, loss_pct')
      .in('recipe_id', recipeIds.length ? recipeIds : ['00000000-0000-0000-0000-000000000000'])
    if (linesError) return NextResponse.json({ error: linesError.message }, { status: 500 })

    const recipesByProduct = new Map<string, Array<{ id: string; effective_from: string; effective_to: string | null; yield_qty: number; yield_unit: string }>>()
    for (const r of productRecipes ?? []) {
      const list = recipesByProduct.get(r.product_id) ?? []
      list.push({ id: r.id, effective_from: r.effective_from, effective_to: r.effective_to ?? null, yield_qty: Number(r.yield_qty ?? 1), yield_unit: r.yield_unit ?? 'each' })
      recipesByProduct.set(r.product_id, list)
    }

    const linesByRecipeId = new Map<string, RecipeLine[]>()
    for (const l of recipeLinesData ?? []) {
      const list = linesByRecipeId.get(l.recipe_id) ?? []
      list.push({
        inventory_item_id: l.inventory_item_id,
        qty: Number(l.qty ?? 0),
        unit: String(l.unit ?? 'each'),
        loss_pct: Number(l.loss_pct ?? 0)
      })
      linesByRecipeId.set(l.recipe_id, list)
    }

    const { data: overrides, error: overridesError } = await supabase
      .from('cogs_sellable_recipe_overrides')
      .select('id, sellable_id, effective_from, effective_to')
      .eq('tenant_id', tenantId)
      .in('sellable_id', sellableIds.length ? sellableIds : ['00000000-0000-0000-0000-000000000000'])
    if (overridesError) return NextResponse.json({ error: overridesError.message }, { status: 500 })

    const overrideIds = (overrides ?? []).map(o => o.id)
    const { data: opsData, error: opsError } = await supabase
      .from('cogs_sellable_recipe_override_ops')
      .select('override_id, op_type, target_inventory_item_id, new_inventory_item_id, qty, unit, multiplier, loss_pct, created_at')
      .in('override_id', overrideIds.length ? overrideIds : ['00000000-0000-0000-0000-000000000000'])
    if (opsError) return NextResponse.json({ error: opsError.message }, { status: 500 })

    const overridesBySellable = new Map<string, Array<{ id: string; effective_from: string; effective_to: string | null }>>()
    for (const o of overrides ?? []) {
      const list = overridesBySellable.get(o.sellable_id) ?? []
      list.push({ id: o.id, effective_from: o.effective_from, effective_to: o.effective_to ?? null })
      overridesBySellable.set(o.sellable_id, list)
    }

    const opsByOverrideId = new Map<string, OverrideOp[]>()
    for (const op of opsData ?? []) {
      const list = opsByOverrideId.get(op.override_id) ?? []
      list.push({
        op_type: op.op_type as OverrideOpType,
        target_inventory_item_id: op.target_inventory_item_id ?? null,
        new_inventory_item_id: op.new_inventory_item_id ?? null,
        qty: op.qty !== null && op.qty !== undefined ? Number(op.qty) : null,
        unit: op.unit ?? null,
        multiplier: op.multiplier !== null && op.multiplier !== undefined ? Number(op.multiplier) : null,
        loss_pct: op.loss_pct !== null && op.loss_pct !== undefined ? Number(op.loss_pct) : null,
        created_at: op.created_at
      })
      opsByOverrideId.set(op.override_id, list)
    }

    const { data: modifierOptionsData, error: modifierOptionsError } = await supabase
      .from('cogs_modifier_options')
      .select('id, square_modifier_id, name')
      .eq('tenant_id', tenantId)
    if (modifierOptionsError) return NextResponse.json({ error: modifierOptionsError.message }, { status: 500 })

    const modifierOptionBySquareId = new Map<string, { id: string; name: string }>()
    for (const mo of modifierOptionsData ?? []) {
      modifierOptionBySquareId.set(mo.square_modifier_id, { id: mo.id, name: mo.name })
    }

    const modifierOptionIds = [...new Set((modifierOptionsData ?? []).map(m => m.id))]
    const { data: modRecipes, error: modRecipesError } = await supabase
      .from('cogs_modifier_option_recipes')
      .select('id, modifier_option_id, effective_from, effective_to')
      .eq('tenant_id', tenantId)
      .in('modifier_option_id', modifierOptionIds.length ? modifierOptionIds : ['00000000-0000-0000-0000-000000000000'])
    if (modRecipesError) return NextResponse.json({ error: modRecipesError.message }, { status: 500 })

    const modRecipeIds = (modRecipes ?? []).map(r => r.id)
    const { data: modRecipeLines, error: modLinesError } = await supabase
      .from('cogs_modifier_option_recipe_lines')
      .select('recipe_id, inventory_item_id, qty, unit, loss_pct')
      .in('recipe_id', modRecipeIds.length ? modRecipeIds : ['00000000-0000-0000-0000-000000000000'])
    if (modLinesError) return NextResponse.json({ error: modLinesError.message }, { status: 500 })

    const modRecipesByOption = new Map<string, Array<{ id: string; effective_from: string; effective_to: string | null }>>()
    for (const r of modRecipes ?? []) {
      const list = modRecipesByOption.get(r.modifier_option_id) ?? []
      list.push({ id: r.id, effective_from: r.effective_from, effective_to: r.effective_to ?? null })
      modRecipesByOption.set(r.modifier_option_id, list)
    }

    const modLinesByRecipe = new Map<string, RecipeLine[]>()
    for (const l of modRecipeLines ?? []) {
      const list = modLinesByRecipe.get(l.recipe_id) ?? []
      list.push({
        inventory_item_id: l.inventory_item_id,
        qty: Number(l.qty ?? 0),
        unit: String(l.unit ?? 'each'),
        loss_pct: Number(l.loss_pct ?? 0)
      })
      modLinesByRecipe.set(l.recipe_id, list)
    }

    const inventoryItemIds = new Set<string>()
    for (const lines of linesByRecipeId.values()) {
      for (const l of lines) inventoryItemIds.add(l.inventory_item_id)
    }
    for (const lines of modLinesByRecipe.values()) {
      for (const l of lines) inventoryItemIds.add(l.inventory_item_id)
    }
    for (const ops of opsByOverrideId.values()) {
      for (const op of ops) {
        if (op.target_inventory_item_id) inventoryItemIds.add(op.target_inventory_item_id)
        if (op.new_inventory_item_id) inventoryItemIds.add(op.new_inventory_item_id)
      }
    }

    const invIds = [...inventoryItemIds]
    const invRows: Array<{ id: string; unit_cost: number; unit_type: string }> = []
    for (let i = 0; i < invIds.length; i += 200) {
      const chunk = invIds.slice(i, i + 200)
      const { data: chunkInv, error: invErr2 } = await supabase
        .from('inventory_items')
        .select('id, unit_cost, unit_type')
        .eq('tenant_id', tenantId)
        .in('id', chunk)
      if (invErr2) return NextResponse.json({ error: invErr2.message }, { status: 500 })
      for (const row of chunkInv ?? []) invRows.push(row as unknown as (typeof invRows)[number])
    }

    const invById = new Map<string, { unit_cost: number; unit_type: Unit | null }>()
    for (const r of invRows) {
      invById.set(r.id, { unit_cost: Number(r.unit_cost ?? 0), unit_type: toUnit(r.unit_type) })
    }

    function resolveEffective<T extends { effective_from: string; effective_to: string | null; id: string }>(list: T[] | undefined, at: Date): T | null {
      if (!list || list.length === 0) return null
      const atMs = at.getTime()
      let best: T | null = null
      for (const r of list) {
        const from = new Date(r.effective_from).getTime()
        const to = r.effective_to ? new Date(r.effective_to).getTime() : null
        if (Number.isNaN(from)) continue
        if (from > atMs) continue
        if (to !== null && atMs >= to) continue
        if (!best) {
          best = r
          continue
        }
        const bestFrom = new Date(best.effective_from).getTime()
        if (from > bestFrom) best = r
      }
      return best
    }

    for (const item of items) {
      const orderedAtIso = orderedAtByTxId.get(item.transaction_id) ?? null
      const at = orderedAtIso ? new Date(orderedAtIso) : null
      if (!at || Number.isNaN(at.getTime())) continue

      const sellableKey = extractSellableKey(item)
      const mappedSellable = sellableByVariation.get(sellableKey)
        ?? (aliasToSellableId.get(sellableKey) ? sellableById.get(aliasToSellableId.get(sellableKey) as string) : undefined)
        ?? null

      const soldQty = Number(item.quantity ?? 0)
      if (!Number.isFinite(soldQty) || soldQty <= 0) continue

      if (mappedSellable) mappedSalesLines += 1

      const modifiers = extractModifiers(item.metadata)
      modifiersSeen += modifiers.length

      let baseLines: RecipeLine[] = []
      let yieldQty = 1
      let yieldUnit: Unit | null = null

      if (mappedSellable) {
        const recipe = resolveEffective(recipesByProduct.get(mappedSellable.product_id), at)
        if (recipe) {
          yieldQty = Number(recipe.yield_qty ?? 1)
          yieldUnit = toUnit(recipe.yield_unit)
          const rawLines = linesByRecipeId.get(recipe.id) ?? []
          baseLines = rawLines.filter(l => Number.isFinite(l.qty) && l.qty > 0)
          salesLinesWithRecipe += 1
        }
      }

      let effectiveLines = baseLines

      if (mappedSellable) {
        const override = resolveEffective(overridesBySellable.get(mappedSellable.id), at)
        if (override) {
          const ops = opsByOverrideId.get(override.id) ?? []
          effectiveLines = applyOverrideOps(effectiveLines, ops)
        }
      }

      const perUnitFactor = yieldQty > 0 ? 1 / yieldQty : 1
      if (yieldUnit && yieldUnit !== 'each') {
        unitConversionIssues += 1
      }

      for (const line of effectiveLines) {
        const inv = invById.get(line.inventory_item_id)
        const invUnit = inv?.unit_type
        const recipeUnit = toUnit(line.unit)
        if (!inv || !invUnit || !recipeUnit) {
          missingCostLines += 1
          continue
        }
        const rawQty = Number(line.qty ?? 0)
        if (!Number.isFinite(rawQty) || rawQty <= 0) continue
        const withLoss = rawQty * (1 + (Number(line.loss_pct ?? 0) / 100))
        const qtyPerSellable = withLoss * perUnitFactor
        const qtyInRecipeUnit = qtyPerSellable * soldQty
        const qtyInInvUnit = convertQty(qtyInRecipeUnit, recipeUnit, invUnit)
        if (qtyInInvUnit === null) {
          unitConversionIssues += 1
          continue
        }
        theoreticalCogsValue += qtyInInvUnit * inv.unit_cost
      }

      for (const mod of modifiers) {
        const option = modifierOptionBySquareId.get(mod.square_modifier_id) ?? null
        if (!option) continue
        mappedModifiers += 1
        const modRecipe = resolveEffective(modRecipesByOption.get(option.id), at)
        if (!modRecipe) continue
        modifiersWithRecipe += 1
        const modLines = modLinesByRecipe.get(modRecipe.id) ?? []
        for (const line of modLines) {
          const inv = invById.get(line.inventory_item_id)
          const invUnit = inv?.unit_type
          const recipeUnit = toUnit(line.unit)
          if (!inv || !invUnit || !recipeUnit) {
            missingCostLines += 1
            continue
          }
          const rawQty = Number(line.qty ?? 0)
          if (!Number.isFinite(rawQty) || rawQty <= 0) continue
          const withLoss = rawQty * (1 + (Number(line.loss_pct ?? 0) / 100))
          const qtyInRecipeUnit = withLoss * soldQty * mod.quantity
          const qtyInInvUnit = convertQty(qtyInRecipeUnit, recipeUnit, invUnit)
          if (qtyInInvUnit === null) {
            unitConversionIssues += 1
            continue
          }
          theoreticalCogsValue += qtyInInvUnit * inv.unit_cost
        }
      }
    }

    theoreticalCogsValue = roundMoney(theoreticalCogsValue)

    const { data: wasteMoves, error: wasteError } = await supabase
      .from('stock_movements')
      .select('inventory_item_id, quantity_change, unit_cost, created_at, movement_type')
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'waste')
      .gte('created_at', startIso)
      .lte('created_at', endIso)

    if (wasteError) return NextResponse.json({ error: wasteError.message }, { status: 500 })

    for (const move of wasteMoves ?? []) {
      const qty = Number(move.quantity_change ?? 0)
      if (!Number.isFinite(qty) || qty >= 0) continue
      const unitCost = move.unit_cost !== null && move.unit_cost !== undefined
        ? Number(move.unit_cost)
        : Number(invById.get(move.inventory_item_id)?.unit_cost ?? 0)
      wasteCostValue += Math.abs(qty) * unitCost
    }
    wasteCostValue = roundMoney(wasteCostValue)
  }

  const varianceValue = roundMoney(periodicCogsValue - theoreticalCogsValue)

  return NextResponse.json({
    periodic: {
      beginInventoryValue,
      purchasesValue,
      endInventoryValue,
      periodicCogsValue
    },
    theoretical: {
      theoreticalCogsValue,
      wasteCostValue,
      varianceValue,
      coverage: {
        salesLines,
        mappedSalesLines,
        salesLinesWithRecipe,
        modifiersSeen,
        mappedModifiers,
        modifiersWithRecipe,
        missingCostLines,
        unitConversionIssues
      }
    },
    inputs: {
      invoices_method: 'confirmed_at_or_invoice_date',
      inventory_method: 'current_stock_live',
      begin_inventory_source: priorPeriodId ? 'prior_closed_period' : 'zero'
    }
  })
}
