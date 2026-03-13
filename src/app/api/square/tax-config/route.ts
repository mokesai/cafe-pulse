import { NextResponse } from 'next/server'
import { listLocations, listCatalogTaxes } from '@/lib/square/fetch-client'
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
    console.log('Fetching Square location tax configuration...')

    // Get location details which includes tax settings
    const locationsResult = await listLocations(squareConfig)
    
    if (!locationsResult.locations || locationsResult.locations.length === 0) {
      return NextResponse.json(
        { error: 'No locations found' },
        { status: 404 }
      )
    }
    
    // Get the location we're using (should match SQUARE_LOCATION_ID)
    const location = locationsResult.locations[0] // Use the first/main location
    
    console.log('Location details:', JSON.stringify(location, null, 2))
    
    // Also fetch any catalog tax objects
    let catalogTaxes = null
    try {
      console.log('Fetching catalog tax objects...')
      const taxesResult = await listCatalogTaxes(squareConfig)
      catalogTaxes = taxesResult
      console.log('Catalog taxes:', JSON.stringify(catalogTaxes, null, 2))
    } catch (taxError) {
      console.error('Error fetching catalog taxes:', taxError)
      // Continue without catalog taxes
    }
    
    // Extract tax-related information
    const taxConfig = {
      locationId: location.id,
      locationName: location.name,
      timezone: location.timezone,
      country: location.country,
      
      // Tax settings (these might be in different places depending on Square's API)
      taxIds: location.tax_ids || [],
      capabilities: location.capabilities || [],
      
      // Catalog tax objects
      catalogTaxes: catalogTaxes?.objects || [],
      
      // Full location object for debugging
      fullLocation: location
    }
    
    return NextResponse.json({
      success: true,
      taxConfig,
      message: 'Tax configuration fetched successfully'
    })
    
  } catch (error) {
    console.error('Failed to fetch tax configuration:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch tax configuration', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
