'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantSquareConfig } from '@/lib/square/config'
import { getSheets, getDrive } from '@/lib/google/client'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: SquareClient } = require('square/legacy') as { Client: new (opts: unknown) => { catalogApi: { listCatalog: (cursor?: string, types?: string) => Promise<{ result?: { objects?: unknown[]; cursor?: string } }> } } }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GenerateSheetResult =
  | { success: true; sheetUrl: string; spreadsheetId: string; itemCount: number }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// Square catalog helpers (adapted from export-kds-menu-to-sheets.js)
// ---------------------------------------------------------------------------

interface SquareItem {
  square_item_id: string
  square_variation_id: string
  name: string
  variation_name: string
  display_name: string
  description: string
  price: string
  price_cents: number
  display_price: string
  square_category: string
  kds_category: string
  sort_order: number
  is_visible: boolean
}

async function fetchSquareCatalog(accessToken: string, environment: string) {
  const client = new SquareClient({
    bearerAuthCredentials: { accessToken },
    environment: environment.toLowerCase(),
  })

  const items: object[] = []
  let cursor: string | undefined
  do {
    const response = await client.catalogApi.listCatalog(cursor, 'ITEM,CATEGORY')
    if (response?.result?.objects) {
      items.push(...(response.result.objects as object[]))
    }
    cursor = response?.result?.cursor ?? undefined
  } while (cursor)

  return items.filter((item: object) => !(item as Record<string, unknown>).isDeleted)
}

function suggestKDSCategory(categoryName: string, parentName: string | null): string {
  const name = categoryName.toLowerCase()
  if (parentName) {
    const parent = parentName.toLowerCase()
    if (parent.includes('frappuccino') || parent.includes('blended')) {
      if (name.includes('creme') || name.includes('crème')) return 'frappuccinos-creme'
      if (name.includes('coffee')) return 'frappuccinos-coffee'
      return 'blended'
    }
  }
  if (name.includes('hot') && (name.includes('drink') || name.includes('beverage'))) return 'hot-drinks'
  if (name.includes('espresso') || name.includes('latte') || name.includes('cappuccino')) return 'espressos'
  if (name.includes('frappuccino') || name.includes('frappe') || name.includes('blended')) return 'blended'
  if (name.includes('creme') || name.includes('crème')) return 'blended'
  if (name.includes('refresher')) return 'refreshers'
  if (name.includes('smoothie')) return 'smoothies'
  if (name.includes('energy')) return 'energy-drinks'
  if (name.includes('cold') || name.includes('iced')) return 'cold-drinks'
  if (name.includes('coffee') || name.includes('tea')) return 'hot-drinks'
  if (name.includes('breakfast') || name.includes('burrito') || name.includes('egg')) return 'breakfast'
  if (name.includes('pastry') || name.includes('pastries') || name.includes('croissant') || name.includes('muffin')) return 'pastries'
  if (name.includes('sandwich') || name.includes('lunch') || name.includes('wrap')) return 'sandwiches'
  if (name.includes('snack') || name.includes('chip') || name.includes('fruit')) return 'snacks'
  if (name.includes('bakery') || name.includes('baked')) return 'pastries'
  return 'uncategorized'
}

