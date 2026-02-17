import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'
import { listCatalogObjects } from '@/lib/square/fetch-client'

type SquareCatalogObject = {
  type?: string
  id?: string
  is_deleted?: boolean
  item_data?: {
    name?: string
    category_id?: string
    product_type?: string
    variations?: Array<{ id?: string }>
  }
  item_variation_data?: {
    item_id?: string
    name?: string
  }
  category_data?: {
    name?: string
  }
}

async function fetchAllSquareCatalogObjects(config: ReturnType<typeof getTenantSquareConfig> extends Promise<infer T> ? T : never, objectTypes: string[]) {
  if (!config) return []

  const objects: SquareCatalogObject[] = []
  let cursor: string | undefined
  let pages = 0

  while (pages < 25) {
    pages += 1
    const payload = (await listCatalogObjects(config, objectTypes, cursor)) as { objects?: unknown[]; cursor?: unknown }

    const batch = Array.isArray(payload.objects) ? (payload.objects as SquareCatalogObject[]) : []
    objects.push(...batch)

    cursor = typeof payload.cursor === 'string' ? payload.cursor : undefined
    if (!cursor) break
  }

  return objects
}

function buildSellableName(itemName: string, variationName: string) {
  const normalizedItem = itemName.trim()
  const normalizedVariation = variationName.trim()
  if (!normalizedItem) return normalizedVariation
  if (!normalizedVariation || normalizedVariation === 'Regular' || normalizedVariation === normalizedItem) return normalizedItem
  return `${normalizedItem} - ${normalizedVariation}`
}

