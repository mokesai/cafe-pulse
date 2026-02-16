// Square OAuth callback endpoint
// Handles authorization code exchange for tokens and Vault storage

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseOAuthState } from '@/lib/square/config'

export async function GET(request: Request) {
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

    // Parse OAuth state
    const parsedState = parseOAuthState(state)
    if (!parsedState) {
      console.error('Invalid OAuth state format')
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', 'invalid_state')
      return NextResponse.redirect(redirectUrl)
    }

    const { tenantId, environment } = parsedState

    // TODO: Verify state token matches stored value (CSRF protection)
    // For now, we trust the parsed state format

    // Check for required Square env vars
    if (
      !process.env.SQUARE_APPLICATION_ID ||
      !process.env.SQUARE_SECRET
    ) {
      console.error('Square OAuth credentials not configured')
      const redirectUrl = new URL('/platform/tenants/new', request.url)
      redirectUrl.searchParams.set('error', 'oauth_not_configured')
      return NextResponse.redirect(redirectUrl)
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
      return NextResponse.redirect(redirectUrl)
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
      return NextResponse.redirect(redirectUrl)
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
      return NextResponse.redirect(redirectUrl)
    }

    // Success - redirect to tenant detail page
    const successUrl = new URL(`/platform/tenants/${tenantId}`, request.url)
    successUrl.searchParams.set('success', 'square_connected')
    return NextResponse.redirect(successUrl)
  } catch (error) {
    console.error('OAuth callback error:', error)

    // Generic error redirect
    const redirectUrl = new URL('/platform/tenants/new', request.url)
    redirectUrl.searchParams.set('error', 'internal_error')
    return NextResponse.redirect(redirectUrl)
  }
}
