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

interface UpdateItemRequest {
  name?: string
  description?: string
  categoryId?: string
  isAvailable?: boolean
  variations?: Array<{
    id: string
    name: string
    price: number
  }>
}

interface SquareVariation {
  id: string
  item_variation_data: {
    name: string
    price_money?: {
      amount?: number
      currency?: string
    }
    ordinal?: number
    [key: string]: unknown
  }
}

interface SquareItemObject {
  type: string
  item_data: {
    name?: string
    description?: string
    categories?: { id: string }[]
    category_id?: string
    available_for_pickup?: boolean
    available_online?: boolean
    variations?: SquareVariation[]
    image_url?: string
    ordinal?: number
    [key: string]: unknown
  }
  version?: number
  updated_at?: string
  [key: string]: unknown
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
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

    const resolvedParams = await params
    const { itemId } = resolvedParams
    const updateData: UpdateItemRequest = await request.json()

    console.log(`Admin updating menu item ${itemId}:`, updateData)

    // First, get the current item to preserve structure
    const currentItemResponse = await fetch(
      `${baseUrl}/v2/catalog/object/${itemId}`,
      {
        method: 'GET',
        headers: getHeaders(squareConfig)
      }
    )

    if (!currentItemResponse.ok) {
      const errorData = await currentItemResponse.text()
      throw new Error(`Failed to fetch current item: ${currentItemResponse.status} ${errorData}`)
    }

    const currentItemResult = await currentItemResponse.json()
    const currentItem = currentItemResult.object as SquareItemObject | null

    if (!currentItem || currentItem.type !== 'ITEM') {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    // Prepare the updated item data
    const updatedItem = {
      ...currentItem,
      item_data: {
        ...currentItem.item_data,
        ...(updateData.name && { name: updateData.name }),
        ...(updateData.description !== undefined && { description: updateData.description }),
        ...(updateData.categoryId !== undefined && { 
          categories: updateData.categoryId ? [{ id: updateData.categoryId }] : []
        }),
        ...(updateData.isAvailable !== undefined && { 
          available_for_pickup: updateData.isAvailable,
          available_online: updateData.isAvailable 
        })
      }
    }

    // Update variations if provided
    if (updateData.variations && updateData.variations.length > 0) {
      updatedItem.item_data.variations = currentItem.item_data.variations?.map((variation: SquareVariation) => {
        const updateVariation = updateData.variations?.find(v => v.id === variation.id)
        if (updateVariation) {
          return {
            ...variation,
            item_variation_data: {
              ...variation.item_variation_data,
              name: updateVariation.name,
              price_money: {
                amount: updateVariation.price,
                currency: 'USD'
              }
            }
          }
        }
        return variation
      })
    }

    // Update the item in Square
    const updateResponse = await fetch(`${baseUrl}/v2/catalog/batch-upsert`, {
      method: 'POST',
      headers: getHeaders(squareConfig),
      body: JSON.stringify({
        idempotency_key: `admin-update-${itemId}-${Date.now()}`,
        batches: [
          {
            objects: [updatedItem]
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
      item: result.objects?.[0],
      message: 'Menu item updated successfully'
    })
    
  } catch (error) {
    console.error('Failed to update menu item:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update menu item', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
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

    const resolvedParams = await params
    const { itemId } = resolvedParams

    console.log(`Admin deleting menu item ${itemId}`)

    // Delete the item from Square catalog
    const deleteResponse = await fetch(`${baseUrl}/v2/catalog/object/${itemId}`, {
      method: 'DELETE',
      headers: getHeaders(squareConfig)
    })

    if (!deleteResponse.ok) {
      const errorData = await deleteResponse.text()
      throw new Error(`Square API error: ${deleteResponse.status} ${errorData}`)
    }

    return NextResponse.json({
      success: true,
      message: 'Menu item deleted successfully'
    })
    
  } catch (error) {
    console.error('Failed to delete menu item:', error)
    return NextResponse.json(
      { 
        error: 'Failed to delete menu item', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
