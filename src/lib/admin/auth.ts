import { createClient, createTenantClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { redirect } from 'next/navigation'

/**
 * Server-side admin authentication check
 * Redirects to /admin/login if not authenticated or not admin of the current tenant
 */
export async function requireAdmin() {
  const supabase = await createClient()

  // 1. Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/admin/login')
  }

  // 2. Get tenant context from cookie (set by middleware)
  const tenantId = await getCurrentTenantId()

  // 3. Check tenant membership with owner/admin role
  const { data: membership, error: membershipError } = await supabase
    .from('tenant_memberships')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .single()

  if (membershipError || !membership) {
    // User authenticated but not admin of this tenant
    redirect('/admin/login?error=no-access')
  }

  // 4. Create tenant-scoped client (calls set_tenant_context RPC)
  const tenantClient = await createTenantClient(tenantId)

  return { user, membership, tenantClient, tenantId }
}