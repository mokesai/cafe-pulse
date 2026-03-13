// Square OAuth authorization endpoint
// Initiates Square OAuth flow for tenant onboarding

import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform/auth'
import { generateOAuthState } from '@/lib/square/config'

export async function GET(request: Request) {
  try {
    // Verify caller is platform admin
    await requirePlatformAdmin()

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const tenantId = searchParams.get('tenant_id')
    const environment = searchParams.get('environment') || 'sandbox'

    // Validate tenant_id is present and looks like a UUID
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenant_id parameter' },
        { status: 400 }
      )
    }

    // Validate tenant_id format (basic UUID regex)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(tenantId)) {
      return NextResponse.json(
        { error: 'Invalid tenant_id format (must be UUID)' },
        { status: 400 }
      )
    }

    // Validate environment
    if (environment !== 'sandbox' && environment !== 'production') {
      return NextResponse.json(
        { error: 'Invalid environment (must be sandbox or production)' },
        { status: 400 }
      )
    }

    // Check for required Square env vars
    if (!process.env.SQUARE_APPLICATION_ID) {
      console.error('SQUARE_APPLICATION_ID not configured')
      return NextResponse.json(
        { error: 'Square OAuth not configured' },
        { status: 500 }
      )
    }

    // Generate OAuth state for CSRF protection
    const state = generateOAuthState(
      tenantId,
      environment as 'sandbox' | 'production'
    )

    // TODO: Store state in session or database for callback verification
    // For now, state is generated and will be parsed in callback

    // Determine Square OAuth base URL
    const baseUrl =
      environment === 'production'
        ? 'https://connect.squareup.com'
        : 'https://connect.squareupsandbox.com'

    // Build authorization URL with redirect_uri
    const callbackUrl = new URL('/api/platform/square-oauth/callback', request.url)

    const authParams = new URLSearchParams({
      client_id: process.env.SQUARE_APPLICATION_ID,
      scope:
        'MERCHANT_PROFILE_READ PAYMENTS_WRITE ORDERS_WRITE ITEMS_READ INVENTORY_READ',
      session: 'false',
      state,
      redirect_uri: callbackUrl.toString(),
    })

    const authUrl = `${baseUrl}/oauth2/authorize?${authParams.toString()}`

    // Debug: Log OAuth URL (remove after testing)
    console.log('🔗 Square OAuth URL:', authUrl)
    console.log('📋 OAuth Parameters:', {
      client_id: process.env.SQUARE_APPLICATION_ID,
      redirect_uri: callbackUrl.toString(),
      environment,
      tenant_id: tenantId,
    })

    // Redirect to Square OAuth and set CSRF cookie (SEC-1)
    const response = NextResponse.redirect(authUrl)
    response.cookies.set('square_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600, // 10 minutes
      sameSite: 'lax',
      path: '/',
    })
    return response
  } catch (error) {
    console.error('Square OAuth authorization error:', error)

    // Check if error is from requirePlatformAdmin (redirect to login)
    if (error instanceof Response) {
      return error
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
