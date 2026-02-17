/**
 * Kitchen Display System (KDS) Database Queries
 * Supabase queries for fetching and managing KDS data
 */

import { createServiceClient } from '@/lib/supabase/server'
import type {
  KDSBulletColor,
  KDSCategory,
  KDSCategoryRow,
  KDSCategoryWithItems,
  KDSDisplayType,
  KDSImage,
  KDSImageRow,
  KDSMenuItem,
  KDSMenuItemRow,
  KDSScreen,
  KDSScreenData,
  KDSSettingRow,
  KDSSettingsMap,
} from './types'

// Row mappers

function mapCategoryRow(row: KDSCategoryRow): KDSCategory {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    screen: row.screen as KDSScreen,
    position: row.position as KDSCategory['position'] | undefined,
    sortOrder: row.sort_order,
    color: row.color ?? undefined,
    icon: row.icon as KDSCategory['icon'] | undefined,
    displayType: row.display_type as KDSDisplayType | undefined,
    showSizeHeader: row.show_size_header ?? true,
    headerText: row.header_text ?? undefined,
    sizeLabels: row.size_labels?.split('|') ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMenuItemRow(row: KDSMenuItemRow): KDSMenuItem {
  return {
    id: row.id,
    squareItemId: row.square_item_id ?? undefined,
    squareVariationId: row.square_variation_id ?? undefined,
    name: row.name,
    displayName: row.display_name ?? undefined,
    variationName: row.variation_name ?? undefined,
    priceCents: row.price_cents,
    displayPrice: row.display_price ?? undefined,
    categoryId: row.category_id ?? '',
    sortOrder: row.sort_order,
    isVisible: row.is_visible,
    displayType: row.display_type as KDSDisplayType | undefined,
    featured: row.featured ?? false,
    bulletColor: row.bullet_color as KDSBulletColor | undefined,
    parentItem: row.parent_item ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapImageRow(row: KDSImageRow): KDSImage {
  return {
    id: row.id,
    screen: row.screen as KDSScreen,
    filename: row.filename,
    altText: row.alt_text ?? undefined,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
  }
}

// Category queries

export async function getCategories(tenantId: string, screen?: KDSScreen): Promise<KDSCategory[]> {
  const supabase = createServiceClient()

  let query = supabase
    .from('kds_categories')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (screen) {
    query = query.eq('screen', screen)
  }

  const { data, error } = await query

  if (error) {
    console.error('Failed to fetch KDS categories:', error)
    return []
  }

  return (data as KDSCategoryRow[]).map(mapCategoryRow)
}

export async function getCategoryBySlug(tenantId: string, slug: string): Promise<KDSCategory | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('kds_categories')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch KDS category:', error)
    return null
  }

  return data ? mapCategoryRow(data as KDSCategoryRow) : null
}

// Menu item queries

export async function getMenuItems(tenantId: string, categoryId?: string): Promise<KDSMenuItem[]> {
  const supabase = createServiceClient()

  let query = supabase
    .from('kds_menu_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_visible', true)
    .order('sort_order', { ascending: true })

  if (categoryId) {
    query = query.eq('category_id', categoryId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Failed to fetch KDS menu items:', error)
    return []
  }

  return (data as KDSMenuItemRow[]).map(mapMenuItemRow)
}

export async function getMenuItemsByScreen(tenantId: string, screen: KDSScreen): Promise<KDSMenuItem[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('kds_menu_items')
    .select(`
      *,
      kds_categories!inner(screen)
    `)
    .eq('tenant_id', tenantId)
    .eq('kds_categories.screen', screen)
    .eq('is_visible', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Failed to fetch KDS menu items by screen:', error)
    return []
  }

  return (data as KDSMenuItemRow[]).map(mapMenuItemRow)
}

// Image queries

export async function getImages(tenantId: string, screen?: KDSScreen): Promise<KDSImage[]> {
  const supabase = createServiceClient()

  let query = supabase
    .from('kds_images')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (screen) {
    query = query.eq('screen', screen)
  }

  const { data, error } = await query

  if (error) {
    console.error('Failed to fetch KDS images:', error)
    return []
  }

  return (data as KDSImageRow[]).map(mapImageRow)
}

// Settings queries

export async function getSettings(tenantId: string): Promise<Partial<KDSSettingsMap>> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('kds_settings')
    .select('*')
    .eq('tenant_id', tenantId)

  if (error) {
    console.error('Failed to fetch KDS settings:', error)
    return {}
  }

  const settings: Record<string, unknown> = {}
  for (const row of data as KDSSettingRow[]) {
    settings[row.key] = row.value
  }

  return settings as Partial<KDSSettingsMap>
}

export async function getSetting<K extends keyof KDSSettingsMap>(
  tenantId: string,
  key: K
): Promise<KDSSettingsMap[K] | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('kds_settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', key)
    .maybeSingle()

  if (error) {
    console.error(`Failed to fetch KDS setting ${key}:`, error)
    return null
  }

  return data?.value as KDSSettingsMap[K] | null
}

