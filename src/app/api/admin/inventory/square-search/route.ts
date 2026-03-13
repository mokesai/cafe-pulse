import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

const SQUARE_VERSION = '2024-12-18'

interface SquareCatalogObject {
  id: string
  is_deleted?: boolean
  item_data?: {
    name?: string
    is_archived?: boolean
    variations?: Array<{
      id: string
      is_deleted?: boolean
      item_variation_data?: {
        name?: string
        sku?: string
        price_money?: {
          amount?: number
          currency?: string
        }
      }
    }>
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    // Resolve tenant and load Square config
    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json({ error: 'Square not configured' }, { status: 503 })
    }

    const query = request.nextUrl.searchParams.get('q')?.trim()
    if (!query || query.length < 2) {
      return NextResponse.json(
        { success: false, error: 'Search term must be at least 2 characters' },
        { status: 400 }
      )
    }

    const displayLimit = Math.min(
      Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '20', 10), 1),
      100
    )

    // Fetch a larger batch from Square so we can filter and rank locally
    const fetchLimit = Math.min(displayLimit * 4, 100)

    const baseUrl = squareConfig.environment === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com'

    const response = await fetch(`${baseUrl}/v2/catalog/search`, {
      method: 'POST',
      headers: {
        'Square-Version': SQUARE_VERSION,
        Authorization: `Bearer ${squareConfig.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        object_types: ['ITEM'],
        query: {
          text_query: {
            keywords: [query.slice(0, 100)]
          }
        },
        include_related_objects: false,
        limit: fetchLimit
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Square search error:', errorText)
      return NextResponse.json(
        { success: false, error: 'Square search failed' },
        { status: 502 }
      )
    }

    const payload = await response.json()
    const objects: SquareCatalogObject[] = payload.objects || []

    // Filter out archived and deleted items
    const activeObjects = objects.filter(
      (item) => !item.is_deleted && !item.item_data?.is_archived
    )

    // Sort by relevance: exact match first, then starts-with, then contains
    const queryLower = query.toLowerCase()
    const scored = activeObjects.map((item) => {
      const name = (item.item_data?.name || '').toLowerCase()
      let score = 0
      if (name === queryLower) score = 3           // exact match
      else if (name.startsWith(queryLower)) score = 2  // starts with query
      else if (name.includes(queryLower)) score = 1    // contains query
      return { item, score }
    })
    scored.sort((a, b) => b.score - a.score)

    const results = scored.flatMap(({ item }) => {
      const itemName = item.item_data?.name || 'Unnamed Item'
      const variations = (item.item_data?.variations || []).filter((v) => !v.is_deleted)
      if (variations.length === 0) {
        return [
          {
            itemId: item.id,
            itemName,
            variationId: item.id,
            variationName: 'Default',
            sku: undefined,
            price: undefined,
            currency: undefined
          }
        ]
      }

      return variations.map((variation) => ({
        itemId: item.id,
        itemName,
        variationId: variation.id,
        variationName: variation.item_variation_data?.name || 'Variation',
        sku: variation.item_variation_data?.sku || undefined,
        price:
          typeof variation.item_variation_data?.price_money?.amount === 'number'
            ? variation.item_variation_data?.price_money?.amount / 100
            : undefined,
        currency: variation.item_variation_data?.price_money?.currency
      }))
    })

    return NextResponse.json({
      success: true,
      results: results.slice(0, displayLimit)
    })
  } catch (error) {
    console.error('Square catalog search failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unexpected error searching Square catalog'
      },
      { status: 500 }
    )
  }
}