function extractMenuData(catalogObjects: object[]): SquareItem[] {
  const categories = new Map<string, { id: string; name: string; parentId: string | null }>()
  for (const obj of catalogObjects as Record<string, unknown>[]) {
    if (obj.type === 'CATEGORY' && obj.categoryData) {
      const d = obj.categoryData as Record<string, unknown>
      const parent = d.parentCategory as Record<string, string> | null
      categories.set(obj.id as string, {
        id: obj.id as string,
        name: (d.name as string) || 'Uncategorized',
        parentId: parent?.id ?? null,
      })
    }
  }

  const menuItems: SquareItem[] = []
  for (const obj of catalogObjects as Record<string, unknown>[]) {
    if (obj.type !== 'ITEM' || !obj.itemData) continue
    const itemData = obj.itemData as Record<string, unknown>
    if (itemData.isArchived) continue

    const cats = itemData.categories as Array<Record<string, string>> | undefined
    const categoryId = cats?.[0]?.id ?? (itemData.categoryId as string | undefined)
    const category = categoryId ? categories.get(categoryId) : undefined
    const categoryName = category?.name ?? 'Uncategorized'
    const parentCategory = category?.parentId ? categories.get(category.parentId) : undefined
    const parentName = parentCategory?.name ?? null

    const variations = itemData.variations as Array<Record<string, unknown>> | undefined
    for (const variation of variations ?? []) {
      const vd = variation.itemVariationData as Record<string, unknown> | undefined
      if (!vd) continue
      const priceMoney = vd.priceMoney as Record<string, unknown> | undefined
      const priceCents = priceMoney?.amount ? Number(priceMoney.amount) : 0
      const priceFormatted = (priceCents / 100).toFixed(2)
      const variationName = (vd.name as string) || ''
      const isDefault = variationName.toLowerCase() === 'regular' || variationName === ''
      const displayName = isDefault
        ? (itemData.name as string)
        : `${itemData.name} (${variationName})`

      menuItems.push({
        square_item_id: obj.id as string,
        square_variation_id: variation.id as string,
        name: itemData.name as string,
        variation_name: variationName,
        display_name: displayName,
        description: (itemData.description as string) ?? '',
        price: priceFormatted,
        price_cents: priceCents,
        display_price: `$${priceFormatted}`,
        square_category: categoryName,
        kds_category: suggestKDSCategory(categoryName, parentName),
        sort_order: 0,
        is_visible: true,
      })
    }
  }

  menuItems.sort((a, b) =>
    a.square_category !== b.square_category
      ? a.square_category.localeCompare(b.square_category)
      : a.name.localeCompare(b.name)
  )
  return menuItems
}

// ---------------------------------------------------------------------------
// Sheet tab builders
// ---------------------------------------------------------------------------

function buildMenuItemsTab(menuItems: SquareItem[]): string[][] {
  const headers = [
    'square_item_id', 'square_variation_id', 'name', 'variation_name',
    'display_name', 'description', 'price', 'price_cents', 'display_price',
    'square_category', 'kds_category', 'sort_order', 'is_visible',
  ]
  const rows = [headers]
  for (const item of menuItems) {
    rows.push([
      item.square_item_id, item.square_variation_id, item.name, item.variation_name,
      item.display_name, item.description, item.price, String(item.price_cents),
      item.display_price, item.square_category, item.kds_category,
      String(item.sort_order), String(item.is_visible),
    ])
  }
  return rows
}

function buildCategoriesTab(): string[][] {
  return [
    ['slug', 'name', 'screen', 'position', 'sort_order', 'color'],
    ['hot-drinks', 'Hot Drinks', 'drinks', 'top-left', '1', ''],
    ['espressos', 'Espressos', 'drinks', 'top-right', '2', ''],
    ['cold-drinks', 'Cold Drinks', 'drinks', 'bottom-left', '3', ''],
    ['blended', 'Blended', 'drinks', 'bottom-right', '4', ''],
    ['frappuccinos-coffee', 'Frappuccinos - Coffee', 'drinks', 'right', '5', ''],
    ['frappuccinos-creme', 'Frappuccinos - Crème (Coffee-Free)', 'drinks', 'right', '6', ''],
    ['refreshers', 'Refreshers', 'drinks', 'middle-right', '7', ''],
    ['breakfast', 'Breakfast', 'food', 'top-left', '1', ''],
    ['pastries', 'Pastries', 'food', 'top-right', '2', ''],
    ['sandwiches', 'Sandwiches', 'food', 'bottom-left', '3', ''],
    ['snacks', 'Snacks', 'food', 'bottom-right', '4', ''],
  ]
}

