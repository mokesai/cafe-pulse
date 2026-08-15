'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'

type PeriodType = 'weekly' | 'monthly' | 'annual' | 'custom'
type PeriodStatus = 'open' | 'closed'

type CogsPeriod = {
  id: string
  period_type: PeriodType
  start_at: string
  end_at: string
  status: PeriodStatus
  closed_at: string | null
  notes: string | null
  created_at: string
}

type PeriodicPreview = {
  beginInventoryValue: number
  purchasesValue: number
  endInventoryValue: number
  periodicCogsValue: number
}

type TheoreticalPreview = {
  theoreticalCogsValue: number
  wasteCostValue: number
  varianceValue: number
  coverage: {
    salesLines: number
    mappedSalesLines: number
    salesLinesWithRecipe: number
    modifiersSeen: number
    mappedModifiers: number
    modifiersWithRecipe: number
    missingCostLines: number
    unitConversionIssues: number
  }
}

type CogsReportPreview = {
  periodic: PeriodicPreview
  theoretical: TheoreticalPreview | null
}

type CogsProduct = {
  id: string
  square_item_id: string
  name: string
  category: string | null
  is_active: boolean
  product_code?: string | null
}

type CogsSellable = {
  id: string
  square_variation_id: string
  product_id: string
  name: string
  is_active: boolean
  cogs_products?: { name?: string | null; square_item_id?: string | null }[] | { name?: string | null; square_item_id?: string | null } | null
}

type InventoryItem = {
  id: string
  item_name: string
  unit_type: string
  deleted_at: string | null
}

type ProductRecipe = {
  id: string
  product_id: string
  version: number
  effective_from: string
  effective_to: string | null
  yield_qty: number
  yield_unit: string
  notes: string | null
  created_at: string
  cogs_products?: { name?: string | null; square_item_id?: string | null }[] | { name?: string | null; square_item_id?: string | null } | null
}

type ProductRecipeLine = {
  id?: string
  inventory_item_id: string
  qty: number
  unit: string
  loss_pct: number
  inventory_items?: { item_name?: string | null; unit_type?: string | null }[] | { item_name?: string | null; unit_type?: string | null } | null
}

type SellableOverride = {
  id: string
  sellable_id: string
  version: number
  effective_from: string
  effective_to: string | null
  notes: string | null
  created_at: string
}

type OverrideOpType = 'add' | 'remove' | 'replace' | 'multiplier'

type SellableOverrideOp = {
  id?: string
  op_type: OverrideOpType
  target_inventory_item_id: string | null
  new_inventory_item_id: string | null
  qty: number | null
  unit: string | null
  multiplier: number | null
  loss_pct: number | null
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function toDateInputValue(iso: string) {
  return iso.slice(0, 10)
}

function startOfCurrentMonth() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0))
}

function endOfCurrentMonth() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59))
}

function toInventoryItem(value: unknown): InventoryItem | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.item_name !== 'string' || typeof record.unit_type !== 'string') {
    return null
  }
  return {
    id: record.id,
    item_name: record.item_name,
    unit_type: record.unit_type,
    deleted_at: typeof record.deleted_at === 'string' ? record.deleted_at : null,
  }
}

