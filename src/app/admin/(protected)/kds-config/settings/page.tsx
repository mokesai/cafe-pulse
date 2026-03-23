import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getConfigAccessRoles } from '@/lib/kds/access'
import KDSSettingsClient from './KDSSettingsClient'
import type { KDSTheme } from '@/lib/kds/types'

export const dynamic = 'force-dynamic'

export default async function KDSSettingsPage() {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  // Load all settings
  const { data: settingsRows } = await supabase
    .from('kds_settings')
    .select('key, value')
    .eq('tenant_id', tenantId)

  const settingsMap: Record<string, string | number | boolean> = {}
  for (const row of settingsRows ?? []) {
    settingsMap[row.key] = row.value
  }

  const configAccessRoles = await getConfigAccessRoles(tenantId)

  return (
    <KDSSettingsClient
      tenantId={tenantId}
      initialSettings={{
        theme: (settingsMap.theme as KDSTheme) ?? 'warm',
        drinks_tagline: (settingsMap.drinks_tagline as string) ?? 'Freshly Brewed Every Day',
        food_tagline: (settingsMap.food_tagline as string) ?? 'Baked Fresh Daily',
        drinks_subtitle: (settingsMap.drinks_subtitle as string) ?? '',
        food_subtitle: (settingsMap.food_subtitle as string) ?? '',
        cafe_name: (settingsMap.cafe_name as string) ?? '',
        header_hours: (settingsMap.header_hours as string) ?? '8AM-6PM Mon-Fri',
        header_location: (settingsMap.header_location as string) ?? '',
        refresh_interval: Number(settingsMap.refresh_interval ?? 300000),
        image_rotation_interval: Number(settingsMap.image_rotation_interval ?? 6000),
      }}
      configAccessRoles={configAccessRoles}
    />
  )
}
