import { NextResponse } from 'next/server'
import { listCatalogObjects, searchAllCatalogItems } from '@/lib/square/fetch-client'
import { sortMenuItems, sortMenuCategories } from '@/lib/constants/menu'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'
import type { MenuCategory, MenuItem as CanonicalMenuItem, MenuSubcategory as CanonicalMenuSubcategory } from '@/types/menu'

interface MenuResponse {
  categories: MenuCategory[]
  items: CanonicalMenuItem[]
  fallback?: boolean
  message?: string
  legalAttribution?: string
  lastUpdated?: string
}

// Tenant-scoped in-memory cache for menu data
const menuCacheByTenant = new Map<string, {
  data: MenuResponse
  timestamp: number
  ttl: number
}>()

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes in milliseconds

function isCacheValid(tenantId: string): boolean {
  const cache = menuCacheByTenant.get(tenantId)
  return cache !== null && cache !== undefined && Date.now() - cache.timestamp < cache.ttl
}

function getCachedMenu(tenantId: string): MenuResponse | null {
  if (isCacheValid(tenantId)) {
    console.log('✅ Serving menu from cache')
    return menuCacheByTenant.get(tenantId)!.data
  }
  return null
}

function setCachedMenu(tenantId: string, data: MenuResponse) {
  menuCacheByTenant.set(tenantId, {
    data,
    timestamp: Date.now(),
    ttl: CACHE_TTL
  })
  console.log('💾 Menu data cached for 5 minutes')
}

interface CatalogObject {
  id: string
  type: string
  is_deleted?: boolean
  present_at_all_locations?: boolean
  present_at_location_ids?: string[]
  absent_at_location_ids?: string[]
  item_data?: {
    name: string
    description?: string
    categories?: Array<{ id: string }>
    variations?: Array<{
      id: string
      item_variation_data: {
        name: string
        price_money?: { amount: number }
      }
    }>
    image_ids?: string[]
    is_deleted?: boolean
    is_archived?: boolean
    modifier_list_info?: Array<{
      modifier_list_id: string
      name?: string
    }>
  }
  category_data?: {
    name: string
    description?: string
    ordinal?: number
    parent_category?: {
      id: string
    }
  }
}

function isItemObject(obj: CatalogObject): obj is CatalogObject & { item_data: NonNullable<CatalogObject['item_data']> } {
  return obj.type === 'ITEM' && !!obj.item_data
}

function isCategoryObject(obj: CatalogObject): obj is CatalogObject & { category_data: NonNullable<CatalogObject['category_data']> } {
  return obj.type === 'CATEGORY' && !!obj.category_data
}