export default function COGSManagement() {
  const [activeTab, setActiveTab] = useState<'periods' | 'catalog' | 'recipes' | 'modifiers'>('periods')
  const [periods, setPeriods] = useState<CogsPeriod[]>([])
  const [loadingPeriods, setLoadingPeriods] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [periodType, setPeriodType] = useState<PeriodType>('monthly')
  const [startAt, setStartAt] = useState(() => startOfCurrentMonth().toISOString())
  const [endAt, setEndAt] = useState(() => endOfCurrentMonth().toISOString())
  const [notes, setNotes] = useState('')

  const [preview, setPreview] = useState<CogsReportPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const [closing, setClosing] = useState(false)

  const [products, setProducts] = useState<CogsProduct[]>([])
  const [sellables, setSellables] = useState<CogsSellable[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [recipes, setRecipes] = useState<ProductRecipe[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [syncingSquareCatalog, setSyncingSquareCatalog] = useState(false)
  const [loadingRecipes, setLoadingRecipes] = useState(false)
  const [loadingModifiers, setLoadingModifiers] = useState(false)

  const [modifierSets, setModifierSets] = useState<Array<{ id: string; square_modifier_list_id: string; name: string }>>([])
  const [modifierOptions, setModifierOptions] = useState<Array<{ id: string; modifier_set_id: string; square_modifier_id: string; name: string }>>([])
  const [modifierOptionRecipes, setModifierOptionRecipes] = useState<Array<{ id: string; modifier_option_id: string; effective_from: string; effective_to: string | null; notes: string | null }>>([])
  const [modifiersSeen, setModifiersSeen] = useState<Array<{ square_modifier_id: string; name: string | null; count: number }>>([])

  const [newModifierSet, setNewModifierSet] = useState({ square_modifier_list_id: '', name: '' })
  const [newModifierOption, setNewModifierOption] = useState({ modifier_set_id: '', square_modifier_id: '', name: '' })

  const [newModifierRecipe, setNewModifierRecipe] = useState({
    modifier_option_id: '',
    effective_from: new Date().toISOString(),
    notes: '',
  })
  const [modifierRecipeLines, setModifierRecipeLines] = useState<Array<{ inventory_item_id: string; qty: number; unit: string; loss_pct: number }>>([
    { inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 },
  ])

  const [editModifierRecipeOpen, setEditModifierRecipeOpen] = useState(false)
  const [editModifierRecipeLoading, setEditModifierRecipeLoading] = useState(false)
  const [editModifierRecipeId, setEditModifierRecipeId] = useState<string | null>(null)
  const [editModifierRecipeHeader, setEditModifierRecipeHeader] = useState<{ effective_from: string; effective_to: string | null; notes: string }>({ effective_from: new Date().toISOString(), effective_to: null, notes: '' })
  const [editModifierRecipeLines, setEditModifierRecipeLines] = useState<Array<{ inventory_item_id: string; qty: number; unit: string; loss_pct: number }>>([{ inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 }])

  const [editRecipeOpen, setEditRecipeOpen] = useState(false)
  const [editRecipeLoading, setEditRecipeLoading] = useState(false)
  const [editRecipeId, setEditRecipeId] = useState<string | null>(null)
  const [editRecipeHeader, setEditRecipeHeader] = useState<{
    product_id: string
    effective_from: string
    effective_to: string | null
    yield_qty: number
    yield_unit: string
    notes: string
  } | null>(null)
  const [editRecipeLines, setEditRecipeLines] = useState<ProductRecipeLine[]>([])

  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideLoading, setOverrideLoading] = useState(false)
  const [overrideSellable, setOverrideSellable] = useState<CogsSellable | null>(null)
  const [sellableOverrides, setSellableOverrides] = useState<SellableOverride[]>([])
  const [activeOverrideId, setActiveOverrideId] = useState<string | null>(null)
  const [overrideHeader, setOverrideHeader] = useState<{ effective_from: string; effective_to: string | null; notes: string }>({
    effective_from: new Date().toISOString(),
    effective_to: null,
    notes: '',
  })
  const [overrideOps, setOverrideOps] = useState<SellableOverrideOp[]>([
    { op_type: 'multiplier', target_inventory_item_id: null, new_inventory_item_id: null, qty: null, unit: null, multiplier: 1.0, loss_pct: null },
  ])

  const [newProduct, setNewProduct] = useState({ square_item_id: '', name: '', category: '' })
  const [newSellable, setNewSellable] = useState({ product_id: '', square_variation_id: '', name: '' })

  const [newRecipe, setNewRecipe] = useState({
    product_id: '',
    effective_from: new Date().toISOString(),
    yield_qty: 1,
    yield_unit: 'each',
    notes: '',
  })
  const [recipeLines, setRecipeLines] = useState<Array<{ inventory_item_id: string; qty: number; unit: string; loss_pct: number }>>([
    { inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 },
  ])

  const [productCodeEdits, setProductCodeEdits] = useState<Record<string, string>>({})

  const startAtDate = useMemo(() => new Date(startAt), [startAt])
  const endAtDate = useMemo(() => new Date(endAt), [endAt])
  const recipeProductIds = useMemo(() => new Set(recipes.map(r => r.product_id)), [recipes])
  const productsMissingRecipe = useMemo(() => products.filter(p => !recipeProductIds.has(p.id)), [products, recipeProductIds])
  const sellablesMissingRecipe = useMemo(() => sellables.filter(s => !recipeProductIds.has(s.product_id)), [sellables, recipeProductIds])

  async function loadPeriods() {
    setLoadingPeriods(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/cogs/periods', { method: 'GET' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to load periods')
      setPeriods(payload.periods || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load periods')
    } finally {
      setLoadingPeriods(false)
    }
  }

  useEffect(() => {
    loadPeriods()
  }, [])

  async function loadCatalog() {
    setLoadingCatalog(true)
    setError(null)
    try {
      const [productsRes, sellablesRes, inventoryRes, recipesRes] = await Promise.all([
        fetch('/api/admin/cogs/products', { method: 'GET' }),
        fetch('/api/admin/cogs/sellables', { method: 'GET' }),
        fetch('/api/admin/inventory', { method: 'GET' }),
        fetch('/api/admin/cogs/product-recipes', { method: 'GET' }),
      ])

      const [productsPayload, sellablesPayload, inventoryPayload, recipesPayload] = await Promise.all([
        productsRes.json(),
        sellablesRes.json(),
        inventoryRes.json(),
        recipesRes.json(),
      ])

      if (!productsRes.ok) throw new Error(productsPayload?.error || 'Failed to load products')
      if (!sellablesRes.ok) throw new Error(sellablesPayload?.error || 'Failed to load sellables')
      if (!inventoryRes.ok) throw new Error(inventoryPayload?.error || 'Failed to load inventory items')
      if (!recipesRes.ok) throw new Error(recipesPayload?.error || 'Failed to load recipes')

      setProducts(productsPayload.products || [])
      const nextEdits: Record<string, string> = {}
      for (const p of productsPayload.products || []) {
        if (p && typeof p.id === 'string') {
          nextEdits[p.id] = typeof p.product_code === 'string' ? p.product_code : ''
        }
      }
      setProductCodeEdits(nextEdits)
      setSellables(sellablesPayload.sellables || [])
      setRecipes(recipesPayload.recipes || [])
      const inventoryList: unknown[] = Array.isArray(inventoryPayload.items) ? inventoryPayload.items : []
      setInventoryItems(inventoryList
        .map(toInventoryItem)
        .filter((item): item is InventoryItem => item !== null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog data')
    } finally {
      setLoadingCatalog(false)
    }
  }

  async function syncCatalogFromSquare() {
    setSyncingSquareCatalog(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/cogs/catalog/sync-square', { method: 'POST' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to sync from Square')
      await loadCatalog()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sync from Square')
    } finally {
      setSyncingSquareCatalog(false)
    }
  }

  async function loadRecipes() {
    setLoadingRecipes(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/cogs/product-recipes', { method: 'GET' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to load recipes')
      setRecipes(payload.recipes || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recipes')
    } finally {
      setLoadingRecipes(false)
    }
  }

  async function openEditRecipe(recipeId: string) {
    setEditRecipeOpen(true)
    setEditRecipeLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cogs/product-recipes/${recipeId}`, { method: 'GET' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to load recipe')

      const recipe = payload.recipe as ProductRecipe
      const linesRaw: unknown[] = Array.isArray(payload.lines) ? payload.lines : []
      const lines: ProductRecipeLine[] = linesRaw
        .filter(l => l && typeof l === 'object')
        .map(l => {
          const r = l as Record<string, unknown>
          return {
            id: typeof r.id === 'string' ? r.id : undefined,
            inventory_item_id: typeof r.inventory_item_id === 'string' ? r.inventory_item_id : '',
            qty: typeof r.qty === 'number' ? r.qty : Number(r.qty),
            unit: typeof r.unit === 'string' ? r.unit : '',
            loss_pct: typeof r.loss_pct === 'number' ? r.loss_pct : Number(r.loss_pct ?? 0),
            inventory_items: r.inventory_items as ProductRecipeLine['inventory_items'],
          }
        })
        .filter(l => l.inventory_item_id)

      setEditRecipeId(recipeId)
      setEditRecipeHeader({
        product_id: recipe.product_id,
        effective_from: recipe.effective_from,
        effective_to: recipe.effective_to,
        yield_qty: recipe.yield_qty,
        yield_unit: recipe.yield_unit,
        notes: recipe.notes || '',
      })
      setEditRecipeLines(lines.length > 0 ? lines : [{ inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recipe')
    } finally {
      setEditRecipeLoading(false)
    }
  }

  async function saveEditedRecipe() {
    if (!editRecipeId || !editRecipeHeader) return
    setEditRecipeLoading(true)
    setError(null)
    try {
      const lines = editRecipeLines
        .filter(l => l.inventory_item_id && Number(l.qty) > 0 && l.unit)
        .map(l => ({
          inventory_item_id: l.inventory_item_id,
          qty: Number(l.qty),
          unit: l.unit,
          loss_pct: Number(l.loss_pct) || 0,
        }))

      const res = await fetch(`/api/admin/cogs/product-recipes/${editRecipeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effective_from: editRecipeHeader.effective_from,
          effective_to: editRecipeHeader.effective_to,
          yield_qty: editRecipeHeader.yield_qty,
          yield_unit: editRecipeHeader.yield_unit,
          notes: editRecipeHeader.notes || null,
          lines,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'Failed to save recipe')

      await loadCatalog()
      await loadRecipes()
      setEditRecipeOpen(false)
      setEditRecipeId(null)
      setEditRecipeHeader(null)
      setEditRecipeLines([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save recipe')
    } finally {
      setEditRecipeLoading(false)
    }
  }

  async function openOverrides(sellable: CogsSellable) {
    setOverrideOpen(true)
    setOverrideSellable(sellable)
    setActiveOverrideId(null)
    setOverrideHeader({ effective_from: new Date().toISOString(), effective_to: null, notes: '' })
    setOverrideOps([{ op_type: 'multiplier', target_inventory_item_id: null, new_inventory_item_id: null, qty: null, unit: null, multiplier: 1.0, loss_pct: null }])
    setOverrideLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cogs/sellable-overrides?sellableId=${encodeURIComponent(sellable.id)}`, { method: 'GET' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to load overrides')
      setSellableOverrides(payload.overrides || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overrides')
    } finally {
      setOverrideLoading(false)
    }
  }

  async function loadOverrideDetails(overrideId: string) {
    setOverrideLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cogs/sellable-overrides/${overrideId}`, { method: 'GET' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to load override')
      setActiveOverrideId(overrideId)
      setOverrideHeader({
        effective_from: payload.override.effective_from,
        effective_to: payload.override.effective_to,
        notes: payload.override.notes || '',
      })
      const opsRaw: unknown[] = Array.isArray(payload.ops) ? payload.ops : []
      const ops: SellableOverrideOp[] = opsRaw
        .filter(o => o && typeof o === 'object')
        .map(o => {
          const r = o as Record<string, unknown>
          return {
            id: typeof r.id === 'string' ? r.id : undefined,
            op_type: r.op_type as OverrideOpType,
            target_inventory_item_id: typeof r.target_inventory_item_id === 'string' ? r.target_inventory_item_id : null,
            new_inventory_item_id: typeof r.new_inventory_item_id === 'string' ? r.new_inventory_item_id : null,
            qty: r.qty === null || r.qty === undefined ? null : Number(r.qty),
            unit: typeof r.unit === 'string' ? r.unit : null,
            multiplier: r.multiplier === null || r.multiplier === undefined ? null : Number(r.multiplier),
            loss_pct: r.loss_pct === null || r.loss_pct === undefined ? null : Number(r.loss_pct),
          }
        })
      setOverrideOps(ops.length > 0 ? ops : [{ op_type: 'multiplier', target_inventory_item_id: null, new_inventory_item_id: null, qty: null, unit: null, multiplier: 1.0, loss_pct: null }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load override')
    } finally {
      setOverrideLoading(false)
    }
  }

  async function saveOverride() {
    if (!overrideSellable) return
    setOverrideLoading(true)
    setError(null)
    try {
      const ops = overrideOps
        .filter(op => op.op_type)
        .map(op => ({
          op_type: op.op_type,
          target_inventory_item_id: op.target_inventory_item_id,
          new_inventory_item_id: op.new_inventory_item_id,
          qty: op.qty,
          unit: op.unit,
          multiplier: op.multiplier,
          loss_pct: op.loss_pct,
        }))

      if (activeOverrideId) {
        const res = await fetch(`/api/admin/cogs/sellable-overrides/${activeOverrideId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            effective_from: overrideHeader.effective_from,
            effective_to: overrideHeader.effective_to,
            notes: overrideHeader.notes || null,
            ops,
          }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload?.error || 'Failed to save override')
      } else {
        const res = await fetch('/api/admin/cogs/sellable-overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sellable_id: overrideSellable.id,
            effective_from: overrideHeader.effective_from,
            effective_to: overrideHeader.effective_to,
            notes: overrideHeader.notes || null,
            ops,
          }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload?.error || 'Failed to create override')
      }

      await openOverrides(overrideSellable)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save override')
    } finally {
      setOverrideLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'catalog') loadCatalog()
    if (activeTab === 'recipes') {
      loadCatalog()
      loadRecipes()
    }
    if (activeTab === 'modifiers') {
      loadCatalog()
      loadModifiers()
    }
  }, [activeTab])

  async function loadModifiers() {
    setLoadingModifiers(true)
    setError(null)
    try {
      const [setsRes, optionsRes, recipesRes, seenRes] = await Promise.all([
        fetch('/api/admin/cogs/modifiers/sets', { method: 'GET' }),
        fetch('/api/admin/cogs/modifiers/options', { method: 'GET' }),
        fetch('/api/admin/cogs/modifier-option-recipes', { method: 'GET' }),
        fetch('/api/admin/cogs/modifiers/seen?days=30&limit=200', { method: 'GET' }),
      ])

      const [setsPayload, optionsPayload, recipesPayload, seenPayload] = await Promise.all([
        setsRes.json(),
        optionsRes.json(),
        recipesRes.json(),
        seenRes.json(),
      ])

      if (!setsRes.ok) throw new Error(setsPayload?.error || 'Failed to load modifier sets')
      if (!optionsRes.ok) throw new Error(optionsPayload?.error || 'Failed to load modifier options')
      if (!recipesRes.ok) throw new Error(recipesPayload?.error || 'Failed to load modifier recipes')
      if (!seenRes.ok) throw new Error(seenPayload?.error || 'Failed to load modifiers seen in sales')

      setModifierSets(setsPayload.modifierSets || [])
      setModifierOptions(optionsPayload.modifierOptions || [])
      setModifierOptionRecipes(recipesPayload.recipes || [])
      setModifiersSeen(seenPayload.seen || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load modifiers')
    } finally {
      setLoadingModifiers(false)
    }
  }

  async function createModifierSet() {
    setError(null)
    try {
      const res = await fetch('/api/admin/cogs/modifiers/sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          square_modifier_list_id: newModifierSet.square_modifier_list_id,
          name: newModifierSet.name,
          is_active: true,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to create modifier set')
      setNewModifierSet({ square_modifier_list_id: '', name: '' })
      await loadModifiers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create modifier set')
    }
  }

  async function createModifierOption() {
    setError(null)
    try {
      const res = await fetch('/api/admin/cogs/modifiers/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modifier_set_id: newModifierOption.modifier_set_id,
          square_modifier_id: newModifierOption.square_modifier_id,
          name: newModifierOption.name,
          is_active: true,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to create modifier option')
      setNewModifierOption({ modifier_set_id: '', square_modifier_id: '', name: '' })
      await loadModifiers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create modifier option')
    }
  }

  async function createModifierRecipe() {
    setError(null)
    try {
      const lines = modifierRecipeLines
        .filter(l => l.inventory_item_id && Number(l.qty) > 0 && l.unit)
        .map(l => ({
          inventory_item_id: l.inventory_item_id,
          qty: Number(l.qty),
          unit: l.unit,
          loss_pct: Number(l.loss_pct) || 0,
        }))

      const res = await fetch('/api/admin/cogs/modifier-option-recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modifier_option_id: newModifierRecipe.modifier_option_id,
          effective_from: new Date(newModifierRecipe.effective_from).toISOString(),
          effective_to: null,
          notes: newModifierRecipe.notes || null,
          lines,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to create modifier recipe')
      setNewModifierRecipe({ modifier_option_id: '', effective_from: new Date().toISOString(), notes: '' })
      setModifierRecipeLines([{ inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 }])
      await loadModifiers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create modifier recipe')
    }
  }

  async function openEditModifierRecipe(recipeId: string) {
    setEditModifierRecipeOpen(true)
    setEditModifierRecipeLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cogs/modifier-option-recipes/${recipeId}`, { method: 'GET' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to load modifier recipe')

      setEditModifierRecipeId(recipeId)
      setEditModifierRecipeHeader({
        effective_from: payload.recipe.effective_from,
        effective_to: payload.recipe.effective_to,
        notes: payload.recipe.notes || '',
      })

      const linesRaw: unknown[] = Array.isArray(payload.lines) ? payload.lines : []
      const lines = linesRaw
        .filter(l => l && typeof l === 'object')
        .map(l => {
          const r = l as Record<string, unknown>
          return {
            inventory_item_id: typeof r.inventory_item_id === 'string' ? r.inventory_item_id : '',
            qty: typeof r.qty === 'number' ? r.qty : Number(r.qty),
            unit: typeof r.unit === 'string' ? r.unit : '',
            loss_pct: typeof r.loss_pct === 'number' ? r.loss_pct : Number(r.loss_pct ?? 0),
          }
        })
        .filter(l => l.inventory_item_id)

      setEditModifierRecipeLines(lines.length > 0 ? lines : [{ inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load modifier recipe')
    } finally {
      setEditModifierRecipeLoading(false)
    }
  }

  async function saveEditModifierRecipe() {
    if (!editModifierRecipeId) return
    setEditModifierRecipeLoading(true)
    setError(null)
    try {
      const lines = editModifierRecipeLines
        .filter(l => l.inventory_item_id && Number(l.qty) > 0 && l.unit)
        .map(l => ({
          inventory_item_id: l.inventory_item_id,
          qty: Number(l.qty),
          unit: l.unit,
          loss_pct: Number(l.loss_pct) || 0,
        }))

      const res = await fetch(`/api/admin/cogs/modifier-option-recipes/${editModifierRecipeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effective_from: editModifierRecipeHeader.effective_from,
          effective_to: editModifierRecipeHeader.effective_to,
          notes: editModifierRecipeHeader.notes || null,
          lines,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'Failed to save modifier recipe')
      setEditModifierRecipeOpen(false)
      setEditModifierRecipeId(null)
      await loadModifiers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save modifier recipe')
    } finally {
      setEditModifierRecipeLoading(false)
    }
  }

  async function runPreview() {
    setLoadingPreview(true)
    setError(null)
    setPreview(null)
    try {
      const params = new URLSearchParams({
        start_at: startAtDate.toISOString(),
        end_at: endAtDate.toISOString(),
        include_theoretical: '1',
      })
      const res = await fetch(`/api/admin/cogs/report?${params.toString()}`, { method: 'GET' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to compute preview')
      setPreview({
        periodic: payload.periodic,
        theoretical: payload.theoretical ?? null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute preview')
    } finally {
      setLoadingPreview(false)
    }
  }

  async function createAndClosePeriod() {
    setClosing(true)
    setError(null)
    try {
      const createRes = await fetch('/api/admin/cogs/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_type: periodType,
          start_at: startAtDate.toISOString(),
          end_at: endAtDate.toISOString(),
          notes: notes.trim() ? notes.trim() : null,
        }),
      })
      const createPayload = await createRes.json()
      if (!createRes.ok) throw new Error(createPayload?.error || 'Failed to create period')

      const periodId: string = createPayload.period?.id
      if (!periodId) throw new Error('Created period is missing an id')

      const closeRes = await fetch(`/api/admin/cogs/periods/${periodId}/close`, { method: 'POST' })
      const closePayload = await closeRes.json()
      if (!closeRes.ok) throw new Error(closePayload?.error || 'Failed to close period')

      await loadPeriods()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close period')
    } finally {
      setClosing(false)
    }
  }

  async function createProduct() {
    setError(null)
    try {
      const res = await fetch('/api/admin/cogs/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          square_item_id: newProduct.square_item_id,
          name: newProduct.name,
          category: newProduct.category || null,
          is_active: true,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to create product')
      setNewProduct({ square_item_id: '', name: '', category: '' })
      await loadCatalog()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create product')
    }
  }

  async function saveProductCode(productId: string) {
    setError(null)
    try {
      const nextCode = (productCodeEdits[productId] ?? '').trim()
      const res = await fetch(`/api/admin/cogs/products/${encodeURIComponent(productId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_code: nextCode ? nextCode : null }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'Failed to update product code')
      await loadCatalog()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update product code')
    }
  }

  async function createSellable() {
    setError(null)
    try {
      const res = await fetch('/api/admin/cogs/sellables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: newSellable.product_id,
          square_variation_id: newSellable.square_variation_id,
          name: newSellable.name,
          is_active: true,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to create sellable')
      setNewSellable({ product_id: '', square_variation_id: '', name: '' })
      await loadCatalog()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create sellable')
    }
  }

  async function createRecipe() {
    setError(null)
    try {
      const lines = recipeLines
        .filter(l => l.inventory_item_id && Number(l.qty) > 0 && l.unit)
        .map(l => ({
          inventory_item_id: l.inventory_item_id,
          qty: Number(l.qty),
          unit: l.unit,
          loss_pct: Number(l.loss_pct) || 0,
        }))

      const res = await fetch('/api/admin/cogs/product-recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: newRecipe.product_id,
          effective_from: new Date(newRecipe.effective_from).toISOString(),
          effective_to: null,
          yield_qty: Number(newRecipe.yield_qty),
          yield_unit: newRecipe.yield_unit,
          notes: newRecipe.notes || null,
          lines,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to create recipe')
      setNewRecipe({
        product_id: '',
        effective_from: new Date().toISOString(),
        yield_qty: 1,
        yield_unit: 'each',
        notes: '',
      })
      setRecipeLines([{ inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 }])
      await loadRecipes()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create recipe')
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">COGS Reporting</h1>
          <p className="text-gray-600">
            Periodic (inventory-based) and theoretical (recipe-based) cost of goods sold.
          </p>
        </div>
        <button
          type="button"
          onClick={loadPeriods}
          className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
          disabled={loadingPeriods}
        >
          <RefreshCw className={loadingPeriods ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={activeTab === 'periods'
            ? 'rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white'
            : 'rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50'
          }
          onClick={() => setActiveTab('periods')}
        >
          Periods
        </button>
        <button
          type="button"
          className={activeTab === 'catalog'
            ? 'rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white'
            : 'rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50'
          }
          onClick={() => setActiveTab('catalog')}
        >
          Catalog
        </button>
        <button
          type="button"
          className={activeTab === 'modifiers'
            ? 'rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white'
            : 'rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50'
          }
          onClick={() => setActiveTab('modifiers')}
        >
          Modifiers
        </button>
        <button
          type="button"
          className={activeTab === 'recipes'
            ? 'rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white'
            : 'rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50'
          }
          onClick={() => setActiveTab('recipes')}
        >
          Base Recipes
        </button>
      </div>

      {activeTab === 'periods' && (
        <>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Preview + Close Period</h2>
        <p className="mt-1 text-sm text-gray-600">
          Preview uses current inventory on hand. Closing a period snapshots inventory and stores the report.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Period Type</label>
            <select
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              value={periodType}
              onChange={e => setPeriodType(e.target.value as PeriodType)}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Start</label>
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={toDateInputValue(startAt)}
              onChange={e => setStartAt(new Date(`${e.target.value}T00:00:00.000Z`).toISOString())}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">End</label>
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={toDateInputValue(endAt)}
              onChange={e => setEndAt(new Date(`${e.target.value}T23:59:59.000Z`).toISOString())}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Optional"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={runPreview}
            disabled={loadingPreview}
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {loadingPreview ? 'Computing…' : 'Preview Periodic COGS'}
          </button>
          <button
            type="button"
            onClick={createAndClosePeriod}
            disabled={closing}
            className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {closing ? 'Closing…' : 'Create + Close Period'}
          </button>
        </div>

        {preview?.periodic && (
          <div className="mt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-md bg-gray-50 p-4">
              <div className="text-xs text-gray-500">Begin Inventory</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(preview.periodic.beginInventoryValue)}</div>
            </div>
            <div className="rounded-md bg-gray-50 p-4">
              <div className="text-xs text-gray-500">Purchases</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(preview.periodic.purchasesValue)}</div>
            </div>
            <div className="rounded-md bg-gray-50 p-4">
              <div className="text-xs text-gray-500">End Inventory (Live)</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(preview.periodic.endInventoryValue)}</div>
            </div>
            <div className="rounded-md bg-gray-50 p-4">
              <div className="text-xs text-gray-500">Periodic COGS</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(preview.periodic.periodicCogsValue)}</div>
            </div>
          </div>
          {preview.theoretical && (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md bg-gray-50 p-4">
                <div className="text-xs text-gray-500">Theoretical COGS (recipes + modifiers)</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(preview.theoretical.theoreticalCogsValue)}</div>
              </div>
              <div className="rounded-md bg-gray-50 p-4">
                <div className="text-xs text-gray-500">Waste (stock movements)</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(preview.theoretical.wasteCostValue)}</div>
              </div>
              <div className="rounded-md bg-gray-50 p-4">
                <div className="text-xs text-gray-500">Variance (Periodic − Theoretical)</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(preview.theoretical.varianceValue)}</div>
              </div>
            </div>
          )}
          {preview.theoretical && (
            <div className="rounded-md bg-white p-4 ring-1 ring-gray-200">
              <div className="text-sm font-semibold text-gray-900">Coverage</div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div><div className="text-xs text-gray-500">Sales lines</div><div className="font-medium">{preview.theoretical.coverage.salesLines}</div></div>
                <div><div className="text-xs text-gray-500">Mapped sellables</div><div className="font-medium">{preview.theoretical.coverage.mappedSalesLines}</div></div>
                <div><div className="text-xs text-gray-500">Lines with base recipe</div><div className="font-medium">{preview.theoretical.coverage.salesLinesWithRecipe}</div></div>
                <div><div className="text-xs text-gray-500">Modifiers seen</div><div className="font-medium">{preview.theoretical.coverage.modifiersSeen}</div></div>
                <div><div className="text-xs text-gray-500">Mapped modifiers</div><div className="font-medium">{preview.theoretical.coverage.mappedModifiers}</div></div>
                <div><div className="text-xs text-gray-500">Modifiers with recipe</div><div className="font-medium">{preview.theoretical.coverage.modifiersWithRecipe}</div></div>
                <div><div className="text-xs text-gray-500">Missing costs</div><div className="font-medium">{preview.theoretical.coverage.missingCostLines}</div></div>
                <div><div className="text-xs text-gray-500">Unit conversion issues</div><div className="font-medium">{preview.theoretical.coverage.unitConversionIssues}</div></div>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Theoretical preview uses `inventory_items.unit_cost` and basic unit conversions (lb/oz, liter/ml, gallon/ml).
              </p>
            </div>
          )}
          </div>
        )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Periods</h2>
          <div className="text-sm text-gray-500">
            {loadingPeriods ? 'Loading…' : `${periods.length} shown`}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2 text-right">Export</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {periods.map(period => (
                <tr key={period.id}>
                  <td className="px-3 py-2 font-medium text-gray-900">{period.period_type}</td>
                  <td className="px-3 py-2 text-gray-700">{new Date(period.start_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-700">{new Date(period.end_at).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={period.status === 'closed'
                      ? 'inline-flex rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-green-700'
                      : 'inline-flex rounded-full bg-yellow-50 px-2 py-1 text-xs font-semibold text-yellow-700'
                    }>
                      {period.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{period.notes || ''}</td>
                  <td className="px-3 py-2 text-right">
                    {period.status === 'closed' ? (
                      <a
                        className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-xs font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
                        href={`/api/admin/cogs/periods/${period.id}/export`}
                      >
                        <Download className="h-4 w-4" />
                        CSV
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {periods.length === 0 && !loadingPeriods && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-500">
                    No periods yet. Create and close your first period above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
        </>
      )}

      {activeTab === 'catalog' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Coverage</h2>
            <p className="mt-1 text-sm text-gray-600">
              Quick checks to keep theoretical COGS trustworthy.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="rounded-md bg-gray-50 p-4">
                <div className="text-xs text-gray-500">Products</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{products.length}</div>
              </div>
              <div className="rounded-md bg-gray-50 p-4">
                <div className="text-xs text-gray-500">Sellables</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{sellables.length}</div>
              </div>
              <div className="rounded-md bg-gray-50 p-4">
                <div className="text-xs text-gray-500">Base Recipes</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{recipes.length}</div>
              </div>
              <div className="rounded-md bg-gray-50 p-4">
                <div className="text-xs text-gray-500">Products Missing Recipe</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{productsMissingRecipe.length}</div>
              </div>
            </div>

            {(productsMissingRecipe.length > 0 || sellablesMissingRecipe.length > 0) && (
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Products missing a base recipe</h3>
                  <ul className="mt-2 max-h-48 overflow-auto rounded-md border border-gray-200 bg-white text-sm">
                    {productsMissingRecipe.slice(0, 50).map(p => (
                      <li key={p.id} className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0">
                        <span className="text-gray-900">{p.name}</span>
                        <span className="text-xs text-gray-500">{p.square_item_id}</span>
                      </li>
                    ))}
                    {productsMissingRecipe.length === 0 && (
                      <li className="px-3 py-2 text-gray-500">All products have base recipes.</li>
                    )}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Sellables whose product has no recipe</h3>
                  <ul className="mt-2 max-h-48 overflow-auto rounded-md border border-gray-200 bg-white text-sm">
                    {sellablesMissingRecipe.slice(0, 50).map(s => (
                      <li key={s.id} className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0">
                        <span className="text-gray-900">{s.name}</span>
                        <span className="text-xs text-gray-500">{s.square_variation_id}</span>
                      </li>
                    ))}
                    {sellablesMissingRecipe.length === 0 && (
                      <li className="px-3 py-2 text-gray-500">All sellables are covered by a product recipe.</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Products (Square ITEM)</h2>
                <p className="mt-1 text-sm text-gray-600">Assign a stable product code, then import recipes from Sheets.</p>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <button
                  type="button"
                  onClick={syncCatalogFromSquare}
                  disabled={syncingSquareCatalog}
                  className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  title="Sync products + sellables from Square"
                >
                  <RefreshCw className={syncingSquareCatalog ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                  {syncingSquareCatalog ? 'Syncing…' : 'Sync from Square'}
                </button>
                <span>{loadingCatalog ? 'Loading…' : `${products.length} products`}</span>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Square ITEM ID</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newProduct.square_item_id}
                  onChange={e => setNewProduct(p => ({ ...p, square_item_id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newProduct.name}
                  onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Category (optional)</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newProduct.category}
                  onChange={e => setNewProduct(p => ({ ...p, category: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={createProduct}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                Add Product
              </button>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Square ITEM ID</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Save</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {products.map(p => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">
                        <input
                          className="w-40 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                          placeholder="LATTE_12OZ"
                          value={productCodeEdits[p.id] ?? ''}
                          onChange={e => setProductCodeEdits(prev => ({ ...prev, [p.id]: e.target.value }))}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{p.name}</td>
                      <td className="px-3 py-2 text-gray-700">{p.square_item_id}</td>
                      <td className="px-3 py-2 text-gray-600">{p.category || ''}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => saveProductCode(p.id)}
                          className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && !loadingCatalog && (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-500">
                        No products yet. Use “Sync from Square” above or add one manually.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Sellables (Square ITEM_VARIATION)</h2>
                <p className="mt-1 text-sm text-gray-600">Sellables map directly to sales line items.</p>
              </div>
              <div className="text-sm text-gray-500">{loadingCatalog ? 'Loading…' : `${sellables.length} sellables`}</div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Product</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={newSellable.product_id}
                  onChange={e => setNewSellable(s => ({ ...s, product_id: e.target.value }))}
                >
                  <option value="">Select a product</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Square VARIATION ID</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newSellable.square_variation_id}
                  onChange={e => setNewSellable(s => ({ ...s, square_variation_id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newSellable.name}
                  onChange={e => setNewSellable(s => ({ ...s, name: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={createSellable}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                Add Sellable
              </button>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Square VARIATION ID</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Overrides</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sellables.map(s => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{s.name}</td>
                      <td className="px-3 py-2 text-gray-700">{s.square_variation_id}</td>
                      <td className="px-3 py-2 text-gray-600">
                        {Array.isArray(s.cogs_products) ? (s.cogs_products[0]?.name ?? '') : (s.cogs_products?.name ?? '')}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => openOverrides(s)}
                          className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sellables.length === 0 && !loadingCatalog && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-sm text-gray-500">
                        No sellables yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'recipes' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Create Product Base Recipe</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Base recipes attach to products and drive theoretical COGS. Overrides come next.
                </p>
              </div>
              <div className="text-sm text-gray-500">{loadingCatalog ? 'Loading…' : `${inventoryItems.length} inventory items`}</div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Product</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={newRecipe.product_id}
                  onChange={e => setNewRecipe(r => ({ ...r, product_id: e.target.value }))}
                >
                  <option value="">Select a product</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {products.length === 0 && !loadingCatalog && (
                  <p className="mt-2 text-xs text-gray-500">
                    No products found. Switch to <button type="button" onClick={() => setActiveTab('catalog')} className="font-semibold text-gray-900 underline">Catalog</button> and sync from Square (or add one manually).
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Effective From</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={toDateInputValue(newRecipe.effective_from)}
                  onChange={e => setNewRecipe(r => ({ ...r, effective_from: new Date(`${e.target.value}T00:00:00.000Z`).toISOString() }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Yield Qty</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newRecipe.yield_qty}
                  onChange={e => setNewRecipe(r => ({ ...r, yield_qty: Number(e.target.value) }))}
                  min={0}
                  step={0.001}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Yield Unit</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newRecipe.yield_unit}
                  onChange={e => setNewRecipe(r => ({ ...r, yield_unit: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
              <input
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={newRecipe.notes}
                onChange={e => setNewRecipe(r => ({ ...r, notes: e.target.value }))}
              />
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Recipe Lines</h3>
                <button
                  type="button"
                  className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                  onClick={() => setRecipeLines(lines => [...lines, { inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 }])}
                >
                  Add Line
                </button>
              </div>

              <div className="mt-3 space-y-3">
                {recipeLines.map((line, idx) => (
                  <div key={idx} className="grid gap-3 md:grid-cols-6">
                    <div className="md:col-span-3">
                      <label className="block text-xs font-medium text-gray-600">Ingredient</label>
                      <select
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        value={line.inventory_item_id}
                        onChange={e => {
                          const selected = inventoryItems.find(i => i.id === e.target.value)
                          setRecipeLines(lines => lines.map((l, i) => i === idx
                            ? { ...l, inventory_item_id: e.target.value, unit: selected?.unit_type || l.unit }
                            : l
                          ))
                        }}
                      >
                        <option value="">Select inventory item</option>
                        {inventoryItems.map(i => (
                          <option key={i.id} value={i.id}>{i.item_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Qty</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.qty}
                        onChange={e => setRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, qty: Number(e.target.value) } : l))}
                        min={0}
                        step={0.001}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Unit</label>
                      <input
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.unit}
                        onChange={e => setRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, unit: e.target.value } : l))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Loss %</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.loss_pct}
                        onChange={e => setRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, loss_pct: Number(e.target.value) } : l))}
                        min={0}
                        max={100}
                        step={0.01}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className="w-full rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                        onClick={() => setRecipeLines(lines => lines.filter((_, i) => i !== idx))}
                        disabled={recipeLines.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={createRecipe}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                >
                  Create Base Recipe
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Existing Product Recipes</h2>
                <p className="mt-1 text-sm text-gray-600">This lists base recipe headers only (lines and overrides next).</p>
              </div>
              <div className="text-sm text-gray-500">{loadingRecipes ? 'Loading…' : `${recipes.length} recipes`}</div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Effective From</th>
                    <th className="px-3 py-2">Yield</th>
                    <th className="px-3 py-2">Notes</th>
                    <th className="px-3 py-2 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recipes.map(r => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {Array.isArray(r.cogs_products) ? (r.cogs_products[0]?.name ?? '') : (r.cogs_products?.name ?? '')}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{new Date(r.effective_from).toLocaleString()}</td>
                      <td className="px-3 py-2 text-gray-700">{r.yield_qty} {r.yield_unit}</td>
                      <td className="px-3 py-2 text-gray-600">{r.notes || ''}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                          onClick={() => openEditRecipe(r.id)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {recipes.length === 0 && !loadingRecipes && (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-500">
                        No recipes yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'modifiers' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Modifiers Seen in Sales</h2>
                <p className="mt-1 text-sm text-gray-600">Captured from `sales_transaction_items.metadata.modifiers` (last 30 days).</p>
              </div>
              <div className="text-sm text-gray-500">{loadingModifiers ? 'Loading…' : `${modifiersSeen.length} modifiers`}</div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Square Modifier ID</th>
                    <th className="px-3 py-2 text-right">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {modifiersSeen.map(m => (
                    <tr key={m.square_modifier_id}>
                      <td className="px-3 py-2 text-gray-900">{m.name || ''}</td>
                      <td className="px-3 py-2 text-gray-700">{m.square_modifier_id}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{m.count}</td>
                    </tr>
                  ))}
                  {modifiersSeen.length === 0 && !loadingModifiers && (
                    <tr>
                      <td colSpan={3} className="px-3 py-10 text-center text-sm text-gray-500">
                        No modifiers found in recent sales (or sales sync has not been re-run since Phase 3).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Modifier Sets</h2>
            <p className="mt-1 text-sm text-gray-600">Create a mapping for Square modifier lists.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Square Modifier List ID</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newModifierSet.square_modifier_list_id}
                  onChange={e => setNewModifierSet(s => ({ ...s, square_modifier_list_id: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newModifierSet.name}
                  onChange={e => setNewModifierSet(s => ({ ...s, name: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={createModifierSet}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                Add Modifier Set
              </button>
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Square List ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {modifierSets.map(s => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{s.name}</td>
                      <td className="px-3 py-2 text-gray-700">{s.square_modifier_list_id}</td>
                    </tr>
                  ))}
                  {modifierSets.length === 0 && !loadingModifiers && (
                    <tr>
                      <td colSpan={2} className="px-3 py-10 text-center text-sm text-gray-500">
                        No modifier sets yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Modifier Options</h2>
            <p className="mt-1 text-sm text-gray-600">Map Square modifier IDs to options.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Modifier Set</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={newModifierOption.modifier_set_id}
                  onChange={e => setNewModifierOption(o => ({ ...o, modifier_set_id: e.target.value }))}
                >
                  <option value="">Select set</option>
                  {modifierSets.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Square Modifier ID</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newModifierOption.square_modifier_id}
                  onChange={e => setNewModifierOption(o => ({ ...o, square_modifier_id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newModifierOption.name}
                  onChange={e => setNewModifierOption(o => ({ ...o, name: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={createModifierOption}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                Add Modifier Option
              </button>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Square Modifier ID</th>
                    <th className="px-3 py-2">Set</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {modifierOptions.map(o => (
                    <tr key={o.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{o.name}</td>
                      <td className="px-3 py-2 text-gray-700">{o.square_modifier_id}</td>
                      <td className="px-3 py-2 text-gray-600">
                        {modifierSets.find(s => s.id === o.modifier_set_id)?.name || ''}
                      </td>
                    </tr>
                  ))}
                  {modifierOptions.length === 0 && !loadingModifiers && (
                    <tr>
                      <td colSpan={3} className="px-3 py-10 text-center text-sm text-gray-500">
                        No modifier options yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Modifier Option Recipes</h2>
            <p className="mt-1 text-sm text-gray-600">Attach ingredient add-ons to a modifier option.</p>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Modifier Option</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={newModifierRecipe.modifier_option_id}
                  onChange={e => setNewModifierRecipe(r => ({ ...r, modifier_option_id: e.target.value }))}
                >
                  <option value="">Select option</option>
                  {modifierOptions.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Effective From</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={toDateInputValue(newModifierRecipe.effective_from)}
                  onChange={e => setNewModifierRecipe(r => ({ ...r, effective_from: new Date(`${e.target.value}T00:00:00.000Z`).toISOString() }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Notes</label>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={newModifierRecipe.notes}
                  onChange={e => setNewModifierRecipe(r => ({ ...r, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Recipe Lines</h3>
                <button
                  type="button"
                  className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                  onClick={() => setModifierRecipeLines(lines => [...lines, { inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 }])}
                >
                  Add Line
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {modifierRecipeLines.map((line, idx) => (
                  <div key={idx} className="grid gap-3 md:grid-cols-6">
                    <div className="md:col-span-3">
                      <label className="block text-xs font-medium text-gray-600">Ingredient</label>
                      <select
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        value={line.inventory_item_id}
                        onChange={e => {
                          const selected = inventoryItems.find(i => i.id === e.target.value)
                          setModifierRecipeLines(lines => lines.map((l, i) => i === idx
                            ? { ...l, inventory_item_id: e.target.value, unit: selected?.unit_type || l.unit }
                            : l
                          ))
                        }}
                      >
                        <option value="">Select inventory item</option>
                        {inventoryItems.map(i => (
                          <option key={i.id} value={i.id}>{i.item_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Qty</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.qty}
                        onChange={e => setModifierRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, qty: Number(e.target.value) } : l))}
                        min={0}
                        step={0.001}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Unit</label>
                      <input
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.unit}
                        onChange={e => setModifierRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, unit: e.target.value } : l))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Loss %</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.loss_pct}
                        onChange={e => setModifierRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, loss_pct: Number(e.target.value) } : l))}
                        min={0}
                        max={100}
                        step={0.01}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className="w-full rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                        onClick={() => setModifierRecipeLines(lines => lines.filter((_, i) => i !== idx))}
                        disabled={modifierRecipeLines.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={createModifierRecipe}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                >
                  Create Modifier Recipe
                </button>
              </div>
            </div>

            <div className="mt-8 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Option</th>
                    <th className="px-3 py-2">Effective From</th>
                    <th className="px-3 py-2">Notes</th>
                    <th className="px-3 py-2 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {modifierOptionRecipes.map(r => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {modifierOptions.find(o => o.id === r.modifier_option_id)?.name || ''}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{new Date(r.effective_from).toLocaleString()}</td>
                      <td className="px-3 py-2 text-gray-600">{r.notes || ''}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                          onClick={() => openEditModifierRecipe(r.id)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {modifierOptionRecipes.length === 0 && !loadingModifiers && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-sm text-gray-500">
                        No modifier option recipes yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {editModifierRecipeOpen && editModifierRecipeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-4xl rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Edit Modifier Option Recipe</h3>
                <p className="text-sm text-gray-600">Updates the recipe header and replaces all lines.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditModifierRecipeOpen(false)}
                className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                disabled={editModifierRecipeLoading}
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Effective From</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={toDateInputValue(editModifierRecipeHeader.effective_from)}
                    onChange={e => setEditModifierRecipeHeader(h => ({ ...h, effective_from: new Date(`${e.target.value}T00:00:00.000Z`).toISOString() }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Effective To (optional)</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={editModifierRecipeHeader.effective_to ? toDateInputValue(editModifierRecipeHeader.effective_to) : ''}
                    onChange={e => setEditModifierRecipeHeader(h => ({
                      ...h,
                      effective_to: e.target.value ? new Date(`${e.target.value}T23:59:59.000Z`).toISOString() : null
                    }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={editModifierRecipeHeader.notes}
                    onChange={e => setEditModifierRecipeHeader(h => ({ ...h, notes: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-900">Lines</h4>
                <button
                  type="button"
                  className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                  onClick={() => setEditModifierRecipeLines(lines => [...lines, { inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 }])}
                >
                  Add Line
                </button>
              </div>

              <div className="space-y-3">
                {editModifierRecipeLines.map((line, idx) => (
                  <div key={idx} className="grid gap-3 md:grid-cols-6">
                    <div className="md:col-span-3">
                      <label className="block text-xs font-medium text-gray-600">Ingredient</label>
                      <select
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        value={line.inventory_item_id}
                        onChange={e => {
                          const selected = inventoryItems.find(i => i.id === e.target.value)
                          setEditModifierRecipeLines(lines => lines.map((l, i) => i === idx
                            ? { ...l, inventory_item_id: e.target.value, unit: selected?.unit_type || l.unit }
                            : l
                          ))
                        }}
                      >
                        <option value="">Select inventory item</option>
                        {inventoryItems.map(i => (
                          <option key={i.id} value={i.id}>{i.item_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Qty</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.qty}
                        onChange={e => setEditModifierRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, qty: Number(e.target.value) } : l))}
                        min={0}
                        step={0.001}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Unit</label>
                      <input
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.unit}
                        onChange={e => setEditModifierRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, unit: e.target.value } : l))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Loss %</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.loss_pct}
                        onChange={e => setEditModifierRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, loss_pct: Number(e.target.value) } : l))}
                        min={0}
                        max={100}
                        step={0.01}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className="w-full rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                        onClick={() => setEditModifierRecipeLines(lines => lines.filter((_, i) => i !== idx))}
                        disabled={editModifierRecipeLines.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={saveEditModifierRecipe}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                  disabled={editModifierRecipeLoading}
                >
                  {editModifierRecipeLoading ? 'Saving…' : 'Save Recipe'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editRecipeOpen && editRecipeHeader && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-4xl rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Edit Base Recipe</h3>
                <p className="text-sm text-gray-600">Updates the recipe header and replaces all lines.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditRecipeOpen(false)}
                className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                disabled={editRecipeLoading}
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Product</label>
                  <select
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    value={editRecipeHeader.product_id}
                    onChange={e => setEditRecipeHeader(h => h ? ({ ...h, product_id: e.target.value }) : h)}
                    disabled
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Effective From</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={toDateInputValue(editRecipeHeader.effective_from)}
                    onChange={e => setEditRecipeHeader(h => h ? ({ ...h, effective_from: new Date(`${e.target.value}T00:00:00.000Z`).toISOString() }) : h)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Effective To (optional)</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={editRecipeHeader.effective_to ? toDateInputValue(editRecipeHeader.effective_to) : ''}
                    onChange={e => setEditRecipeHeader(h => h ? ({
                      ...h,
                      effective_to: e.target.value ? new Date(`${e.target.value}T23:59:59.000Z`).toISOString() : null
                    }) : h)}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Yield Qty</label>
                  <input
                    type="number"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={editRecipeHeader.yield_qty}
                    onChange={e => setEditRecipeHeader(h => h ? ({ ...h, yield_qty: Number(e.target.value) }) : h)}
                    min={0}
                    step={0.001}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Yield Unit</label>
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={editRecipeHeader.yield_unit}
                    onChange={e => setEditRecipeHeader(h => h ? ({ ...h, yield_unit: e.target.value }) : h)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={editRecipeHeader.notes}
                    onChange={e => setEditRecipeHeader(h => h ? ({ ...h, notes: e.target.value }) : h)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-900">Lines</h4>
                <button
                  type="button"
                  className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                  onClick={() => setEditRecipeLines(lines => [...lines, { inventory_item_id: '', qty: 1, unit: 'each', loss_pct: 0 }])}
                >
                  Add Line
                </button>
              </div>

              <div className="space-y-3">
                {editRecipeLines.map((line, idx) => (
                  <div key={idx} className="grid gap-3 md:grid-cols-6">
                    <div className="md:col-span-3">
                      <label className="block text-xs font-medium text-gray-600">Ingredient</label>
                      <select
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        value={line.inventory_item_id}
                        onChange={e => {
                          const selected = inventoryItems.find(i => i.id === e.target.value)
                          setEditRecipeLines(lines => lines.map((l, i) => i === idx
                            ? { ...l, inventory_item_id: e.target.value, unit: selected?.unit_type || l.unit }
                            : l
                          ))
                        }}
                      >
                        <option value="">Select inventory item</option>
                        {inventoryItems.map(i => (
                          <option key={i.id} value={i.id}>{i.item_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Qty</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.qty}
                        onChange={e => setEditRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, qty: Number(e.target.value) } : l))}
                        min={0}
                        step={0.001}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Unit</label>
                      <input
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.unit}
                        onChange={e => setEditRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, unit: e.target.value } : l))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Loss %</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        value={line.loss_pct}
                        onChange={e => setEditRecipeLines(lines => lines.map((l, i) => i === idx ? { ...l, loss_pct: Number(e.target.value) } : l))}
                        min={0}
                        max={100}
                        step={0.01}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className="w-full rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                        onClick={() => setEditRecipeLines(lines => lines.filter((_, i) => i !== idx))}
                        disabled={editRecipeLines.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={saveEditedRecipe}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                  disabled={editRecipeLoading}
                >
                  {editRecipeLoading ? 'Saving…' : 'Save Recipe'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {overrideOpen && overrideSellable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-5xl rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Sellable Overrides</h3>
                <p className="text-sm text-gray-600">
                  {overrideSellable.name} ({overrideSellable.square_variation_id})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOverrideOpen(false)}
                className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                disabled={overrideLoading}
              >
                Close
              </button>
            </div>

            <div className="grid gap-0 md:grid-cols-3">
              <div className="border-b border-gray-200 p-4 md:border-b-0 md:border-r">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900">Existing Overrides</h4>
                  <button
                    type="button"
                    className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                    onClick={() => {
                      setActiveOverrideId(null)
                      setOverrideHeader({ effective_from: new Date().toISOString(), effective_to: null, notes: '' })
                      setOverrideOps([{ op_type: 'multiplier', target_inventory_item_id: null, new_inventory_item_id: null, qty: null, unit: null, multiplier: 1.0, loss_pct: null }])
                    }}
                  >
                    New
                  </button>
                </div>
                <ul className="mt-3 max-h-96 overflow-auto rounded-md border border-gray-200 text-sm">
                  {sellableOverrides.map(o => (
                    <li key={o.id} className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0">
                      <div className="min-w-0">
                        <div className="truncate text-gray-900">{new Date(o.effective_from).toLocaleDateString()}</div>
                        <div className="truncate text-xs text-gray-500">{o.notes || ''}</div>
                      </div>
                      <button
                        type="button"
                        className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                        onClick={() => loadOverrideDetails(o.id)}
                        disabled={overrideLoading}
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                  {sellableOverrides.length === 0 && (
                    <li className="px-3 py-2 text-gray-500">No overrides yet.</li>
                  )}
                </ul>
              </div>

              <div className="p-4 md:col-span-2 space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Effective From</label>
                    <input
                      type="date"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      value={toDateInputValue(overrideHeader.effective_from)}
                      onChange={e => setOverrideHeader(h => ({ ...h, effective_from: new Date(`${e.target.value}T00:00:00.000Z`).toISOString() }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Effective To (optional)</label>
                    <input
                      type="date"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      value={overrideHeader.effective_to ? toDateInputValue(overrideHeader.effective_to) : ''}
                      onChange={e => setOverrideHeader(h => ({
                        ...h,
                        effective_to: e.target.value ? new Date(`${e.target.value}T23:59:59.000Z`).toISOString() : null
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Notes</label>
                    <input
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      value={overrideHeader.notes}
                      onChange={e => setOverrideHeader(h => ({ ...h, notes: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900">Override Ops</h4>
                  <button
                    type="button"
                    className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                    onClick={() => setOverrideOps(ops => [...ops, { op_type: 'add', target_inventory_item_id: null, new_inventory_item_id: null, qty: 1, unit: 'each', multiplier: null, loss_pct: 0 }])}
                  >
                    Add Op
                  </button>
                </div>

                <div className="space-y-3">
                  {overrideOps.map((op, idx) => (
                    <div key={idx} className="rounded-md border border-gray-200 p-3">
                      <div className="grid gap-3 md:grid-cols-6">
                        <div className="md:col-span-2">
                          <label className="block text-xs font-medium text-gray-600">Type</label>
                          <select
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                            value={op.op_type}
                            onChange={e => setOverrideOps(ops => ops.map((o, i) => i === idx ? ({
                              ...o,
                              op_type: e.target.value as OverrideOpType
                            }) : o))}
                          >
                            <option value="add">Add</option>
                            <option value="remove">Remove</option>
                            <option value="replace">Replace</option>
                            <option value="multiplier">Multiplier</option>
                          </select>
                        </div>

                        {(op.op_type === 'remove' || op.op_type === 'replace' || op.op_type === 'multiplier') && (
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-600">
                              {op.op_type === 'multiplier' ? 'Target (optional)' : 'Target'}
                            </label>
                            <select
                              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                              value={op.target_inventory_item_id || ''}
                              onChange={e => setOverrideOps(ops => ops.map((o, i) => i === idx ? ({ ...o, target_inventory_item_id: e.target.value || null }) : o))}
                            >
                              <option value="">{op.op_type === 'multiplier' ? 'All ingredients' : 'Select ingredient'}</option>
                              {inventoryItems.map(i => (
                                <option key={i.id} value={i.id}>{i.item_name}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {(op.op_type === 'add' || op.op_type === 'replace') && (
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-600">{op.op_type === 'add' ? 'Ingredient' : 'New Ingredient'}</label>
                            <select
                              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                              value={op.new_inventory_item_id || ''}
                              onChange={e => {
                                const selected = inventoryItems.find(i => i.id === e.target.value)
                                setOverrideOps(ops => ops.map((o, i) => i === idx ? ({
                                  ...o,
                                  new_inventory_item_id: e.target.value || null,
                                  unit: selected?.unit_type || o.unit
                                }) : o))
                              }}
                            >
                              <option value="">Select inventory item</option>
                              {inventoryItems.map(i => (
                                <option key={i.id} value={i.id}>{i.item_name}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {op.op_type === 'multiplier' && (
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-600">Multiplier</label>
                            <input
                              type="number"
                              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                              value={op.multiplier ?? 1}
                              onChange={e => setOverrideOps(ops => ops.map((o, i) => i === idx ? ({ ...o, multiplier: Number(e.target.value) }) : o))}
                              min={0}
                              step={0.001}
                            />
                          </div>
                        )}

                        {(op.op_type === 'add' || op.op_type === 'replace') && (
                          <>
                            <div>
                              <label className="block text-xs font-medium text-gray-600">Qty</label>
                              <input
                                type="number"
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                value={op.qty ?? 1}
                                onChange={e => setOverrideOps(ops => ops.map((o, i) => i === idx ? ({ ...o, qty: Number(e.target.value) }) : o))}
                                min={0}
                                step={0.001}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600">Unit</label>
                              <input
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                value={op.unit ?? ''}
                                onChange={e => setOverrideOps(ops => ops.map((o, i) => i === idx ? ({ ...o, unit: e.target.value }) : o))}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600">Loss %</label>
                              <input
                                type="number"
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                value={op.loss_pct ?? 0}
                                onChange={e => setOverrideOps(ops => ops.map((o, i) => i === idx ? ({ ...o, loss_pct: Number(e.target.value) }) : o))}
                                min={0}
                                max={100}
                                step={0.01}
                              />
                            </div>
                          </>
                        )}

                        <div className="flex items-end">
                          <button
                            type="button"
                            className="w-full rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50"
                            onClick={() => setOverrideOps(ops => ops.filter((_, i) => i !== idx))}
                            disabled={overrideOps.length <= 1}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={saveOverride}
                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                    disabled={overrideLoading}
                  >
                    {overrideLoading ? 'Saving…' : (activeOverrideId ? 'Save Override' : 'Create Override')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
