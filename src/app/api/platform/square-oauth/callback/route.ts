// Square OAuth callback endpoint
// Handles authorization code exchange for tokens and Vault storage

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/platform/auth'
import { parseOAuthState } from '@/lib/square/config'

export async function GET(request: Request) {
  // Auth guard (SEC-1) — redirects unauthenticated/unauthorized users
  await requirePlatformAdmin()

  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors from Square
    if (error) {
      console.error('Square OAuth error:', error)
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', error)
      return NextResponse.redirect(redirectUrl)
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('Missing code or state parameter')
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', 'missing_parameters')
      return NextResponse.redirect(redirectUrl)
    }

    // Verify CSRF cookie (SEC-1)
    const cookieStore = await cookies()
    const storedState = cookieStore.get('square_oauth_state')?.value

    if (!storedState || storedState !== state) {
      console.error('CSRF state mismatch — possible CSRF attack')
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', 'csrf_failed')
      const response = NextResponse.redirect(redirectUrl)
      response.cookies.set('square_oauth_state', '', { maxAge: 0, path: '/' })
      return response
    }

    // Clear CSRF cookie now that it's been verified
    // (will also clear on success redirect below)

    // Parse OAuth state
    const parsedState = parseOAuthState(state)
    if (!parsedState) {
      console.error('Invalid OAuth state format')
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', 'invalid_state')
      const response = NextResponse.redirect(redirectUrl)
      response.cookies.set('square_oauth_state', '', { maxAge: 0, path: '/' })
      return response
    }

    const { tenantId, environment } = parsedState

    // Check for required Square env vars
    if (
      !process.env.SQUARE_APPLICATION_ID ||
      !process.env.SQUARE_SECRET
    ) {
      console.error('Square OAuth credentials not configured')
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', 'oauth_not_configured')
      const response = NextResponse.redirect(redirectUrl)
      response.cookies.set('square_oauth_state', '', { maxAge: 0, path: '/' })
      return response
    }

    // Determine token endpoint based on environment
    const tokenEndpoint =
      environment === 'production'
        ? 'https://connect.squareup.com/oauth2/token'
        : 'https://connect.squareupsandbox.com/oauth2/token'

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Square-Version': '2024-12-18',
      },
      body: JSON.stringify({
        client_id: process.env.SQUARE_APPLICATION_ID,
        client_secret: process.env.SQUARE_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Square token exchange failed:', errorText)
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', 'token_exchange_failed')
      const response = NextResponse.redirect(redirectUrl)
      response.cookies.set('square_oauth_state', '', { maxAge: 0, path: '/' })
      return response
    }

    const tokens = await tokenResponse.json()

    // Validate token response structure
    if (
      !tokens.access_token ||
      !tokens.refresh_token ||
      !tokens.merchant_id ||
      !tokens.expires_at
    ) {
      console.error('Invalid token response structure:', tokens)
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', 'invalid_token_response')
      const response = NextResponse.redirect(redirectUrl)
      response.cookies.set('square_oauth_state', '', { maxAge: 0, path: '/' })
      return response
    }

    // Store credentials in Vault via service_role RPC
    const supabase = createServiceClient()
    const { error: rpcError } = await supabase.rpc(
      'store_square_credentials_internal',
      {
        p_tenant_id: tenantId,
        p_environment: environment,
        p_access_token: tokens.access_token,
        p_refresh_token: tokens.refresh_token,
        p_merchant_id: tokens.merchant_id,
        p_expires_at: tokens.expires_at,
      }
    )

    if (rpcError) {
      console.error('Failed to store Square credentials:', rpcError)
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', 'storage_failed')
      const response = NextResponse.redirect(redirectUrl)
      response.cookies.set('square_oauth_state', '', { maxAge: 0, path: '/' })
      return response
    }

    // Success - redirect to tenant detail page and clear CSRF cookie
    const successUrl = new URL(`/platform/tenants/${tenantId}`, request.url)
    successUrl.searchParams.set('success', 'square_connected')
    const response = NextResponse.redirect(successUrl)
    response.cookies.set('square_oauth_state', '', { maxAge: 0, path: '/' })
    return response
  } catch (error) {
    console.error('OAuth callback error:', error)

    // Generic error redirect
    const redirectUrl = new URL('/platform/tenants/new', request.url)
    redirectUrl.searchParams.set('error', 'internal_error')
    return NextResponse.redirect(redirectUrl)
  }
}