// Combined queries for display

export async function getCategoriesWithItems(tenantId: string, screen: KDSScreen): Promise<KDSCategoryWithItems[]> {
  const categories = await getCategories(tenantId, screen)
  const categoriesWithItems: KDSCategoryWithItems[] = []

  for (const category of categories) {
    const items = await getMenuItems(tenantId, category.id)
    categoriesWithItems.push({
      ...category,
      items,
    })
  }

  return categoriesWithItems
}

export async function getScreenData(tenantId: string, screen: KDSScreen): Promise<KDSScreenData> {
  const [categories, images, settings] = await Promise.all([
    getCategoriesWithItems(tenantId, screen),
    getImages(tenantId, screen),
    getSettings(tenantId),
  ])

  const taglineKey = screen === 'drinks' ? 'drinks_tagline' : 'food_tagline'
  const tagline = (settings[taglineKey] as string) || ''

  return {
    screen,
    categories,
    images,
    tagline,
    settings,
  }
}

// Upsert operations (for import scripts)

export async function upsertCategory(tenantId: string, category: Omit<KDSCategory, 'id' | 'createdAt' | 'updatedAt'>): Promise<KDSCategory | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('kds_categories')
    .upsert({
      tenant_id: tenantId,
      name: category.name,
      slug: category.slug,
      screen: category.screen,
      position: category.position ?? null,
      sort_order: category.sortOrder,
      color: category.color ?? null,
      icon: category.icon ?? null,
      display_type: category.displayType ?? null,
      show_size_header: category.showSizeHeader ?? true,
      header_text: category.headerText ?? null,
      size_labels: category.sizeLabels?.join('|') ?? null,
    }, {
      onConflict: 'slug',
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to upsert KDS category:', error)
    return null
  }

  return mapCategoryRow(data as KDSCategoryRow)
}

export async function upsertMenuItem(
  tenantId: string,
  item: Omit<KDSMenuItem, 'id' | 'createdAt' | 'updatedAt'>,
  categorySlug: string
): Promise<KDSMenuItem | null> {
  const supabase = createServiceClient()

  // Get category ID from slug (tenant-scoped)
  const category = await getCategoryBySlug(tenantId, categorySlug)
  if (!category) {
    console.error(`Category not found: ${categorySlug}`)
    return null
  }

  const { data, error } = await supabase
    .from('kds_menu_items')
    .upsert({
      tenant_id: tenantId,
      square_item_id: item.squareItemId ?? null,
      square_variation_id: item.squareVariationId ?? null,
      name: item.name,
      display_name: item.displayName ?? null,
      price_cents: item.priceCents,
      display_price: item.displayPrice ?? null,
      category_id: category.id,
      sort_order: item.sortOrder,
      is_visible: item.isVisible,
      display_type: item.displayType ?? null,
      featured: item.featured ?? false,
      bullet_color: item.bulletColor ?? null,
      parent_item: item.parentItem ?? null,
    }, {
      onConflict: 'tenant_id,square_variation_id',
      ignoreDuplicates: false,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to upsert KDS menu item:', error)
    return null
  }

  return mapMenuItemRow(data as KDSMenuItemRow)
}

export async function upsertImage(tenantId: string, image: Omit<KDSImage, 'id' | 'createdAt'>): Promise<KDSImage | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('kds_images')
    .upsert({
      tenant_id: tenantId,
      screen: image.screen,
      filename: image.filename,
      alt_text: image.altText ?? null,
      sort_order: image.sortOrder,
      is_active: image.isActive,
    }, {
      onConflict: 'tenant_id,filename',
      ignoreDuplicates: false,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to upsert KDS image:', error)
    return null
  }

  return mapImageRow(data as KDSImageRow)
}

export async function updateSetting<K extends keyof KDSSettingsMap>(
  tenantId: string,
  key: K,
  value: KDSSettingsMap[K]
): Promise<boolean> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('kds_settings')
    .upsert({
      tenant_id: tenantId,
      key,
      value: value as unknown,
    }, {
      onConflict: 'tenant_id,key',
    })

  if (error) {
    console.error(`Failed to update KDS setting ${key}:`, error)
    return false
  }

  return true
}

// Delete operations

export async function deleteAllMenuItems(tenantId: string): Promise<boolean> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('kds_menu_items')
    .delete()
    .eq('tenant_id', tenantId)
    .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all for this tenant

  if (error) {
    console.error('Failed to delete KDS menu items:', error)
    return false
  }

  return true
}

export async function deleteAllCategories(tenantId: string): Promise<boolean> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('kds_categories')
    .delete()
    .eq('tenant_id', tenantId)
    .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all for this tenant

  if (error) {
    console.error('Failed to delete KDS categories:', error)
    return false
  }

  return true
}
