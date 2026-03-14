'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getSheets } from '@/lib/google/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportMode = 'clean' | 'merge'
export type ImportSubMode = 'quick' | 'preview'

export interface ImportPreviewRow {
  type: 'new' | 'changed' | 'removed' | 'unchanged'
  table: string
  key: string
  data: Record<string, unknown>
}

export interface ImportPreviewResult {
  success: true
  preview: true
  counts: { new: number; changed: number; removed: number }
  warnings: string[]
  rows: ImportPreviewRow[]
}

export interface ImportApplyResult {
  success: true
  preview: false
  counts: { categories: number; items: number; images: number; settings: number }
}

export type ImportResult =
  | ImportPreviewResult
  | ImportApplyResult
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// Sheet reading helpers
// ---------------------------------------------------------------------------

async function readSheetTabs(spreadsheetId: string) {
  const sheets = getSheets()

  const [menuRes, catRes, imgRes, settingsRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Menu Items!A:Z' }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Categories!A:Z' }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Images!A:Z' }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: 'Settings!A:Z' }),
  ])

  function parseTab(res: { data: { values?: string[][] } }) {
    const rows = res.data.values ?? []
    if (rows.length < 2) return []
    const headers = rows[0].map(h => h.trim())
    return rows.slice(1)
      .filter(row => row.some(cell => cell?.trim()))
      .map(row => {
        const obj: Record<string, string> = {}
        headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim() })
        return obj
      })
  }

  return {
    menuItems: parseTab(menuRes),
    categories: parseTab(catRes),
    images: parseTab(imgRes),
    settings: parseTab(settingsRes),
  }
}

// ---------------------------------------------------------------------------
// Transform helpers (adapted from import-kds-menu-from-sheets.js)
// ---------------------------------------------------------------------------

function parseBool(val: string | undefined): boolean {
  return val === 'true' || val === 'TRUE' || val === '1'
}

function transformCategory(row: Record<string, string>, tenantId: string) {
  return {
    tenant_id: tenantId,
    slug: row.slug,
    name: row.name,
    screen: row.screen,
    position: row.position || null,
    sort_order: parseInt(row.sort_order, 10) || 0,
    color: row.color || null,
    icon: row.icon || null,
    display_type: row.display_type || null,
    show_size_header: row.show_size_header ? parseBool(row.show_size_header) : true,
    header_text: row.header_text || null,
    size_labels: row.size_labels || null,
  }
}

function transformMenuItem(
  row: Record<string, string>,
  categoryMap: Map<string, string>,
  tenantId: string
) {
  const categorySlug = row.kds_category || 'uncategorized'
  const categoryId = categoryMap.get(categorySlug) ?? null
  let priceCents = 0
  if (row.price_cents) priceCents = parseInt(row.price_cents, 10)
  else if (row.price) priceCents = Math.round(parseFloat(row.price) * 100)

  return {
    tenant_id: tenantId,
    square_item_id: row.square_item_id || null,
    square_variation_id: row.square_variation_id || null,
    name: row.name,
    display_name: row.display_name || null,
    variation_name: row.variation_name || null,
    price_cents: priceCents,
    display_price: row.display_price || `$${(priceCents / 100).toFixed(2)}`,
    category_id: categoryId,
    sort_order: parseInt(row.sort_order, 10) || 0,
    is_visible: parseBool(row.is_visible),
    display_type: row.display_type || null,
    featured: parseBool(row.featured),
    bullet_color: row.bullet_color || null,
    parent_item: row.parent_item || null,
  }
}

function transformImage(row: Record<string, string>, tenantId: string) {
  return {
    tenant_id: tenantId,
    screen: row.screen,
    filename: row.filename,
    alt_text: row.alt_text || null,
    sort_order: parseInt(row.sort_order, 10) || 0,
    is_active: parseBool(row.is_active),
  }
}