export async function GET() {
  try {
    // Resolve tenant and load Square config
    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json({
        categories: [],
        items: [],
        fallback: true,
        message: 'Square integration not configured for this tenant'
      })
    }

    // Check cache first
    const cachedMenu = getCachedMenu(tenantId)
    if (cachedMenu) {
      return NextResponse.json(cachedMenu, {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=300', // 5 minutes browser cache
          'X-Cache': 'HIT' // Indicate this was a cache hit
        }
      })
    }

    // Fetch items via search (to get all items including those missing from list API)
    // and categories via list API
    const [itemsData, categoriesData] = await Promise.all([
      searchAllCatalogItems(squareConfig),
      listCatalogObjects(squareConfig, ['CATEGORY'])
    ])
    
    // Combine the results (search returns different structure)
    const catalogData: { objects: CatalogObject[] } = {
      objects: [
        ...(itemsData.objects || []),
        ...(categoriesData.objects || [])
      ] as CatalogObject[]
    }
    
    if (!catalogData.objects || catalogData.objects.length === 0) {
      // Return fallback menu when Square catalog is empty
      return NextResponse.json({ 
        categories: getFallbackMenu(),
        items: [],
        fallback: true,
        message: 'Using We Proudly Serve Starbucks® menu data. Starbucks and the Starbucks logo are used under license by Nestlé.',
        legalAttribution: 'Starbucks and the Starbucks logo are used under license by Nestlé.'
      })
    }

    // Debug logging removed - Square API 2024 categories structure working correctly
    // console.log('Catalog objects received:', catalogData.objects?.map((obj: any) => ({ 
    //   type: obj.type, 
    //   id: obj.id, 
    //   name: obj.item_data?.name || obj.category_data?.name,
    //   oldCategoryId: obj.item_data?.category_id, // deprecated field
    //   newCategories: obj.item_data?.categories, // new field structure
    //   categoryId: obj.item_data?.categories?.[0]?.id
    // })))

    // Separate items and categories, explicitly filter out ITEM_VARIATIONS and other types
    const items = catalogData.objects.filter(isItemObject)
    const rawCategories = catalogData.objects.filter(isCategoryObject)
    
    // console.log(`Found ${items.length} items and ${rawCategories.length} categories`)
    
    // Remove duplicate categories (same ID)
    const categories = rawCategories.filter((category, index, arr) => 
      arr.findIndex(c => c.id === category.id) === index
    )

    // Filter items for location availability and status
    const locationId = squareConfig.locationId
    const availableItems = items.filter(item => {
      const itemData = item.item_data
      
      // Filter out deleted and archived items
      if (item.is_deleted || itemData?.is_deleted || itemData?.is_archived) {
        return false
      }
      
      // Filter by location availability
      if (item.present_at_all_locations === false) {
        // Item is location-specific, check if available at our location
        const presentAtLocations = item.present_at_location_ids || []
        const absentAtLocations = item.absent_at_location_ids || []
        
        const locationIdValue = locationId ?? ''
        if (!locationIdValue) {
          return false
        }
        // Must be present at our location and not absent
        if (!(presentAtLocations ?? []).includes(locationIdValue) || (absentAtLocations ?? []).includes(locationIdValue)) {
          return false
        }
      }
      
      return true
    })

    // console.log(`Filtered ${items.length} items to ${availableItems.length} available items for location ${locationId}`)

    // Transform Square data to our menu format
    const transformedItems: CanonicalMenuItem[] = availableItems.map(item => {
      const itemData = item.item_data
      if (!itemData) {
        return {
          id: item.id,
          name: 'Unknown Item',
          description: '',
          price: 0,
          categoryId: 'uncategorized',
          variations: [],
          isAvailable: false,
          modifiers: []
        }
      }
      
      const baseVariation = itemData.variations?.[0]
      const price = baseVariation?.item_variation_data?.price_money?.amount || 0
      
      // Get category ID from the new categories array structure (Square API 2024)
      const categoryId = itemData.categories?.[0]?.id || 'uncategorized'
      
      return {
        id: item.id,
        name: itemData.name,
        description: itemData.description || '',
        price: price / 100, // Convert cents to dollars
        categoryId: categoryId,
        imageUrl: itemData.image_ids?.[0] ? `/api/square/image/${itemData.image_ids[0]}` : undefined,
        variations: itemData?.variations?.map((variation) => ({
          id: variation.id,
          name: variation.item_variation_data.name,
          priceDifference: (variation.item_variation_data.price_money?.amount || 0) / 100 - price / 100
        })) || [],
        isAvailable: !itemData.is_deleted,
        modifiers: itemData?.modifier_list_info?.map((modInfo) => ({
          id: modInfo.modifier_list_id,
          name: modInfo.name || 'Modifier',
          price: 0, // Modifier prices come from the modifier list details
          type: 'selection' as const
        })) || []
      }
    })

    // First, organize categories by parent-child relationships
    const topLevelCategories: typeof categories = []
    const childCategories: typeof categories = []
    
    // Organize categories by parent-child relationships
    
    categories.forEach((category) => {
      const parentCategory = category.category_data?.parent_category
      const parentId = parentCategory?.id
      const categoryOrdinal = category.category_data?.ordinal
      
      if (parentId && parentId.trim() !== '') {
        // Production environment: has proper parent ID
        childCategories.push(category)
      } else {
        // For sandbox environment, check if there's a category with ordinal immediately before this one
        // that could be the parent (e.g., FRAPPUCCINO=20, COFFEE=21, CREME=22)
        const potentialParent = categories.find((potentialParent) => {
          const parentOrdinal = potentialParent.category_data?.ordinal
          // Look for a category with an ordinal exactly 1 or 2 less than this category
          // and that could logically be a parent (like FRAPPUCCINO for COFFEE/CREME)
          return parentOrdinal && categoryOrdinal && 
                 (categoryOrdinal - parentOrdinal >= 1 && categoryOrdinal - parentOrdinal <= 2) &&
                 potentialParent.id !== category.id
        })
        
        if (potentialParent) {
          childCategories.push(category)
        } else {
          topLevelCategories.push(category)
        }
      }
    })
    

    const transformedCategories: MenuCategory[] = topLevelCategories.map((category) => {
      // Find child categories for this parent
      const children = childCategories.filter((child) => {
        const childParentId = child.category_data?.parent_category?.id
        const categoryOrdinal = category.category_data?.ordinal
        const childOrdinal = child.category_data?.ordinal
        
        // Production: match by parent ID
        if (childParentId === category.id) {
          return true
        }
        
        // Sandbox: match by ordinal proximity (child ordinal is 1-2 more than parent)
        if (categoryOrdinal && childOrdinal) {
          return (childOrdinal - categoryOrdinal >= 1 && childOrdinal - categoryOrdinal <= 2)
        }
        
        return false
      })
      
      // Get direct items for this category
      let categoryItems = transformedItems.filter(item => item.categoryId === category.id)
      
      // Get items from child categories
      const childItems = children.flatMap(child => 
        transformedItems.filter(item => item.categoryId === child.id)
      )
      
      // If no items found by ID, try matching by category name for common seeded categories
      if (categoryItems.length === 0 && childItems.length === 0) {
        const categoryName = category.category_data?.name.toLowerCase() || ''
        categoryItems = transformedItems.filter(item => {
          const itemCategoryId = item.categoryId?.toLowerCase()
          return itemCategoryId?.includes(categoryName.replace(/\s+/g, '-')) || 
                 itemCategoryId?.includes(categoryName.replace(/\s+/g, ''))
        })
      }
      
      // console.log(`Category ${category.category_data?.name} (${category.id}) has ${categoryItems.length} items:`, 
      //   categoryItems.map(item => `${item.name} (categoryId: ${item.categoryId})`))
      
      // Create subcategories structure for child categories
      const subcategories: CanonicalMenuSubcategory[] = children.map((child) => {
        const childItems = transformedItems.filter(item => item.categoryId === child.id)
        return {
          id: child.id,
          name: child.category_data?.name || '',
          description: child.category_data?.description || '',
          items: sortMenuItems(childItems),
          sortOrder: child.category_data?.ordinal || 0
        }
      }).sort((a, b) => a.sortOrder - b.sortOrder)

      return {
        id: category.id,
        name: category.category_data?.name || '',
        description: category.category_data?.description || '',
        items: sortMenuItems(categoryItems), // Only include direct parent items, not child items
        subcategories: subcategories.length > 0 ? subcategories : undefined,
        sortOrder: category.category_data?.ordinal || 0
      }
    })

    // Add uncategorized items
    const uncategorizedItems = transformedItems.filter(item => 
      !categories.some(cat => cat.id === item.categoryId)
    )

    // console.log(`Uncategorized items check:`)
    // console.log(`- Total items: ${transformedItems.length}`)
    // console.log(`- Available category IDs: [${categories.map(c => c.id).join(', ')}]`)
    // console.log(`- Items with their category IDs: ${transformedItems.slice(0, 5).map(item => `${item.name}:${item.categoryId}`).join(', ')}`)
    // console.log(`- Uncategorized items found: ${uncategorizedItems.length}`)

    if (uncategorizedItems.length > 0) {
      transformedCategories.push({
        id: 'uncategorized',
        name: 'Other Items',
        description: 'Additional menu items',
        items: sortMenuItems(uncategorizedItems), // Apply smart sorting to uncategorized items too
        subcategories: undefined,
        sortOrder: 999
      })
    }

    // Sort categories using business logic priority instead of just ordinal
    const sortedCategories = sortMenuCategories(transformedCategories)

    const menuData: MenuResponse = {
      categories: sortedCategories,
      items: transformedItems,
      lastUpdated: new Date().toISOString(),
      // debug: {
      //   totalCatalogObjects: catalogData.objects?.length || 0,
      //   rawCategories: rawCategories.length,
      //   deduplicatedCategories: categories.length,
      //   itemsCount: items.length,
      //   categoryIds: categories.map((c: any) => c.id),
      //   itemCategoryIds: transformedItems.map((i: any) => i.categoryId),
      //   categoriesWithItems: transformedCategories.map((c: any) => ({ 
      //     name: c.name, 
      //     id: c.id, 
      //     itemCount: c.items.length 
      //   }))
      // }
    }

    // Cache the menu data
    setCachedMenu(tenantId, menuData)

    return NextResponse.json(menuData, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300', // 5 minutes browser cache
        'X-Cache': 'MISS' // Indicate this was a cache miss
      }
    })

  } catch (error) {
    console.error('Error fetching menu from Square:', error)
    
    // Return fallback static menu data in case of Square API issues
    return NextResponse.json({
      error: 'Failed to fetch menu from Square',
      categories: getFallbackMenu(),
      items: [],
      fallback: true,
      message: 'Using We Proudly Serve Starbucks® menu data. Starbucks and the Starbucks logo are used under license by Nestlé.',
      legalAttribution: 'Starbucks and the Starbucks logo are used under license by Nestlé.'
    })
  }
}

