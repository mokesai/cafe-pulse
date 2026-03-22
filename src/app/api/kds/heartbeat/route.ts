import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

/**
 * POST /api/kds/heartbeat
 * Pi sends periodic health ping. Authenticated via bearer token.
 */
export async function POST(request: NextRequest) {
  try {
    // Extract bearer token
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const plainToken = authHeader.slice(7)
    const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex')

    const body = await request.json()
    const { device_id, screen, ip_address } = body

    if (!device_id) {
      return NextResponse.json({ error: 'device_id is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Validate device and token
    const { data: device, error } = await supabase
      .from('kds_devices')
      .select('id')
      .eq('id', device_id)
      .eq('auth_token', hashedToken)
      .maybeSingle()

    if (error || !device) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Update heartbeat
    const updateData: Record<string, unknown> = {
      last_heartbeat_at: new Date().toISOString(),
      status: 'registered',
    }
    if (ip_address) updateData.ip_address = ip_address

    await supabase
      .from('kds_devices')
      .update(updateData)
      .eq('id', device_id)

    return NextResponse.json({
      ok: true,
      screen: screen ?? null,
      refresh_interval: 300000,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