function transformSetting(row: Record<string, string>, tenantId: string) {
  let value: string | number = row.value
  if (row.value && !isNaN(Number(row.value)) && row.value.trim() !== '') {
    value = parseInt(row.value, 10)
  }
  return { tenant_id: tenantId, key: row.key, value }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateSheetData(
  menuItems: Record<string, string>[],
  categories: Record<string, string>[],
  images: Record<string, string>[],
  settings: Record<string, string>[]
): string[] {
  const warnings: string[] = []

  if (categories.length === 0) warnings.push('Categories tab is empty')
  if (menuItems.length === 0) warnings.push('Menu Items tab is empty — KDS screens will be blank')

  for (const cat of categories) {
    if (!cat.slug) warnings.push(`Category missing slug: ${JSON.stringify(cat)}`)
    if (!cat.name) warnings.push(`Category missing name (slug: ${cat.slug})`)
    if (!['drinks', 'food'].includes(cat.screen)) {
      warnings.push(`Category "${cat.slug}" has invalid screen "${cat.screen}" (must be drinks or food)`)
    }
  }

  const slugSet = new Set(categories.map(c => c.slug))
  for (const item of menuItems) {
    if (!item.name) warnings.push(`Menu item missing name: ${JSON.stringify(item)}`)
    if (item.kds_category && item.kds_category !== 'uncategorized' && !slugSet.has(item.kds_category)) {
      warnings.push(`Item "${item.name}" references unknown category "${item.kds_category}"`)
    }
  }

  for (const img of images) {
    if (!['drinks', 'food'].includes(img.screen)) {
      warnings.push(`Image "${img.filename}" has invalid screen "${img.screen}"`)
    }
  }

  for (const s of settings) {
    if (!s.key) warnings.push(`Settings row missing key: ${JSON.stringify(s)}`)
  }

  return warnings
}

// ---------------------------------------------------------------------------
// Clean import (wipe + replace)
// ---------------------------------------------------------------------------

async function applyCleanImport(
  tenantId: string,
  menuItems: Record<string, string>[],
  categories: Record<string, string>[],
  images: Record<string, string>[],
  settings: Record<string, string>[]
): Promise<ImportApplyResult> {
  const supabase = createServiceClient()

  // Delete in FK-safe order
  await supabase.from('kds_menu_items').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_categories').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_images').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_settings').delete().eq('tenant_id', tenantId)

  // Insert categories first (menu items FK to categories)
  const catRows = categories.map(r => transformCategory(r, tenantId))
  if (catRows.length > 0) {
    const { error } = await supabase.from('kds_categories').insert(catRows)
    if (error) throw new Error(`Categories insert failed: ${error.message}`)
  }

  // Build category slug→id map
  const { data: catData } = await supabase
    .from('kds_categories').select('id, slug').eq('tenant_id', tenantId)
  const categoryMap = new Map((catData ?? []).map(c => [c.slug, c.id]))

  // Insert menu items
  const itemRows = menuItems.map(r => transformMenuItem(r, categoryMap, tenantId))
  if (itemRows.length > 0) {
    const { error } = await supabase.from('kds_menu_items').insert(itemRows)
    if (error) throw new Error(`Menu items insert failed: ${error.message}`)
  }

  // Insert images
  const imgRows = images.map(r => transformImage(r, tenantId))
  if (imgRows.length > 0) {
    const { error } = await supabase.from('kds_images').insert(imgRows)
    if (error) throw new Error(`Images insert failed: ${error.message}`)
  }

  // Upsert settings
  const settingRows = settings.map(r => transformSetting(r, tenantId))
  for (const s of settingRows) {
    const { error } = await supabase
      .from('kds_settings')
      .upsert(s, { onConflict: 'tenant_id,key' })
    if (error) throw new Error(`Settings upsert failed: ${error.message}`)
  }

  // Update last_imported_at
  await supabase
    .from('tenant_kds_sheets')
    .update({ last_imported_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)

  return {
    success: true,
    preview: false,
    counts: {
      categories: catRows.length,
      items: itemRows.length,
      images: imgRows.length,
      settings: settingRows.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Merge import (upsert, leave unmatched alone)
// ---------------------------------------------------------------------------

async function applyMergeImport(
  tenantId: string,
  menuItems: Record<string, string>[],
  categories: Record<string, string>[],
  images: Record<string, string>[],
  settings: Record<string, string>[]
): Promise<ImportApplyResult> {
  const supabase = createServiceClient()

  // Upsert categories
  const catRows = categories.map(r => transformCategory(r, tenantId))
  for (const cat of catRows) {
    const { error } = await supabase
      .from('kds_categories')
      .upsert(cat, { onConflict: 'tenant_id,slug' })
    if (error) throw new Error(`Category upsert failed (${cat.slug}): ${error.message}`)
  }

  // Build category map
  const { data: catData } = await supabase
    .from('kds_categories').select('id, slug').eq('tenant_id', tenantId)
  const categoryMap = new Map((catData ?? []).map(c => [c.slug, c.id]))

  // Upsert menu items by square_variation_id
  const itemRows = menuItems.map(r => transformMenuItem(r, categoryMap, tenantId))
  for (const item of itemRows) {
    if (item.square_variation_id) {
      const { data: existing } = await supabase
        .from('kds_menu_items')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('square_variation_id', item.square_variation_id)
        .maybeSingle()
      if (existing) {
        await supabase.from('kds_menu_items').update(item).eq('id', existing.id)
      } else {
        await supabase.from('kds_menu_items').insert(item)
      }
    } else {
      await supabase.from('kds_menu_items')
        .upsert(item, { onConflict: 'tenant_id,name,variation_name' })
    }
  }

  // Upsert images by filename+screen
  const imgRows = images.map(r => transformImage(r, tenantId))
  for (const img of imgRows) {
    await supabase.from('kds_images')
      .upsert(img, { onConflict: 'tenant_id,screen,filename' })
  }

  // Upsert settings
  const settingRows = settings.map(r => transformSetting(r, tenantId))
  for (const s of settingRows) {
    await supabase.from('kds_settings')
      .upsert(s, { onConflict: 'tenant_id,key' })
  }

  await supabase
    .from('tenant_kds_sheets')
    .update({ last_imported_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)

  return {
    success: true,
    preview: false,
    counts: {
      categories: catRows.length,
      items: itemRows.length,
      images: imgRows.length,
      settings: settingRows.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Main server action
// ---------------------------------------------------------------------------

export async function importFromSheet(
  tenantId: string,
  mode: ImportMode = 'clean',
  subMode: ImportSubMode = 'quick'
): Promise<ImportResult> {
  try {
    const supabase = createServiceClient()

    // Get sheet reference
    const { data: sheetRef } = await supabase
      .from('tenant_kds_sheets')
      .select('google_spreadsheet_id')
      .eq('tenant_id', tenantId)
      .single()

    if (!sheetRef) return { success: false, error: 'NO_SHEET' }

    // Read all 4 tabs
    const { menuItems, categories, images, settings } = await readSheetTabs(
      sheetRef.google_spreadsheet_id
    )

    // Validate
    const warnings = validateSheetData(menuItems, categories, images, settings)

    if (subMode === 'preview') {
      // Return diff without writing
      const rows: ImportPreviewRow[] = []

      const { data: existingCats } = await supabase
        .from('kds_categories').select('slug').eq('tenant_id', tenantId)
      const existingSlugs = new Set((existingCats ?? []).map(c => c.slug))
      const incomingSlugs = new Set(categories.map(c => c.slug))

      for (const cat of categories) {
        rows.push({
          type: existingSlugs.has(cat.slug) ? 'changed' : 'new',
          table: 'kds_categories',
          key: cat.slug,
          data: cat,
        })
      }
      if (mode === 'clean') {
        for (const slug of existingSlugs) {
          if (!incomingSlugs.has(slug)) {
            rows.push({ type: 'removed', table: 'kds_categories', key: slug, data: { slug } })
          }
        }
      }

      const { data: existingItems } = await supabase
        .from('kds_menu_items').select('square_variation_id, name').eq('tenant_id', tenantId)
      const existingVarIds = new Set((existingItems ?? []).map(i => i.square_variation_id).filter(Boolean))
      const incomingVarIds = new Set(menuItems.map(i => i.square_variation_id).filter(Boolean))

      for (const item of menuItems) {
        rows.push({
          type: item.square_variation_id && existingVarIds.has(item.square_variation_id) ? 'changed' : 'new',
          table: 'kds_menu_items',
          key: item.square_variation_id || item.name,
          data: item,
        })
      }
      if (mode === 'clean') {
        for (const varId of existingVarIds) {
          if (varId && !incomingVarIds.has(varId)) {
            rows.push({ type: 'removed', table: 'kds_menu_items', key: varId as string, data: { square_variation_id: varId } })
          }
        }
      }

      const newCount = rows.filter(r => r.type === 'new').length
      const changedCount = rows.filter(r => r.type === 'changed').length
      const removedCount = rows.filter(r => r.type === 'removed').length

      return {
        success: true,
        preview: true,
        counts: { new: newCount, changed: changedCount, removed: removedCount },
        warnings,
        rows,
      }
    }

    // Apply import
    const result = mode === 'clean'
      ? await applyCleanImport(tenantId, menuItems, categories, images, settings)
      : await applyMergeImport(tenantId, menuItems, categories, images, settings)

    revalidatePath('/admin/kds-config')
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[importFromSheet]', message)
    return { success: false, error: message }
  }
}
