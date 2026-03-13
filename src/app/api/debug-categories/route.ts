import { NextResponse } from 'next/server'
import { searchAllCatalogItems } from '@/lib/square/fetch-client'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

interface CatalogCategoryData {
  name?: string
  parent_category?: { id: string }
}

interface CatalogObjectSummary {
  id: string
  type: string
  category_data?: CatalogCategoryData
  is_deleted?: boolean
  present_at_all_locations?: boolean
}

export async function GET() {
  try {
    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json({ error: 'Square not configured' }, { status: 503 })
    }

    console.log('🔍 Debug: Fetching Square catalog for category analysis...')

    const catalogData = await searchAllCatalogItems(squareConfig) as { objects?: CatalogObjectSummary[] }
    
    if (!catalogData.objects) {
      return NextResponse.json({ 
        message: 'No catalog objects found',
        totalObjects: 0
      })
    }

    // Analyze catalog objects by type
    const objectsByType = catalogData.objects.reduce<Record<string, number>>((acc, obj) => {
      acc[obj.type] = (acc[obj.type] || 0) + 1
      return acc
    }, {})

    // Get all categories
    const rawCategories = catalogData.objects.filter((obj): obj is CatalogObjectSummary & { category_data?: CatalogCategoryData } => obj.type === 'CATEGORY')
    
    // Analyze category structure
    const categoryAnalysis = rawCategories.map(cat => ({
      id: cat.id,
      name: cat.category_data?.name || 'Unnamed',
      hasParent: !!cat.category_data?.parent_category,
      parentId: cat.category_data?.parent_category?.id || null,
      isDeleted: cat.is_deleted || false,
      presentAtAllLocations: cat.present_at_all_locations
    }))

    // Group by parent-child relationships
    const topLevel = categoryAnalysis.filter(cat => !cat.hasParent)
    const childCategories = categoryAnalysis.filter(cat => cat.hasParent)

    return NextResponse.json({
      success: true,
      totalObjects: catalogData.objects.length,
      objectsByType,
      totalCategories: rawCategories.length,
      categoriesWithParents: childCategories.length,
      topLevelCategories: topLevel.length,
      categoryAnalysis: {
        topLevel,
        children: childCategories
      }
    })

  } catch (error) {
    console.error('Debug categories error:', error)
    return NextResponse.json({
      error: 'Failed to debug categories',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
