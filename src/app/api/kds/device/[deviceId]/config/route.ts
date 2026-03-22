import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

/**
 * GET /api/kds/device/:deviceId/config
 * Pi fetches current config on boot (screen assignments may have changed).
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
      .select('id, tenant_id, screen_1, screen_2, status')
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

    return NextResponse.json({
      screen_1: device.screen_1,
      screen_2: device.screen_2,
      screen_1_url: `/kds/display/${device.id}/${device.screen_1}`,
      screen_2_url: `/kds/display/${device.id}/${device.screen_2}`,
      tenant_slug: tenant?.slug ?? '',
      status: device.status,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
