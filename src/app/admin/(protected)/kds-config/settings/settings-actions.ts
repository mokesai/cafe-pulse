'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { setConfigAccessRoles } from '@/lib/kds/access'

export type SaveSettingsResult =
  | { success: true }
  | { success: false; error: string }

export async function saveKDSSettings(
  tenantId: string,
  settings: Record<string, string | number | boolean>
): Promise<SaveSettingsResult> {
  try {
    const supabase = createServiceClient()

    // Upsert each setting
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'config_access_roles') continue // handled separately
      await supabase
        .from('kds_settings')
        .upsert(
          { tenant_id: tenantId, key, value },
          { onConflict: 'tenant_id,key' }
        )
    }

    revalidatePath('/admin/kds-config')
    revalidatePath('/admin/(kds)/kds/drinks')
    revalidatePath('/admin/(kds)/kds/food')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Save failed' }
  }
}

export async function saveConfigAccessRoles(
  tenantId: string,
  roles: string[]
): Promise<SaveSettingsResult> {
  try {
    await setConfigAccessRoles(tenantId, roles)
    revalidatePath('/admin/kds-config')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Save failed' }
  }
}
