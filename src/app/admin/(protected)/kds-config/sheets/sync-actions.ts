'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getTenantSquareConfig } from '@/lib/square/config'
import { getSheets } from '@/lib/google/client'
import { listCatalogObjects } from '@/lib/square/fetch-client'
import type { SquareConfig } from '@/lib/square/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncMode = 'merge' | 'clean'

export interface SyncResult {
  success: true
  counts: { updated: number; added: number; flagged: number }
  mode: SyncMode
}

export type SyncActionResult = SyncResult | { success: false; error: string }

// ---------------------------------------------------------------------------
// Square catalog helpers (fetch client, same as generate action)
// ---------------------------------------------------------------------------

interface SquareCatalogItem {
  square_item_id: string
  square_variation_id: string
  name: string
  variation_name: string
  price_cents: number
  display_price: string
  square_category: string
}

async function fetchSquareCatalogItems(config: SquareConfig): Promise<SquareCatalogItem[]> {
  const items: Record<string, unknown>[] = []
  let cursor: string | undefined
  do {
    const response = await listCatalogObjects(config, ['ITEM', 'CATEGORY'], cursor)
    const objects = response?.objects as Record<string, unknown>[] | undefined
    if (objects) items.push(...objects)
    cursor = response?.cursor as string | undefined
  } while (cursor)

  const filtered = items.filter(i => !i.is_deleted)

  // Build category map
  const categories = new Map<string, string>()
  for (const obj of filtered) {
    if (obj.type === 'CATEGORY' && obj.category_data) {
      const d = obj.category_data as Record<string, unknown>
      categories.set(obj.id as string, (d.name as string) || 'Uncategorized')
    }
  }

  const result: SquareCatalogItem[] = []
  for (const obj of filtered) {
    if (obj.type !== 'ITEM' || !obj.item_data) continue
    const itemData = obj.item_data as Record<string, unknown>
    if (itemData.is_archived) continue

    const cats = itemData.categories as Array<Record<string, string>> | undefined
    const categoryId = cats?.[0]?.id ?? (itemData.category_id as string | undefined)
    const categoryName = categoryId ? (categories.get(categoryId) ?? 'Uncategorized') : 'Uncategorized'

    const variations = itemData.variations as Array<Record<string, unknown>> | undefined
    for (const v of variations ?? []) {
      const vd = v.item_variation_data as Record<string, unknown> | undefined
      if (!vd) continue
      const priceMoney = vd.price_money as Record<string, unknown> | undefined
      const priceCents = priceMoney?.amount ? Number(priceMoney.amount) : 0
      const variationName = (vd.name as string) || ''

      result.push({
        square_item_id: obj.id as string,
        square_variation_id: v.id as string,
        name: itemData.name as string,
        variation_name: variationName,
        price_cents: priceCents,
        display_price: `$${(priceCents / 100).toFixed(2)}`,
        square_category: categoryName,
      })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Sheet read/write helpers
// ---------------------------------------------------------------------------

async function readMenuItemsTab(spreadsheetId: string): Promise<Array<{ rowIndex: number; data: Record<string, string> }>> {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Menu Items!A:Z' })
  const rows = res.data.values ?? []
  if (rows.length < 2) return []
  const headers = rows[0].map(h => h.trim())
  return rows.slice(1).map((row, i) => ({
    rowIndex: i + 2, // 1-indexed, +1 for header
    data: Object.fromEntries(headers.map((h, j) => [h, (row[j] ?? '').trim()])),
  }))
}

// ---------------------------------------------------------------------------
// Merge sync logic
// ---------------------------------------------------------------------------

async function applyMergeSync(
  spreadsheetId: string,
  squareItems: SquareCatalogItem[]
): Promise<{ updated: number; added: number; flagged: number }> {
  const sheets = getSheets()
  const existingRows = await readMenuItemsTab(spreadsheetId)

  // Build lookup by square_variation_id
  const byVarId = new Map(existingRows.map(r => [r.data.square_variation_id, r]))
  const squareVarIds = new Set(squareItems.map(i => i.square_variation_id))

  let updated = 0
  let added = 0
  let flagged = 0

  const updates: Array<{ range: string; values: string[][] }> = []

  // Get header row to know column indices
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Menu Items!1:1' })
  const headers = (headerRes.data.values?.[0] ?? []).map((h: string) => h.trim())
  const colIndex = (name: string) => headers.indexOf(name)

  const priceCol = colIndex('price_cents')
  const displayPriceCol = colIndex('display_price')
  const squareCatCol = colIndex('square_category')

  // Update existing items (Square-owned fields only)
  for (const sq of squareItems) {
    const existing = byVarId.get(sq.square_variation_id)
    if (existing) {
      // Update price_cents, display_price, square_category in-place
      if (priceCol >= 0) {
        const colLetter = String.fromCharCode(65 + priceCol)
        updates.push({ range: `Menu Items!${colLetter}${existing.rowIndex}`, values: [[String(sq.price_cents)]] })
      }
      if (displayPriceCol >= 0) {
        const colLetter = String.fromCharCode(65 + displayPriceCol)
        updates.push({ range: `Menu Items!${colLetter}${existing.rowIndex}`, values: [[sq.display_price]] })
      }
      if (squareCatCol >= 0) {
        const colLetter = String.fromCharCode(65 + squareCatCol)
        updates.push({ range: `Menu Items!${colLetter}${existing.rowIndex}`, values: [[sq.square_category]] })
      }
      updated++
    }
  }

  // Flag removed items
  for (const row of existingRows) {
    const varId = row.data.square_variation_id
    if (varId && !squareVarIds.has(varId) && row.data.name !== 'REMOVED') {
      // Mark as REMOVED in name column
      const nameCol = colIndex('name')
      if (nameCol >= 0) {
        const colLetter = String.fromCharCode(65 + nameCol)
        updates.push({ range: `Menu Items!${colLetter}${row.rowIndex}`, values: [['REMOVED']] })
        flagged++
      }
    }
  }

  // Apply all updates at once
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: updates },
    })
  }

  // Append new items (not in sheet yet)
  const newItems = squareItems.filter(sq => !byVarId.has(sq.square_variation_id))
  if (newItems.length > 0) {
    // Group by square_category for organized insertion
    const grouped = new Map<string, SquareCatalogItem[]>()
    for (const item of newItems) {
      const existing = grouped.get(item.square_category) ?? []
      existing.push(item)
      grouped.set(item.square_category, existing)
    }

    const newRows: string[][] = []
    for (const [, items] of grouped) {
      for (const item of items) {
        const isDefault = item.variation_name.toLowerCase() === 'regular' || item.variation_name === ''
        const displayName = isDefault ? item.name : `${item.name} (${item.variation_name})`
        const row = new Array(headers.length).fill('')
        const set = (col: string, val: string) => {
          const i = colIndex(col)
          if (i >= 0) row[i] = val
        }
        set('square_item_id', item.square_item_id)
        set('square_variation_id', item.square_variation_id)
        set('name', item.name)
        set('variation_name', item.variation_name)
        set('display_name', displayName)
        set('price_cents', String(item.price_cents))
        set('display_price', item.display_price)
        set('square_category', item.square_category)
        set('kds_category', 'uncategorized')
        set('sort_order', '0')
        set('is_visible', 'false') // hidden by default
        newRows.push(row)
      }
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Menu Items!A:A',
      valueInputOption: 'RAW',
      requestBody: { values: newRows },
    })
    added = newRows.length
  }

  return { updated, added, flagged }
}

