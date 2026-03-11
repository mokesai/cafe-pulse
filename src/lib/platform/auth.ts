import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export type PlatformAdminRole = 'super_admin' | 'tenant_admin'

export interface PlatformAdminInfo {
  userId: string
  role: PlatformAdminRole
  tenantIds: string[] // empty for super_admin, scoped tenant IDs for tenant_admin
}

/**
 * Server-side platform admin authentication check.
 * Returns the authenticated Supabase client and the admin's role/scope.
 */
export async function requirePlatformAdmin(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  admin: PlatformAdminInfo
}> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/admin/login?return=/platform')
  }

  const { data: adminRows, error: platformError } = await supabase
    .from('platform_admins')
    .select('id, role, tenant_id')
    .eq('user_id', user.id)

  if (platformError || !adminRows || adminRows.length === 0) {
    redirect('/unauthorized?reason=not-platform-admin')
  }

  // Determine effective role — super_admin trumps tenant_admin
  const isSuperAdmin = adminRows.some((row: { role: string }) => row.role === 'super_admin')
  const role: PlatformAdminRole = isSuperAdmin ? 'super_admin' : 'tenant_admin'
  const tenantIds = isSuperAdmin
    ? []
    : adminRows
        .filter((row: { tenant_id: string | null }) => row.tenant_id !== null)
        .map((row: { tenant_id: string | null }) => row.tenant_id as string)

  return {
    supabase,
    admin: { userId: user.id, role, tenantIds },
  }
}

/**
 * Check if a user is a platform administrator (any role).
 * Used by middleware for quick boolean checks.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient()

  const { data: platformAdmin } = await supabase
    .from('platform_admins')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .single()

  return !!platformAdmin
}