export async function POST() {
  // For future use - update menu items, manage inventory, etc.
  return NextResponse.json({ message: 'Menu updates not implemented yet' }, { status: 501 })
}

function getFallbackMenu(): MenuCategory[] {
  // WPS Starbucks® Compliant Menu Structure
  // Based on Mobile Ordering Guidelines - Updated September 2023
  const starbucksCompliantCategories = [
    {
      id: 'espresso-coffee',
      name: 'ESPRESSO, COFFEE & MORE',
      description: 'Authentic Starbucks® coffee and espresso beverages',
      items: [
        {
          id: 'caffe-latte',
          name: 'Caffè Latte',
          description: 'Espresso in steamed milk lightly topped with foam',
          price: 4.45,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: [
            { id: 'extra-shot', name: 'Extra Shot', price: 0.75, type: 'selection' as const },
            { id: 'oatmilk', name: 'Oatmilk', price: 0.65, type: 'selection' as const },
            { id: 'almondmilk', name: 'Almondmilk', price: 0.65, type: 'selection' as const }
          ]
        },
        {
          id: 'cappuccino',
          name: 'Cappuccino',
          description: 'Espresso in a small amount of steamed milk, with a deep layer of foam.',
          price: 4.25,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'caffe-mocha',
          name: 'Caffè Mocha',
          description: 'Espresso with mocha sauce and steamed milk. Topped with whipped cream.',
          price: 4.95,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'caramel-macchiato',
          name: 'Caramel Macchiato',
          description: 'Steamed milk mixed with vanilla syrup, marked with espresso and topped with caramel sauce.',
          price: 5.25,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'white-chocolate-mocha',
          name: 'White Chocolate Mocha',
          description: 'Espresso complemented with white chocolate sauce and topped with whipped cream',
          price: 5.25,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'iced-shaken-espresso',
          name: 'Iced Shaken Espresso',
          description: 'Starbucks® espresso with classic syrup, shaken over ice and topped with a splash of milk',
          price: 4.95,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'iced-coffee',
          name: 'Iced Coffee',
          description: 'Starbucks® Iced Coffee Blend served chilled over ice.',
          price: 2.95,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.50 },
            { id: 'venti', name: 'Venti', priceDifference: 1.00 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'cold-brew-coffee',
          name: 'Cold Brew Coffee',
          description: 'Custom blend of beans steeped in cool water for 20 hours for a super-smooth flavor.',
          price: 3.45,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.50 },
            { id: 'venti', name: 'Venti', priceDifference: 1.00 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'freshly-brewed-coffee',
          name: 'Freshly Brewed Coffee',
          description: 'Regular or Decaf',
          price: 2.45,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'regular', name: 'Regular', priceDifference: 0 },
            { id: 'decaf', name: 'Decaf', priceDifference: 0 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'hot-chocolate',
          name: 'Hot Chocolate',
          description: 'Bittersweet chocolate sauce and steamed milk. Topped with whipped cream and chocolate drizzle.',
          price: 3.95,
          categoryId: 'espresso-coffee',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        }
      ],
      sortOrder: 1
    },
    {
      id: 'teavana-tea',
      name: 'TEAVANA® HANDCRAFTED TEA',
      description: 'Premium handcrafted tea beverages',
      items: [
        {
          id: 'chai-latte',
          name: 'Chai Latte',
          description: 'Black tea infused with rich, warm spices, mixed with steamed milk',
          price: 4.45,
          categoryId: 'teavana-tea',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'matcha-green-tea-latte',
          name: 'Matcha Green Tea Latte',
          description: 'Sweetened, shade grown, finely ground matcha green tea, handcrafted with steamed milk.',
          price: 4.95,
          categoryId: 'teavana-tea',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'iced-black-tea',
          name: 'Iced Black Tea',
          description: 'Teavana® tea mixed with water, lightly sweetened and shaken with ice.',
          price: 2.95,
          categoryId: 'teavana-tea',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.50 },
            { id: 'venti', name: 'Venti', priceDifference: 1.00 }
          ],
          isAvailable: true,
          modifiers: [
            { id: 'add-lemonade', name: 'Add Lemonade', price: 0.60, type: 'selection' as const }
          ]
        },
        {
          id: 'iced-green-tea',
          name: 'Iced Green Tea',
          description: 'Teavana® tea mixed with water, lightly sweetened and shaken with ice.',
          price: 2.95,
          categoryId: 'teavana-tea',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.50 },
            { id: 'venti', name: 'Venti', priceDifference: 1.00 }
          ],
          isAvailable: true,
          modifiers: [
            { id: 'add-lemonade', name: 'Add Lemonade', price: 0.60, type: 'selection' as const }
          ]
        }
      ],
      sortOrder: 2
    },
    {
      id: 'refreshers',
      name: 'STARBUCKS REFRESHERS® ICED BEVERAGES',
      description: 'Refreshing fruit-based beverages (contains caffeine)',
      items: [
        {
          id: 'strawberry-acai',
          name: 'Strawberry Acai',
          description: 'A blend of real fruit juice with strawberry and açai fruit flavors, Green Coffee Extract and strawberry inclusions mixed with water or lemonade and shaken with ice.',
          price: 4.95,
          categoryId: 'refreshers',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: [
            { id: 'with-lemonade', name: 'With Lemonade', price: 0, type: 'selection' as const }
          ]
        },
        {
          id: 'mango-dragonfruit',
          name: 'Mango Dragonfruit',
          description: 'This tropical-inspired pick-me-up—crafted with a refreshing combination of sweet mango and dragonfruit flavors and Green Coffee Extract—is hand-shaken with ice and a scoop of real diced dragonfruit.',
          price: 4.95,
          categoryId: 'refreshers',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        },
        {
          id: 'pineapple-passionfruit',
          name: 'Pineapple Passionfruit',
          description: 'Tropical flavors of pineapple and passionfruit mix with diced pineapple',
          price: 4.95,
          categoryId: 'refreshers',
          variations: [
            { id: 'tall', name: 'Tall', priceDifference: 0 },
            { id: 'grande', name: 'Grande', priceDifference: 0.70 },
            { id: 'venti', name: 'Venti', priceDifference: 1.50 }
          ],
          isAvailable: true,
          modifiers: []
        }
      ],
      sortOrder: 3
    }
  ]
  
  // Apply sorting to Starbucks compliant menu items
  const typedCategories = starbucksCompliantCategories.map(category => ({
    ...category,
    items: sortMenuItems(category.items)
  }))

  return typedCategories as MenuCategory[]
}
