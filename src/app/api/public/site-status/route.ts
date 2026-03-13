import { NextRequest, NextResponse } from 'next/server'
import { addSecurityHeaders } from '@/lib/security/headers'
import { getSiteStatusUsingServiceClient } from '@/lib/services/siteSettings'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tenantId = searchParams.get('tenantId') ?? DEFAULT_TENANT_ID
    const status = await getSiteStatusUsingServiceClient(tenantId)

    return addSecurityHeaders(NextResponse.json({
      success: true,
      status
    }))
  } catch (error) {
    console.error('Failed to fetch public site status:', error)
    return addSecurityHeaders(NextResponse.json(
      { success: false, error: 'Unable to load site status' },
      { status: 500 }
    ))
  }
}
