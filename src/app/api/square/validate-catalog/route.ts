import { NextRequest, NextResponse } from 'next/server'
import { listCatalogObjects } from '@/lib/square/fetch-client'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

interface CatalogObject {
  id: string
  type: string
  item_data?: { name?: string }
  item_variation_data?: { name?: string }
  category_data?: { name?: string }
}

export async function POST(request: NextRequest) {
  // Resolve tenant and load Square config
  const tenantId = await getCurrentTenantId()
  const squareConfig = await getTenantSquareConfig(tenantId)
  if (!squareConfig) {
    return NextResponse.json(
      { error: 'Square integration not configured for this tenant' },
      { status: 503 }
    )
  }

  try {
    const { catalogObjectId } = await request.json()

    if (!catalogObjectId) {
      return NextResponse.json({ error: 'catalogObjectId required' }, { status: 400 })
    }

    console.log('Validating catalog object ID:', catalogObjectId)

    // Fetch all catalog objects to see what's available
    const catalogData = await listCatalogObjects(squareConfig, ['ITEM', 'ITEM_VARIATION', 'CATEGORY'])
    
    if (!catalogData.objects) {
      return NextResponse.json({
        error: 'No catalog objects found',
        exists: false
      })
    }
    
    // Check if the specific ID exists
    const objects = (catalogData.objects || []) as CatalogObject[]
    const foundObject = objects.find((obj) => obj.id === catalogObjectId)
    
    return NextResponse.json({
      exists: !!foundObject,
      objectDetails: foundObject || null,
      totalCatalogObjects: objects.length,
      allObjectIds: objects.map((obj) => ({
        id: obj.id,
        type: obj.type,
        name: obj.item_data?.name || obj.item_variation_data?.name || obj.category_data?.name || 'Unknown'
      }))
    })
    
  } catch (error) {
    console.error('Error validating catalog object:', error)
    return NextResponse.json({
      error: 'Failed to validate catalog object',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
