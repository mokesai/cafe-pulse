import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'
import type { SquareConfig } from '@/lib/square/types'

const SQUARE_VERSION = '2024-12-18'

function getHeaders(config: SquareConfig) {
  return {
    'Square-Version': SQUARE_VERSION,
    'Authorization': `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json'
  }
}

interface BulkAvailabilityRequest {
  itemIds: string[]
  isAvailable: boolean
}

interface CatalogObject {
  id: string
  type: string
  item_data?: {
    available_for_pickup?: boolean
    available_online?: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface CatalogObjectResponse {
  object?: CatalogObject
}

export async function PATCH(request: NextRequest) {
  try {
    // Verify admin authentication
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

    const baseUrl = squareConfig.environment === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com'

    const { itemIds, isAvailable }: BulkAvailabilityRequest = await request.json()

    if (!itemIds || itemIds.length === 0) {
      return NextResponse.json(
        { error: 'No item IDs provided' },
        { status: 400 }
      )
    }

    console.log(`Admin bulk updating availability for ${itemIds.length} items to ${isAvailable}`)

    // Fetch current items to preserve their structure
    const fetchPromises = itemIds.map(async (itemId) => {
      const response = await fetch(`${baseUrl}/v2/catalog/object/${itemId}`, {
        method: 'GET',
        headers: getHeaders(squareConfig)
      })

      if (response.ok) {
        const result = await response.json() as CatalogObjectResponse
        return result.object ?? null
      }
      return null
    })

    const currentItems = (await Promise.all(fetchPromises)).filter((item): item is CatalogObject => Boolean(item))

    if (currentItems.length === 0) {
      return NextResponse.json(
        { error: 'No valid items found to update' },
        { status: 404 }
      )
    }

    // Update availability for all items
    const updatedItems = currentItems.map((item) => ({
      ...item,
      item_data: {
        ...item.item_data,
        available_for_pickup: isAvailable,
        available_online: isAvailable
      }
    }))

    // Batch update in Square
    const updateResponse = await fetch(`${baseUrl}/v2/catalog/batch-upsert`, {
      method: 'POST',
      headers: getHeaders(squareConfig),
      body: JSON.stringify({
        idempotency_key: `admin-bulk-availability-${Date.now()}`,
        batches: [
          {
            objects: updatedItems
          }
        ]
      })
    })

    if (!updateResponse.ok) {
      const errorData = await updateResponse.text()
      throw new Error(`Square API error: ${updateResponse.status} ${errorData}`)
    }

    const result = await updateResponse.json()

    return NextResponse.json({
      success: true,
      updatedCount: updatedItems.length,
      items: result.objects,
      message: `Successfully ${isAvailable ? 'enabled' : 'disabled'} ${updatedItems.length} menu items`
    })
    
  } catch (error) {
    console.error('Failed to update item availability:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update item availability', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
