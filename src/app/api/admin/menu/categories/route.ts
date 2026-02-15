import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { listCatalogObjects, upsertCatalogCategory, deleteCatalogObject } from '@/lib/square/fetch-client'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

interface CatalogObject {
  id: string
  type: string
  version?: number
  updated_at?: string
  category_data?: {
    name: string
    ordinal?: number
    parent_category?: string
  }
  item_data?: {
    category_id?: string
    categories?: { id: string }[]
  }
}

interface CatalogResponse {
  objects?: CatalogObject[]
}

export async function GET(request: NextRequest) {
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

    console.log('Admin fetching categories for management...')

    // Fetch all catalog objects
    const catalogResult = await listCatalogObjects(squareConfig, ['CATEGORY', 'ITEM']) as CatalogResponse
    
    if (!catalogResult.objects) {
      return NextResponse.json(
        { error: 'No catalog objects found' },
        { status: 404 }
      )
    }

    // Separate categories and items
    const allCategories = catalogResult.objects.filter(obj => obj.type === 'CATEGORY')
    const allItems = catalogResult.objects.filter(obj => obj.type === 'ITEM')
    
    // Create item count map by category
    const itemCountMap = new Map<string, number>()
    allItems.forEach(item => {
      const categoryId = item.item_data?.categories?.[0]?.id || item.item_data?.category_id
      if (categoryId) {
        itemCountMap.set(categoryId, (itemCountMap.get(categoryId) || 0) + 1)
      }
    })

    // Process categories for management view
    const categories = allCategories.map(category => ({
      id: category.id,
      name: category.category_data?.name || 'Unnamed Category',
      ordinal: category.category_data?.ordinal || 0,
      parentCategory: category.category_data?.parent_category,
      itemCount: itemCountMap.get(category.id) || 0,
      version: category.version,
      updatedAt: category.updated_at
    }))

    // Sort by ordinal then by name
    categories.sort((a, b) => {
      if (a.ordinal !== b.ordinal) {
        return a.ordinal - b.ordinal
      }
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({
      success: true,
      categories,
      total: categories.length,
      message: 'Categories fetched successfully'
    })
    
  } catch (error) {
    console.error('Failed to fetch categories:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch categories', 
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
    const { name, ordinal, parentCategory } = body

    if (!name) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      )
    }

    console.log('Creating new category:', { name, ordinal, parentCategory })

    // Create Square catalog category object
    const categoryObject = {
      type: 'CATEGORY',
      id: `#category-${Date.now()}`,
      category_data: {
        name: name.trim(),
        ordinal: ordinal || 999,
        ...(parentCategory && { parent_category: parentCategory })
      }
    }

    // Create the category in Square
    const result = await upsertCatalogCategory(squareConfig, categoryObject)
    
    if (!result.catalog_object) {
      throw new Error('Failed to create category in Square catalog')
    }

    console.log('✅ Successfully created category:', result.catalog_object.id)

    return NextResponse.json({
      success: true,
      category: result.catalog_object,
      message: 'Category created successfully'
    })

  } catch (error) {
    console.error('Failed to create category:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create category', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
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
    const { categoryId, name, ordinal } = body

    if (!categoryId || !name) {
      return NextResponse.json(
        { error: 'Category ID and name are required' },
        { status: 400 }
      )
    }

    console.log('Updating category:', { categoryId, name, ordinal })

    // Fetch the current category to get its version
    const catalogResult = await listCatalogObjects(squareConfig, ['CATEGORY']) as CatalogResponse
    const existingCategory = catalogResult.objects?.find(cat => cat.id === categoryId)
    
    if (!existingCategory) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    // Create updated category object
    const updatedCategoryObject = {
      type: 'CATEGORY',
      id: categoryId,
      version: existingCategory.version,
      category_data: {
        name: name.trim(),
        ordinal: ordinal || 999
      }
    }

    // Update the category in Square
    const result = await upsertCatalogCategory(squareConfig, updatedCategoryObject)
    
    if (!result.catalog_object) {
      throw new Error('Failed to update category in Square catalog')
    }

    console.log('✅ Successfully updated category:', result.catalog_object.id)

    return NextResponse.json({
      success: true,
      category: result.catalog_object,
      message: 'Category updated successfully'
    })

  } catch (error) {
    console.error('Failed to update category:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update category', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
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
    const { categoryId } = body

    if (!categoryId) {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      )
    }

    console.log('Deleting category:', { categoryId })

    // Fetch the category to check if it exists and has items
    const catalogResult = await listCatalogObjects(squareConfig, ['CATEGORY', 'ITEM']) as CatalogResponse
    const existingCategory = catalogResult.objects?.find(obj => obj.type === 'CATEGORY' && obj.id === categoryId)
    
    if (!existingCategory) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      )
    }

    // Check if category has items
    const categoryItems = catalogResult.objects?.filter(obj => 
      obj.type === 'ITEM' && 
      (obj.item_data?.categories?.[0]?.id === categoryId || obj.item_data?.category_id === categoryId)
    )

    if (categoryItems && categoryItems.length > 0) {
      return NextResponse.json(
        { error: `Cannot delete category with ${categoryItems.length} items. Move items to another category first.` },
        { status: 400 }
      )
    }

    // Delete the category from Square
    await deleteCatalogObject(squareConfig, categoryId)
    
    console.log('✅ Successfully deleted category:', categoryId)

    return NextResponse.json({
      success: true,
      message: 'Category deleted successfully'
    })

  } catch (error) {
    console.error('Failed to delete category:', error)
    return NextResponse.json(
      { 
        error: 'Failed to delete category', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
