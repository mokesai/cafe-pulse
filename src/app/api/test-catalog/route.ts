import { NextResponse } from 'next/server'
import { fetchMenuCategories } from '@/lib/square/catalog'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

export async function GET() {
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
    const categories = await fetchMenuCategories(squareConfig)
    
    return NextResponse.json({
      success: true,
      message: 'Square Catalog API test successful',
      categoriesCount: categories.length,
      categories: categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        itemCount: cat.items.length
      }))
    })
  } catch (error) {
    console.error('Catalog test failed:', error)
    
    return NextResponse.json({
      success: false,
      message: 'Square Catalog API test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}