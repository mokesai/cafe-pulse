// Square API client using fetch for better Next.js compatibility
import type { SquareConfig } from './types'

const SQUARE_VERSION = '2024-12-18'

type SquareRequestBody = Record<string, unknown>

function getBaseUrl(config: SquareConfig): string {
  return config.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
}

function getHeaders(config: SquareConfig) {
  return {
    'Square-Version': SQUARE_VERSION,
    'Authorization': `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json'
  }
}

// Catalog API
export async function listCatalogObjects(config: SquareConfig, types?: string[], cursor?: string) {
  try {
    const url = new URL(`${getBaseUrl(config)}/v2/catalog/list`)
    if (types) {
      url.searchParams.append('types', types.join(','))
    }
    if (cursor) {
      url.searchParams.append('cursor', cursor)
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: getHeaders(config)
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Catalog API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error listing catalog objects:', error)
    throw error
  }
}

export async function searchCatalogItems(config: SquareConfig, query: SquareRequestBody) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/catalog/search`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(query)
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Catalog Search API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error searching catalog items:', error)
    throw error
  }
}

// Search catalog items with proper location filtering (recommended for menu API)
export async function searchLocationCatalogItems(config: SquareConfig) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/catalog/search-catalog-items`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        enabled_location_ids: [config.locationId],
        product_types: ['REGULAR']
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Search Catalog Items API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error searching location catalog items:', error)
    throw error
  }
}

// Search all catalog items (alternative to listCatalogObjects for items)
export async function searchAllCatalogItems(config: SquareConfig) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/catalog/search`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        object_types: ['ITEM', 'CATEGORY']
        // No query filter - returns all items and categories
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Search All Items API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error searching all catalog items:', error)
    throw error
  }
}

// Orders API
export async function getOrder(config: SquareConfig, orderId: string) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/orders/${orderId}`, {
      method: 'GET',
      headers: getHeaders(config)
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Get Order API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error getting order:', error)
    throw error
  }
}

export async function createOrder(config: SquareConfig, orderData: SquareRequestBody) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/orders`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        ...orderData,
        order: {
          ...(orderData.order as SquareRequestBody | undefined),
          location_id: config.locationId
        }
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Square Orders API detailed error:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: errorData
      })
      throw new Error(`Square Orders API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error creating order:', error)
    throw error
  }
}

// Payments API
export async function createPayment(config: SquareConfig, paymentData: SquareRequestBody) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/payments`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        ...paymentData,
        location_id: config.locationId
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Square Payments API detailed error:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: errorData
      })
      throw new Error(`Square Payments API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error creating payment:', error)
    throw error
  }
}

// Locations API
export async function listLocations(config: SquareConfig) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/locations`, {
      method: 'GET',
      headers: getHeaders(config)
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Locations API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error listing locations:', error)
    throw error
  }
}

// Tax API
export async function listCatalogTaxes(config: SquareConfig) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/catalog/search`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        object_types: ['TAX']
        // Remove the problematic exact_query - we'll filter enabled taxes in code
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Tax Search API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error listing catalog taxes:', error)
    throw error
  }
}

// Create or update catalog tax
export async function createCatalogTax(config: SquareConfig, taxData: SquareRequestBody) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/catalog/upsert`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        idempotency_key: `tax-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        object: taxData
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Tax Create API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error creating catalog tax:', error)
    throw error
  }
}

// Create or update catalog item
export async function upsertCatalogItem(config: SquareConfig, itemData: SquareRequestBody) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/catalog/batch-upsert`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        idempotency_key: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        batches: [
          {
            objects: [itemData]
          }
        ]
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Item Upsert API error: ${response.status} ${errorData}`)
    }

    const result = await response.json()
    console.log('🔧 Item upsert result:', JSON.stringify(result, null, 2))
    // Return first object from batch result to match expected format
    return {
      catalog_object: result.objects?.[0] || null
    }
  } catch (error) {
    console.error('Error upserting catalog item:', error)
    throw error
  }
}

// Create or update catalog category
export async function upsertCatalogCategory(config: SquareConfig, categoryData: SquareRequestBody) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/catalog/batch-upsert`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        idempotency_key: `category-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        batches: [
          {
            objects: [categoryData]
          }
        ]
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Category Upsert API error: ${response.status} ${errorData}`)
    }

    const result = await response.json()
    // Return first object from batch result to match expected format
    return {
      catalog_object: result.objects?.[0] || null
    }
  } catch (error) {
    console.error('Error upserting catalog category:', error)
    throw error
  }
}

// Delete catalog object
export async function deleteCatalogObject(config: SquareConfig, objectId: string) {
  try {
    const response = await fetch(`${getBaseUrl(config)}/v2/catalog/delete`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        object_id: objectId
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Delete API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error deleting catalog object:', error)
    throw error
  }
}

// Batch upsert multiple catalog objects
export async function batchUpsertCatalogObjects(config: SquareConfig, objects: SquareRequestBody[]) {
  try {
    const batches = objects.map(obj => ({
      object: obj,
      idempotency_key: `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }))

    const response = await fetch(`${getBaseUrl(config)}/v2/catalog/batch-upsert`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify({
        batches
      })
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Square Batch Upsert API error: ${response.status} ${errorData}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error batch upserting catalog objects:', error)
    throw error
  }
}