function isAllowedProductType(value: string | null) {
  if (!value) return true
  return value === 'REGULAR' || value === 'FOOD_AND_BEV'
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  // Resolve tenant and load Square config
  const tenantId = await getCurrentTenantId()
  const squareConfig = await getTenantSquareConfig(tenantId)
  if (!squareConfig) {
    return NextResponse.json({ error: 'Square not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === '1'

  try {
    const objects = await fetchAllSquareCatalogObjects(squareConfig, ['ITEM', 'ITEM_VARIATION', 'CATEGORY'])

    const categoryNameById = new Map<string, string>()
    for (const obj of objects) {
      if (obj.type !== 'CATEGORY') continue
      if (typeof obj.id !== 'string') continue
      const name = typeof obj.category_data?.name === 'string' ? obj.category_data.name.trim() : ''
      if (!name) continue
      categoryNameById.set(obj.id, name)
    }

    const productsToUpsert: Array<{ square_item_id: string; name: string; category: string | null; is_active: boolean }> = []
    const variationsToUpsert: Array<{ square_variation_id: string; square_item_id: string; name: string; is_active: boolean }> = []

    let itemsSeen = 0
    let categoriesSeen = 0
    let itemsSkippedNonRegular = 0
    let itemsSkippedMissingName = 0
    let variationsSeen = 0
    let variationsSkippedMissingName = 0
    let variationsSkippedMissingItemId = 0
    let variationsSkippedMissingProduct = 0
    const productTypeCounts: Record<string, number> = {}
    const productTypeExamples: Array<{ id: string; name: string; product_type: string | null }> = []

    const productNameBySquareItemId = new Map<string, string>()

    for (const obj of objects) {
      if (obj.type === 'CATEGORY') {
        categoriesSeen += 1
        continue
      }
      if (obj.type !== 'ITEM') continue
      if (typeof obj.id !== 'string') continue
      itemsSeen += 1
      const itemName = typeof obj.item_data?.name === 'string' ? obj.item_data.name.trim() : ''
      if (!itemName) {
        itemsSkippedMissingName += 1
        continue
      }

      const productType = typeof obj.item_data?.product_type === 'string' ? obj.item_data.product_type : null
      if (productType) {
        productTypeCounts[productType] = (productTypeCounts[productType] ?? 0) + 1
      } else {
        productTypeCounts['(missing)'] = (productTypeCounts['(missing)'] ?? 0) + 1
      }
      if (productTypeExamples.length < 10) {
        productTypeExamples.push({ id: obj.id, name: itemName, product_type: productType })
      }
      if (!isAllowedProductType(productType)) {
        itemsSkippedNonRegular += 1
        continue
      }

      const categoryId = typeof obj.item_data?.category_id === 'string' ? obj.item_data.category_id : null
      const categoryName = categoryId ? (categoryNameById.get(categoryId) ?? null) : null
      const isActive = obj.is_deleted !== true

      productsToUpsert.push({
        square_item_id: obj.id,
        name: itemName,
        category: categoryName,
        is_active: isActive,
      })

      productNameBySquareItemId.set(obj.id, itemName)
    }

    for (const obj of objects) {
      if (obj.type !== 'ITEM_VARIATION') continue
      if (typeof obj.id !== 'string') continue
      variationsSeen += 1

      const itemId = typeof obj.item_variation_data?.item_id === 'string' ? obj.item_variation_data.item_id : ''
      if (!itemId) {
        variationsSkippedMissingItemId += 1
        continue
      }
      const productName = productNameBySquareItemId.get(itemId)
      if (!productName) {
        variationsSkippedMissingProduct += 1
        continue
      }

      const variationName = typeof obj.item_variation_data?.name === 'string' ? obj.item_variation_data.name : ''
      const sellableName = buildSellableName(productName, variationName)
      if (!sellableName) {
        variationsSkippedMissingName += 1
        continue
      }

      variationsToUpsert.push({
        square_variation_id: obj.id,
        square_item_id: itemId,
        name: sellableName,
        is_active: obj.is_deleted !== true,
      })
    }

    const debug = {
      squareObjects: objects.length,
      itemsSeen,
      categoriesSeen,
      itemsSkippedNonRegular,
      itemsSkippedMissingName,
      variationsSeen,
      variationsSkippedMissingName,
      variationsSkippedMissingItemId,
      variationsSkippedMissingProduct,
      productTypeCounts,
      productTypeExamples,
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        productsFound: productsToUpsert.length,
        sellablesFound: variationsToUpsert.length,
        debug,
      })
    }

    const supabase = createServiceClient()

    if (productsToUpsert.length > 0) {
      const { error } = await supabase
        .from('cogs_products')
        .upsert(productsToUpsert.map(p => ({ ...p, tenant_id: tenantId })), { onConflict: 'tenant_id,square_item_id' })

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const squareItemIds = Array.from(new Set(productsToUpsert.map(p => p.square_item_id)))
    const { data: productRows, error: productMapError } = squareItemIds.length === 0
      ? { data: [], error: null as null | { message: string } }
      : await supabase
        .from('cogs_products')
        .select('id,square_item_id')
        .eq('tenant_id', tenantId)
        .in('square_item_id', squareItemIds)

    if (productMapError) return NextResponse.json({ error: productMapError.message }, { status: 500 })

    const productIdBySquareItemId = new Map<string, string>()
    for (const row of productRows ?? []) {
      if (!row || typeof row !== 'object') continue
      const r = row as { id?: unknown; square_item_id?: unknown }
      if (typeof r.id !== 'string' || typeof r.square_item_id !== 'string') continue
      productIdBySquareItemId.set(r.square_item_id, r.id)
    }

    const sellablesToUpsert = variationsToUpsert
      .map(v => {
        const productId = productIdBySquareItemId.get(v.square_item_id)
        if (!productId) return null
        return {
          tenant_id: tenantId,
          square_variation_id: v.square_variation_id,
          product_id: productId,
          name: v.name,
          is_active: v.is_active,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    if (sellablesToUpsert.length > 0) {
      const { error } = await supabase
        .from('cogs_sellables')
        .upsert(sellablesToUpsert, { onConflict: 'tenant_id,square_variation_id' })

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      productsUpserted: productsToUpsert.length,
      sellablesUpserted: sellablesToUpsert.length,
      debug,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to sync from Square' },
      { status: 500 }
    )
  }
}
