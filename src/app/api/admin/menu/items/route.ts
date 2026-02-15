import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { searchAllCatalogItems, upsertCatalogItem, listCatalogObjects, upsertCatalogCategory } from '@/lib/square/fetch-client'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

interface CatalogVariation {
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

interface CatalogItemData {
  name: string
  description?: string
  categories?: { id: string }[]
  category_id?: string
  available_for_pickup?: boolean
  available_online?: boolean
  variations?: CatalogVariation[]
  image_url?: string
  ordinal?: number
  [key: string]: unknown
}

interface CatalogCategoryData {
  name?: string
  item_ids?: string[]
}

interface CatalogObject {
  id: string
  type: string
  version?: number
  updated_at?: string
  item_data?: CatalogItemData
  category_data?: CatalogCategoryData
}

interface CatalogResponse {
  objects?: CatalogObject[]
}

interface VariationInput {
  name: string
  price: number
}

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult // Return the error response
    }

    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json({ error: 'Square not configured' }, { status: 503 })
    }

    console.log('Admin fetching menu items for management...')

    // Fetch all catalog items from Square
    const catalogResult = await searchAllCatalogItems(squareConfig) as CatalogResponse
    
    if (!catalogResult.objects) {
      return NextResponse.json(
        { error: 'No menu items found' },
        { status: 404 }
      )
    }

    // Separate items and categories
    const allItems = catalogResult.objects.filter(obj => obj.type === 'ITEM' && obj.item_data) as CatalogObject[]
    const allCategories = catalogResult.objects.filter(obj => obj.type === 'CATEGORY')
    
    // Create category lookup map
    const categoryMap = new Map<string, string>()
    allCategories.forEach(category => {
      if (category.id && category.category_data?.name) {
        categoryMap.set(category.id, category.category_data.name)
      }
    })

    console.log('📂 Found categories:', Array.from(categoryMap.entries()))

    // Process items for admin management view
    const items = allItems.map(item => {
      const itemData = item.item_data as CatalogItemData
      // Get category name from category lookup
      const categoryId = itemData.categories?.[0]?.id || itemData.category_id
      const categoryName = categoryId ? categoryMap.get(categoryId) || 'Uncategorized' : 'Uncategorized'
      
      // Debug category mapping for new items
      if (categoryName === 'Uncategorized') {
        console.log('🔍 Debug item with no category:', {
          itemName: itemData.name,
          categoryId,
          categoriesArray: itemData.categories,
          categoryIdField: itemData.category_id,
          availableCategories: Array.from(categoryMap.keys())
        })
      }
      
      return {
        id: item.id,
        name: itemData.name,
        description: itemData.description || '',
        categoryId: categoryId,
        categoryName: categoryName,
        isAvailable: itemData.available_for_pickup !== false && itemData.available_online !== false,
        variations: itemData.variations?.map((variation: CatalogVariation) => ({
          id: variation.id,
          name: variation.item_variation_data.name,
          price: variation.item_variation_data.price_money?.amount || 0,
          currency: variation.item_variation_data.price_money?.currency || 'USD',
          isDefault: variation.item_variation_data.ordinal === 0
        })) || [],
        imageUrl: itemData.image_url,
        ordinal: itemData.ordinal || 0,
        lastUpdated: item.updated_at,
        version: item.version
      }
    })

    // Sort items by category and name
    items.sort((a, b) => {
      if (a.categoryName !== b.categoryName) {
        return a.categoryName.localeCompare(b.categoryName)
      }
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({
      success: true,
      items,
      categories: allCategories,
      total: items.length,
      message: 'Menu items fetched successfully'
    })
    
  } catch (error) {
    console.error('Failed to fetch admin menu items:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch menu items', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json({ error: 'Square not configured' }, { status: 503 })
    }

    const body = await request.json()
    const { name, description, categoryId, isAvailable, variations } = body

    if (!name || !categoryId || !variations?.length) {
      return NextResponse.json(
        { error: 'Missing required fields: name, categoryId, and variations' },
        { status: 400 }
      )
    }

    console.log('Creating new menu item:', { name, categoryId, variations: variations.length })

    // Create Square catalog item object (matching seed script format exactly)
    const itemObject = {
      type: 'ITEM',
      id: `#item-${Date.now()}`,
      item_data: {
        name: name.trim(),
        description: description?.trim() || '',
        categories: [{ id: categoryId }],
        available_for_pickup: isAvailable,
        available_online: isAvailable,
        variations: variations.map((variation: VariationInput, index: number) => ({
          type: 'ITEM_VARIATION',
          id: `#variation-${Date.now()}-${index}`,
          item_variation_data: {
            name: variation.name.trim(),
            pricing_type: 'FIXED_PRICING',
            price_money: {
              amount: Math.round(variation.price * 100), // Convert dollars to cents
              currency: 'USD'
            }
          }
        }))
      }
    }

    console.log('📝 Item object being sent to Square:', JSON.stringify(itemObject, null, 2))

    // Create the item in Square
    const result = await upsertCatalogItem(squareConfig, itemObject)
    
    if (!result.catalog_object) {
      throw new Error('Failed to create item in Square catalog')
    }

    const createdItemId = result.catalog_object.id
    console.log('✅ Successfully created menu item:', createdItemId)

    // Now update the category to include this item
    try {
      // Fetch the current category
      const categoriesResult = await listCatalogObjects(squareConfig, ['CATEGORY']) as CatalogResponse
      const targetCategory = categoriesResult.objects?.find(cat => cat.id === categoryId)
      
      if (targetCategory) {
        console.log('📂 Updating category to include new item...')
        
        // Update category to include the new item
        const updatedCategory = {
          ...targetCategory,
          category_data: {
            ...targetCategory.category_data,
            // Add the item to the category's items list if it exists
            item_ids: [...(targetCategory.category_data?.item_ids ?? []), createdItemId]
          }
        }
        
        await upsertCatalogCategory(squareConfig, updatedCategory)
        console.log('✅ Category updated with new item')
      }
    } catch (error) {
      console.log('⚠️ Could not update category, but item was created:', error)
    }

    return NextResponse.json({
      success: true,
      item: result.catalog_object,
      message: 'Menu item created successfully'
    })

  } catch (error) {
    console.error('Failed to create menu item:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create menu item', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
