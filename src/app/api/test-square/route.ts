import { NextResponse } from 'next/server'
import { listLocations } from '@/lib/square/fetch-client'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

interface SquareLocation {
  id: string
  name?: string
  status?: string
}

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
    // Test Square connection by listing locations
    const result = await listLocations(squareConfig)
    
    const locations = (result.locations || []) as SquareLocation[]

    return NextResponse.json({
      success: true,
      message: 'Square API connection successful',
      locations: locations.map((location) => ({
        id: location.id,
        name: location.name,
        status: location.status
      }))
    })
  } catch (error) {
    console.error('Square API test failed:', error)
    
    return NextResponse.json({
      success: false,
      message: 'Square API connection failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
