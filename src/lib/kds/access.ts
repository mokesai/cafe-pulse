/**
 * KDS config access control
 * Checks if the current user's role is allowed to access KDS configuration pages
 * based on the tenant's config_access_roles setting.
 *
 * Default: ["owner", "admin"]
 * Owner can never be removed.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { redirect } from 'next/navigation'

const DEFAULT_CONFIG_ACCESS_ROLES = ['owner', 'admin']

export async function getConfigAccessRoles(tenantId: string): Promise<string[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('kds_settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', 'config_access_roles')
    .maybeSingle()

  if (!data?.value) return DEFAULT_CONFIG_ACCESS_ROLES

  try {
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
    const roles = Array.isArray(parsed) ? parsed : DEFAULT_CONFIG_ACCESS_ROLES
    // Owner always included
    if (!roles.includes('owner')) roles.unshift('owner')
    return roles
  } catch {
    return DEFAULT_CONFIG_ACCESS_ROLES
  }
}

export async function setConfigAccessRoles(
  tenantId: string,
  roles: string[]
): Promise<void> {
  const supabase = createServiceClient()
  // Owner always included
  const safeRoles = roles.includes('owner') ? roles : ['owner', ...roles]
  await supabase
    .from('kds_settings')
    .upsert(
      { tenant_id: tenantId, key: 'config_access_roles', value: JSON.stringify(safeRoles) },
      { onConflict: 'tenant_id,key' }
    )
}

/**
 * Server-side guard — redirects to access denied if user's role isn't in config_access_roles
 * Call this at the top of any KDS config page server component or layout
 */
export async function requireKDSConfigAccess(): Promise<{ role: string }> {
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  const { data: membership } = await supabase
    .from('tenant_memberships')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) redirect('/admin/login?error=no-access')

  const allowedRoles = await getConfigAccessRoles(tenantId)

  if (!allowedRoles.includes(membership.role)) {
    redirect('/admin/kds-config/access-denied')
  }

  return { role: membership.role }
}