function buildImagesTab(): string[][] {
  return [
    ['screen', 'filename', 'alt_text', 'sort_order', 'is_active'],
    ['drinks', 'espresso-pour.jpg', 'Fresh espresso being poured', '1', 'true'],
    ['drinks', 'latte-art.jpg', 'Latte with beautiful art', '2', 'true'],
    ['drinks', 'iced-coffee.jpg', 'Refreshing iced coffee', '3', 'true'],
    ['drinks', 'frappuccino.jpg', 'Blended frappuccino', '4', 'true'],
    ['food', 'breakfast-burrito.jpg', 'Hearty breakfast burrito', '1', 'true'],
    ['food', 'croissant.jpg', 'Flaky butter croissant', '2', 'true'],
    ['food', 'danish.jpg', 'Fresh baked danish', '3', 'true'],
    ['food', 'sandwich.jpg', 'Delicious sandwich', '4', 'true'],
  ]
}

function buildSettingsTab(): string[][] {
  return [
    ['key', 'value'],
    ['image_rotation_interval', '6000'],
    ['refresh_interval', '300000'],
    ['drinks_tagline', 'Freshly Brewed Every Day'],
    ['food_tagline', 'Baked Fresh Daily'],
    ['header_hours', '8AM-6PM Mon-Fri'],
    ['header_location', 'Kaiser Permanente · Denver'],
  ]
}

// ---------------------------------------------------------------------------
// Main server action
// ---------------------------------------------------------------------------

export async function generateKDSSetupSheet(
  tenantId: string,
  regenerate = false
): Promise<GenerateSheetResult> {
  try {
    const supabase = createServiceClient()

    // Check if sheet already exists
    const { data: existing } = await supabase
      .from('tenant_kds_sheets')
      .select('id, google_spreadsheet_id, google_sheet_url')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (existing && !regenerate) {
      return { success: false, error: 'SHEET_EXISTS' }
    }

    // Get tenant name for sheet title
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, slug')
      .eq('id', tenantId)
      .single()

    if (!tenant) {
      return { success: false, error: 'Tenant not found' }
    }

    // Get Square credentials
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return { success: false, error: 'NO_SQUARE_CREDENTIALS' }
    }

    // Fetch Square catalog
    const catalogObjects = await fetchSquareCatalog(
      squareConfig.accessToken,
      squareConfig.environment
    )
    const menuItems = extractMenuData(catalogObjects)

    // Build sheet tabs
    const menuRows = buildMenuItemsTab(menuItems)
    const categoryRows = buildCategoriesTab()
    const imageRows = buildImagesTab()
    const settingsRows = buildSettingsTab()

    // Create Google Spreadsheet
    const sheets = getSheets()
    const drive = getDrive()

    const sheetTitle = `${tenant.name} — KDS Setup`
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: sheetTitle },
        sheets: [
          { properties: { title: 'Menu Items', sheetId: 0 } },
          { properties: { title: 'Categories', sheetId: 1 } },
          { properties: { title: 'Images', sheetId: 2 } },
          { properties: { title: 'Settings', sheetId: 3 } },
        ],
      },
    })

    const spreadsheetId = created.data.spreadsheetId!

    // Populate all 4 tabs
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: 'Menu Items!A1', values: menuRows },
          { range: 'Categories!A1', values: categoryRows },
          { range: 'Images!A1', values: imageRows },
          { range: 'Settings!A1', values: settingsRows },
        ],
      },
    })

    // Set "anyone with the link can edit"
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { role: 'writer', type: 'anyone' },
    })

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`

    // Upsert reference in DB
    if (existing) {
      await supabase
        .from('tenant_kds_sheets')
        .update({
          google_spreadsheet_id: spreadsheetId,
          google_sheet_url: sheetUrl,
          last_synced_at: null,
          last_imported_at: null,
        })
        .eq('tenant_id', tenantId)
    } else {
      await supabase
        .from('tenant_kds_sheets')
        .insert({
          tenant_id: tenantId,
          google_spreadsheet_id: spreadsheetId,
          google_sheet_url: sheetUrl,
        })
    }

    revalidatePath('/admin/kds-config')

    return {
      success: true,
      sheetUrl,
      spreadsheetId,
      itemCount: menuItems.length,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[generateKDSSetupSheet]', message)
    return { success: false, error: message }
  }
}