// ---------------------------------------------------------------------------
// Clean sync (overwrite entire Menu Items tab)
// ---------------------------------------------------------------------------

async function applyCleanSync(
  spreadsheetId: string,
  squareItems: SquareCatalogItem[]
): Promise<{ updated: number; added: number; flagged: number }> {
  const sheets = getSheets()

  // Rebuild entire Menu Items tab from Square data
  const headers = [
    'square_item_id', 'square_variation_id', 'name', 'variation_name',
    'display_name', 'description', 'price', 'price_cents', 'display_price',
    'square_category', 'kds_category', 'sort_order', 'is_visible',
  ]

  const rows: string[][] = [headers]
  for (const item of squareItems) {
    const isDefault = item.variation_name.toLowerCase() === 'regular' || item.variation_name === ''
    const displayName = isDefault ? item.name : `${item.name} (${item.variation_name})`
    rows.push([
      item.square_item_id, item.square_variation_id, item.name, item.variation_name,
      displayName, '', `$${(item.price_cents / 100).toFixed(2)}`, String(item.price_cents),
      item.display_price, item.square_category, 'uncategorized', '0', 'true',
    ])
  }

  // Clear and rewrite
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Menu Items!A:Z' })
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Menu Items!A1',
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  })

  return { updated: 0, added: squareItems.length, flagged: 0 }
}

// ---------------------------------------------------------------------------
// Main server action
// ---------------------------------------------------------------------------

export async function syncFromSquare(
  tenantId: string,
  mode: SyncMode = 'merge'
): Promise<SyncActionResult> {
  try {
    const supabase = createServiceClient()

    // Get sheet reference
    const { data: sheetRef } = await supabase
      .from('tenant_kds_sheets')
      .select('google_spreadsheet_id')
      .eq('tenant_id', tenantId)
      .single()

    if (!sheetRef) return { success: false, error: 'NO_SHEET' }

    // Get Square credentials
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) return { success: false, error: 'NO_SQUARE_CREDENTIALS' }

    // Fetch Square catalog
    const squareItems = await fetchSquareCatalogItems(squareConfig)

    // Apply sync
    const counts = mode === 'merge'
      ? await applyMergeSync(sheetRef.google_spreadsheet_id, squareItems)
      : await applyCleanSync(sheetRef.google_spreadsheet_id, squareItems)

    // Update last_synced_at
    await supabase
      .from('tenant_kds_sheets')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)

    return { success: true, counts, mode }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[syncFromSquare]', message)
    return { success: false, error: message }
  }
}
