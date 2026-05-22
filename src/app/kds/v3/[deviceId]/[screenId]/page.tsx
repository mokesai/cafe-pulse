/**
 * MOK-158 / KDS v3 phase 6 — public renderer route.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T10)
 *
 *   GET /kds/v3/[deviceId]/[screenId]?token=<one-time>
 *
 * Reuses v2's device-pairing auth pattern:
 *   - cookie `kds_device_token` (set after first paired load)
 *   - OR `?token=` searchParam (first load from the Pi kiosk URL)
 *
 * The route authenticates the device, verifies the requested screen belongs
 * to the device's tenant, calls resolveScreenForRender (T4), and hands the
 * ResolvedScreen to KDSv3Client for grid + per-layout rendering.
 *
 * 404 on:
 *   - missing / invalid device token
 *   - device status='pending'
 *   - screen_id not found OR cross-tenant (device tenant ≠ screen tenant)
 *
 * v2 routes (/kds/display/[deviceId]/[screen]) remain in service through
 * phase 7's cutover — phase 6 is additive.
 */
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveScreenForRender } from '@/lib/kds/v3-render'
import KDSDisplayWrapper from '@/components/kds/v3/KDSDisplayWrapper'
import KDSHeartbeat from '@/components/kds/v3/KDSHeartbeat'
import { KDSv3Client } from './KDSv3Client'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ deviceId: string; screenId: string }>
  searchParams: Promise<{ token?: string }>
}

export default async function KDSv3DisplayPage({ params, searchParams }: PageProps) {
  const { deviceId, screenId } = await params
  const { token: tokenParam } = await searchParams

  const cookieStore = await cookies()
  const tokenCookie = cookieStore.get('kds_device_token')
  const tokenValue = tokenCookie?.value || tokenParam
  if (!tokenValue) notFound()

  const hashedToken = crypto.createHash('sha256').update(tokenValue).digest('hex')
  const supabase = createServiceClient()

  // Validate device (same shape as v2's route).
  const { data: device } = await supabase
    .from('kds_devices')
    .select('id, tenant_id, status')
    .eq('id', deviceId)
    .eq('auth_token', hashedToken)
    .maybeSingle()
  if (!device || device.status === 'pending') notFound()

  // Load the screen — must belong to the device's tenant. The render-fetch
  // helper enforces tenant scope internally; if the screen is cross-tenant
  // or missing it returns null and we 404.
  // Pi-facing render reads the published snapshot — operators iterate on
  // drafts in the admin without affecting what's on the wall.
  const resolved = await resolveScreenForRender(supabase, device.tenant_id, screenId, {
    source: 'published',
  })
  if (!resolved) notFound()

  return (
    <KDSDisplayWrapper>
      <KDSv3Client resolved={resolved} />
      <KDSHeartbeat deviceId={device.id} authToken={tokenValue} screen={screenId} />
    </KDSDisplayWrapper>
  )
}
