/**
 * MOK-163 / KDS Pi Deployment phase 7 — awaiting page.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-163
 * Plan: .planning/kds-v3-pi/PHASE-7-PLAN.md (T1)
 *
 *   GET /kds/awaiting/[deviceId]/[slot]?token=<auth_token>
 *
 * Renders the operator-facing waiting state for an HDMI slot that has no
 * screen bound. Auth pattern mirrors /kds/v3/[deviceId]/[screenId]/page.tsx —
 * cookie OR query-param token, 404 on either failure (no leaking which).
 *
 * When the operator binds a screen for this slot, the next server-side
 * re-eval (driven by the 30s meta-refresh) sees screen_<slot>_id non-null
 * and redirects the TV to the v3 page — no Pi reboot needed.
 *
 * The browser-side `KDSHeartbeat` keeps the device's last_heartbeat_at
 * fresh so the admin UI shows "online" even while we're waiting on a
 * binding.
 */
import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import KDSHeartbeat from '@/components/kds/v3/KDSHeartbeat'
import AutoRefresh from './AutoRefresh'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ deviceId: string; slot: string }>
  searchParams: Promise<{ token?: string }>
}

export default async function KDSAwaitingPage({ params, searchParams }: PageProps) {
  const { deviceId, slot } = await params
  const { token: tokenParam } = await searchParams

  if (slot !== '1' && slot !== '2') notFound()

  const cookieStore = await cookies()
  const tokenCookie = cookieStore.get('kds_device_token')
  const tokenValue = tokenCookie?.value || tokenParam
  if (!tokenValue) notFound()

  const hashedToken = crypto.createHash('sha256').update(tokenValue).digest('hex')
  const supabase = createServiceClient()

  const { data: device } = await supabase
    .from('kds_devices')
    .select('id, name, screen_1_id, screen_2_id, status')
    .eq('id', deviceId)
    .eq('auth_token', hashedToken)
    .maybeSingle()
  if (!device || device.status === 'pending') notFound()

  const screenId = slot === '1' ? device.screen_1_id : device.screen_2_id
  if (screenId) {
    redirect(`/kds/v3/${deviceId}/${screenId}?token=${encodeURIComponent(tokenValue)}`)
  }

  return (
    <>
      <div
        style={{
          minHeight: '100vh',
          background: '#000',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 'clamp(2rem, 6vw, 4rem)',
            fontWeight: 600,
            marginBottom: '1.5rem',
          }}
        >
          Waiting for screen assignment
        </div>
        <div
          style={{
            fontSize: 'clamp(1rem, 2.5vw, 1.5rem)',
            opacity: 0.7,
            marginBottom: '2rem',
          }}
        >
          Device: {device.name} · Slot {slot}
        </div>
        <div
          style={{
            fontSize: 'clamp(0.85rem, 2vw, 1.1rem)',
            opacity: 0.5,
            maxWidth: '40rem',
          }}
        >
          Bind a screen to this slot in <code>Admin → KDS Setup → Devices</code> and this display
          will load it automatically within 30 seconds.
        </div>
      </div>
      <KDSHeartbeat
        deviceId={device.id}
        authToken={tokenValue}
        screen={`awaiting-${slot}`}
      />
      <AutoRefresh intervalMs={30000} />
    </>
  )
}
