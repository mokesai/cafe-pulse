import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getDeviceScreenUrls } from '@/lib/kds/devices'
import crypto from 'crypto'

/**
 * GET /api/kds/device/:deviceId/config
 * Pi fetches current config on boot (screen assignments may have changed).
 *
 * MOK-161 (Pi Phase 5): URLs now use the v3 shape via getDeviceScreenUrls.
 * Legacy `screen_1` / `screen_2` text columns are still returned in the
 * response for already-deployed Pi scripts that show device info to the
 * operator. Drop in a follow-up post-Phase-7.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { deviceId } = await params

    // Extract bearer token
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const plainToken = authHeader.slice(7)
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex')

    const supabase = createServiceClient()

    // Validate device and token
    const { data: device, error } = await supabase
      .from('kds_devices')
      .select('id, tenant_id, screen_1, screen_2, screen_1_id, screen_2_id, status')
      .eq('id', deviceId)
      .eq('auth_token', hashedToken)
      .maybeSingle()

    if (error || !device) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get tenant slug
    const { data: tenant } = await supabase
      .from('tenants')
      .select('slug')
      .eq('id', device.tenant_id)
      .single()

    const { screen_1_url, screen_2_url } = getDeviceScreenUrls(device)

    return NextResponse.json({
      screen_1: device.screen_1,
      screen_2: device.screen_2,
      screen_1_id: device.screen_1_id,
      screen_2_id: device.screen_2_id,
      screen_1_url,
      screen_2_url,
      tenant_slug: tenant?.slug ?? '',
      status: device.status,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
