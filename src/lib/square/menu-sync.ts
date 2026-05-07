/**
 * MOK-151 / KDS v3 phase 1 — Square menu mirror sync service.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-151
 * Plan: .planning/kds-v3/PHASE-1-PLAN.md (T4)
 *
 * Pulls Square MENU_CATEGORY hierarchy + the ITEMs that reference any
 * MENU_CATEGORY into the local mirror tables. Idempotent on re-run; uses
 * `square_menu_sync_state.last_synced_at` for incremental syncs and
 * `fullResync: true` to bypass it.
 *
 * Items that ONLY belong to REGULAR_CATEGORY (POS-only items, kitchen
 * routing) are intentionally skipped — they have no place in a KDS render.
 *
 * Order of operations matters: process CATEGORY upserts/deletions BEFORE
 * processing ITEMs, so the menu_category id set used to filter item
 * memberships includes any category that arrived in this same sync.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { searchCatalogItems } from './fetch-client'
import { getTenantSquareConfig } from './config'
import type { SquareConfig } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncResult {
  fullResync: boolean
  syncStartedAt: string
  syncCompletedAt: string
  upserts: {
    categories: number
    items: number
    variations: number
    memberships: number
  }
  deletes: {
    categoriesMarkedDeleted: number
    itemsMarkedDeleted: number
    variationsMarkedDeleted: number
    membershipsRemoved: number
  }
  warnings: string[]
}

export interface SyncOptions {
  fullResync?: boolean
}

// Subset of Square Catalog API shapes we care about; deliberately narrow.
interface SquareCategory {
  type: 'CATEGORY'
  id: string
  is_deleted?: boolean
  version?: number
  category_data?: {
    name?: string
    category_type?: 'MENU_CATEGORY' | 'REGULAR_CATEGORY'
    parent_category?: { id?: string; ordinal?: number }
    is_top_level?: boolean
    channels?: string[]
    online_visibility?: boolean
  }
}
interface SquareItemVariationInline {
  type: 'ITEM_VARIATION'
  id: string
  is_deleted?: boolean
  item_variation_data?: {
    name?: string
    pricing_type?: string
    price_money?: { amount?: number; currency?: string }
    ordinal?: number
  }
}
interface SquareItem {
  type: 'ITEM'
  id: string
  is_deleted?: boolean
  version?: number
  item_data?: {
    name?: string
    description?: string
    image_ids?: string[]
    categories?: Array<{ id?: string; ordinal?: number }>
    variations?: SquareItemVariationInline[]
  }
}
interface SquareImage {
  type: 'IMAGE'
  id: string
  image_data?: { url?: string; name?: string }
}
type SquareCatalogObject = SquareCategory | SquareItem | SquareImage | { type: string; id: string }

// MENU_CATEGORY's category_type is encoded as integer 2 in the range_query
// API (per Square docs: "use min=2 max=2 to filter to MENU_CATEGORY").
const MENU_CATEGORY_RANGE_VALUE = 2

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function syncMenusFromSquare(
  supabase: SupabaseClient,
  tenantId: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const fullResync = Boolean(opts.fullResync)
  const syncStartedAt = new Date().toISOString()
  const warnings: string[] = []
  const result: SyncResult = {
    fullResync,
    syncStartedAt,
    syncCompletedAt: '',
    upserts: { categories: 0, items: 0, variations: 0, memberships: 0 },
    deletes: {
      categoriesMarkedDeleted: 0,
      itemsMarkedDeleted: 0,
      variationsMarkedDeleted: 0,
      membershipsRemoved: 0,
    },
    warnings,
  }

  const config = await getTenantSquareConfig(tenantId)
  if (!config) {
    throw new Error(`No Square credentials configured for tenant ${tenantId}`)
  }

  const beginTime = fullResync ? null : await readLastSyncedAt(supabase, tenantId)

  // Two parallel searches: MENU_CATEGORY changes and ITEM/IMAGE changes.
  const [categoryResp, itemResp] = await Promise.all([
    searchCatalogItems(config, buildCategorySearchBody(beginTime)),
    searchCatalogItems(config, buildItemSearchBody(beginTime)),
  ])

  const categories = (categoryResp.objects ?? []) as SquareCategory[]
  const items = (itemResp.objects ?? []) as SquareItem[]
  const relatedObjects = (itemResp.related_objects ?? []) as SquareCatalogObject[]

  // ── Step 3: process categories first ──────────────────────────────────────
  // Defense: even though we asked Square for MENU_CATEGORY only, double-check
  // category_type before mirroring. Future API-shape surprises shouldn't
  // pollute the mirror.
  for (const cat of categories) {
    const isMenuCategory =
      cat.category_data?.category_type === 'MENU_CATEGORY' || cat.is_deleted
    if (!isMenuCategory) continue

    if (cat.is_deleted) {
      const removed = await markCategoryDeleted(supabase, tenantId, cat.id)
      if (removed.categoryUpdated) result.deletes.categoriesMarkedDeleted++
      result.deletes.membershipsRemoved += removed.membershipsRemoved
    } else {
      await upsertCategory(supabase, tenantId, cat)
      result.upserts.categories++
    }
  }

  // After category writes, load all known menu_category ids for this tenant
  // so we can filter item.categories[] entries to MENU_CATEGORY only.
  const menuCategoryIds = await loadMenuCategoryIds(supabase, tenantId)

  // Resolve image_url map from related IMAGE objects.
  const imageUrlById = buildImageUrlMap(relatedObjects)

  // ── Step 4: process items ─────────────────────────────────────────────────
  for (const item of items) {
    if (item.is_deleted) {
      const removed = await markItemDeleted(supabase, tenantId, item.id)
      if (removed.itemUpdated) result.deletes.itemsMarkedDeleted++
      result.deletes.variationsMarkedDeleted += removed.variationsMarked
      result.deletes.membershipsRemoved += removed.membershipsRemoved
      continue
    }

    // Skip items that have no MENU_CATEGORY in their categories[] — they're
    // POS-only / regular-category-only items, not part of any KDS menu.
    const menuCategoryRefs = (item.item_data?.categories ?? []).filter(
      (c) => c.id && menuCategoryIds.has(c.id),
    )
    if (menuCategoryRefs.length === 0) continue

    const imageId = item.item_data?.image_ids?.[0] ?? null
    const imageUrl = imageId ? imageUrlById.get(imageId) ?? null : null
    if (imageId && !imageUrl) {
      warnings.push(`item ${item.id}: image_id ${imageId} not found in related_objects`)
    }

    await upsertItem(supabase, tenantId, item, imageUrl)
    result.upserts.items++

    const variationsCounts = await reconcileVariations(supabase, tenantId, item)
    result.upserts.variations += variationsCounts.upserted
    result.deletes.variationsMarkedDeleted += variationsCounts.markedDeleted

    const membershipCounts = await reconcileMembership(
      supabase,
      tenantId,
      item.id,
      menuCategoryRefs,
    )
    result.upserts.memberships += membershipCounts.upserted
    result.deletes.membershipsRemoved += membershipCounts.removed
  }

  // ── Step 6: write sync state ──────────────────────────────────────────────
  result.syncCompletedAt = new Date().toISOString()
  await writeSyncState(supabase, tenantId, syncStartedAt, 'ok', null)

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Search body builders
// ─────────────────────────────────────────────────────────────────────────────

function buildCategorySearchBody(beginTime: string | null): Record<string, unknown> {
  return {
    object_types: ['CATEGORY'],
    query: {
      range_query: {
        attribute_name: 'category_type',
        attribute_min_value: MENU_CATEGORY_RANGE_VALUE,
        attribute_max_value: MENU_CATEGORY_RANGE_VALUE,
      },
    },
    include_deleted_objects: true,
    ...(beginTime ? { begin_time: beginTime } : {}),
  }
}

function buildItemSearchBody(beginTime: string | null): Record<string, unknown> {
  return {
    object_types: ['ITEM', 'IMAGE'],
    include_related_objects: true,
    include_deleted_objects: true,
    ...(beginTime ? { begin_time: beginTime } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (each kept small so unit tests can target them later)
// ─────────────────────────────────────────────────────────────────────────────

async function readLastSyncedAt(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('square_menu_sync_state')
    .select('last_synced_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as { last_synced_at?: string } | null)?.last_synced_at ?? null
}

async function writeSyncState(
  supabase: SupabaseClient,
  tenantId: string,
  syncedAt: string,
  status: 'ok' | 'error',
  error: string | null,
): Promise<void> {
  await supabase.from('square_menu_sync_state').upsert(
    {
      tenant_id: tenantId,
      last_synced_at: syncedAt,
      last_run_status: status,
      last_error: error,
    },
    { onConflict: 'tenant_id' },
  )
}

async function loadMenuCategoryIds(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from('square_menu_categories')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_deleted', false)
  return new Set((data ?? []).map((r: { id: string }) => r.id))
}

export function buildImageUrlMap(related: SquareCatalogObject[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const obj of related) {
    if (obj.type === 'IMAGE') {
      const img = obj as SquareImage
      const url = img.image_data?.url
      if (url) out.set(img.id, url)
    }
  }
  return out
}

async function upsertCategory(
  supabase: SupabaseClient,
  tenantId: string,
  cat: SquareCategory,
): Promise<void> {
  const data = cat.category_data ?? {}
  await supabase.from('square_menu_categories').upsert(
    {
      tenant_id: tenantId,
      id: cat.id,
      name: data.name ?? '',
      is_top_level: Boolean(data.is_top_level),
      parent_id: data.parent_category?.id ?? null,
      ordinal: data.parent_category?.ordinal ?? null,
      channels: data.channels ?? [],
      online_visibility: data.online_visibility ?? null,
      square_version: cat.version ?? 0,
      raw_json: cat,
      is_deleted: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,id' },
  )
}

async function markCategoryDeleted(
  supabase: SupabaseClient,
  tenantId: string,
  categoryId: string,
): Promise<{ categoryUpdated: boolean; membershipsRemoved: number }> {
  // Mark the category soft-deleted (only if it exists in our mirror).
  const { data: catUpdate } = await supabase
    .from('square_menu_categories')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', categoryId)
    .select('id')

  // Cascade: remove membership rows pointing at the deleted category. Square
  // may not bump every member item's updated_at when a parent is deleted.
  const { data: removed } = await supabase
    .from('square_menu_item_categories')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('category_id', categoryId)
    .select('item_id')

  return {
    categoryUpdated: (catUpdate ?? []).length > 0,
    membershipsRemoved: (removed ?? []).length,
  }
}

async function upsertItem(
  supabase: SupabaseClient,
  tenantId: string,
  item: SquareItem,
  imageUrl: string | null,
): Promise<void> {
  const data = item.item_data ?? {}
  await supabase.from('square_menu_items').upsert(
    {
      tenant_id: tenantId,
      id: item.id,
      name: data.name ?? '',
      description: data.description ?? null,
      image_url: imageUrl,
      square_version: item.version ?? 0,
      raw_json: item,
      is_deleted: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,id' },
  )
}

async function markItemDeleted(
  supabase: SupabaseClient,
  tenantId: string,
  itemId: string,
): Promise<{
  itemUpdated: boolean
  variationsMarked: number
  membershipsRemoved: number
}> {
  const { data: itemUpdate } = await supabase
    .from('square_menu_items')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', itemId)
    .select('id')

  const { data: varsMarked } = await supabase
    .from('square_menu_item_variations')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('item_id', itemId)
    .select('id')

  const { data: removedMemberships } = await supabase
    .from('square_menu_item_categories')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('item_id', itemId)
    .select('category_id')

  return {
    itemUpdated: (itemUpdate ?? []).length > 0,
    variationsMarked: (varsMarked ?? []).length,
    membershipsRemoved: (removedMemberships ?? []).length,
  }
}

async function reconcileMembership(
  supabase: SupabaseClient,
  tenantId: string,
  itemId: string,
  menuCategoryRefs: Array<{ id?: string; ordinal?: number }>,
): Promise<{ upserted: number; removed: number }> {
  // Replace strategy: delete all existing memberships for this item, then
  // insert the current set. Simpler than per-row diffing and the row counts
  // are small (~handful per item).
  const { data: removed } = await supabase
    .from('square_menu_item_categories')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('item_id', itemId)
    .select('category_id')

  const rows = menuCategoryRefs
    .filter((c) => c.id)
    .map((c) => ({
      tenant_id: tenantId,
      item_id: itemId,
      category_id: c.id!,
      ordinal: c.ordinal ?? 0,
    }))
  if (rows.length === 0) {
    return { upserted: 0, removed: (removed ?? []).length }
  }

  await supabase.from('square_menu_item_categories').insert(rows)
  return { upserted: rows.length, removed: (removed ?? []).length }
}

async function reconcileVariations(
  supabase: SupabaseClient,
  tenantId: string,
  item: SquareItem,
): Promise<{ upserted: number; markedDeleted: number }> {
  const variations = item.item_data?.variations ?? []
  const incomingIds = new Set(variations.map((v) => v.id))

  // Upsert the incoming variations.
  let upserted = 0
  for (const v of variations) {
    const vd = v.item_variation_data ?? {}
    await supabase.from('square_menu_item_variations').upsert(
      {
        tenant_id: tenantId,
        id: v.id,
        item_id: item.id,
        name: vd.name ?? null,
        price_cents: vd.price_money?.amount ?? null,
        ordinal: vd.ordinal ?? null,
        is_deleted: Boolean(v.is_deleted),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,id' },
    )
    upserted++
  }

  // Mark any prior variations not in the incoming array as deleted. This is
  // how we catch "operator removed a variation but kept the item".
  const { data: existing } = await supabase
    .from('square_menu_item_variations')
    .select('id, is_deleted')
    .eq('tenant_id', tenantId)
    .eq('item_id', item.id)

  const stale = (existing ?? []).filter(
    (v: { id: string; is_deleted: boolean }) =>
      !incomingIds.has(v.id) && !v.is_deleted,
  )
  let markedDeleted = 0
  for (const v of stale) {
    await supabase
      .from('square_menu_item_variations')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', v.id)
    markedDeleted++
  }

  return { upserted, markedDeleted }
}

// Re-export for unit tests of the search-body shape (no runtime cost).
export const __testing = {
  buildCategorySearchBody,
  buildItemSearchBody,
  MENU_CATEGORY_RANGE_VALUE,
}

// Suppress unused warning for SquareConfig type (re-exported for callers).
export type { SquareConfig }
