import { NextResponse } from 'next/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

export async function GET() {
  try {
    const tenantId = await getCurrentTenantId()
    const config = await getTenantSquareConfig(tenantId)

    if (!config) {
      return NextResponse.json(
        { error: 'Square configuration not available for this tenant' },
        { status: 503 }
      )
    }

    // Only return public-safe configuration
    return NextResponse.json({
      applicationId: config.applicationId,
      locationId: config.locationId,
      environment: config.environment
    })
  } catch (error) {
    console.error('Error fetching Square config:', error)
    return NextResponse.json(
      { error: 'Failed to fetch Square configuration' },
      { status: 500 }
    )
  }
}
