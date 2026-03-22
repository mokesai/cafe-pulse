import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import KDSDynamicScreen from '@/app/kds/components/KDSDynamicScreen'
import KDSHeartbeat from './KDSHeartbeat'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ deviceId: string; screen: string }>
}

export default async function KDSDisplayPage({ params }: PageProps) {
  const { deviceId, screen: screenParam } = await params

  if (screenParam !== 'drinks' && screenParam !== 'food') {
    notFound()
  }
  const screen = screenParam as 'drinks' | 'food'

  // Authenticate via cookie
  const cookieStore = await cookies()
  const tokenCookie = cookieStore.get('kds_device_token')
  if (!tokenCookie?.value) {
    notFound()
  }

  const hashedToken = crypto.createHash('sha256').update(tokenCookie.value).digest('hex')
  const supabase = createServiceClient()

  // Validate device
  const { data: device } = await supabase
    .from('kds_devices')
    .select('id, tenant_id, status')
    .eq('id', deviceId)
    .eq('auth_token', hashedToken)
    .maybeSingle()

  if (!device || device.status === 'pending') {
    notFound()
  }

  // Set tenant context for KDSDynamicScreen
  // The display route needs to render for a specific tenant without admin auth
  const { data: tenant } = await supabase
    .from('tenants')
    .select('slug')
    .eq('id', device.tenant_id)
    .single()

  if (!tenant) {
    notFound()
  }

  return (
    <div>
      <KDSDynamicScreen
        screen={screen}
        draft={false}
        autoRefresh={true}
        tenantIdOverride={device.tenant_id}
      />
      <KDSHeartbeat
        deviceId={device.id}
        authToken={tokenCookie.value}
        screen={screen}
      />
    </div>
  )
}
