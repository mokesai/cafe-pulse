import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

/**
 * POST /api/kds/register
 * Pi redeems a setup code to register itself.
 * Returns device config + auth token.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { setup_code } = body

    if (!setup_code) {
      return NextResponse.json({ error: 'setup_code is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Find device by setup code
    const { data: device, error: findError } = await supabase
      .from('kds_devices')
      .select('id, tenant_id, status, setup_code_expires_at, screen_1, screen_2')
      .eq('setup_code', setup_code)
      .maybeSingle()

    if (findError || !device) {
      return NextResponse.json({ error: 'Invalid setup code' }, { status: 404 })
    }

    // Check if already registered
    if (device.status === 'registered') {
      return NextResponse.json({ error: 'Device already registered' }, { status: 409 })
    }

    // Check expiration
    if (device.setup_code_expires_at && new Date(device.setup_code_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Setup code has expired' }, { status: 410 })
    }

    // Generate auth token
    const plainToken = crypto.randomBytes(32).toString('hex')
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex')

    // Get tenant slug for URL construction
    const { data: tenant } = await supabase
      .from('tenants')
      .select('slug')
      .eq('id', device.tenant_id)
      .single()

    // Update device: set registered, store hashed token, clear setup code
    const { error: updateError } = await supabase
      .from('kds_devices')
      .update({
        status: 'registered',
        auth_token: hashedToken,
        setup_code: null,
        setup_code_expires_at: null,
        registered_at: new Date().toISOString(),
      })
      .eq('id', device.id)

    if (updateError) {
      return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
    }

    const response = NextResponse.json({
      device_id: device.id,
      auth_token: plainToken,
      screen_1: device.screen_1,
      screen_2: device.screen_2,
      screen_1_url: `/kds/display/${device.id}/${device.screen_1}`,
      screen_2_url: `/kds/display/${device.id}/${device.screen_2}`,
      tenant_slug: tenant?.slug ?? '',
    })

    // Set auth token as httpOnly cookie for the display route
    response.cookies.set('kds_device_token', plainToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/kds/',
      maxAge: 60 * 60 * 24 * 365 * 5, // 5 years
    })

    return response
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
