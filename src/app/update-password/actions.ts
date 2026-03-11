'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Determines the appropriate login redirect URL after a password reset.
 *
 * Checks platform_admins first, then tenant_memberships.
 * - Platform admin → /admin/login?return=/platform&message=password-updated
 * - App admin → <slug>.<domain>/admin/login?message=password-updated
 * - Both → defaults to platform login
 */
export async function getPasswordResetRedirect(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return '/admin/login?message=password-updated'
  }

  const serviceClient = createServiceClient()

  // Check platform_admins
  const { data: platformAdmin } = await serviceClient
    .from('platform_admins')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (platformAdmin) {
    return '/admin/login?return=/platform&message=password-updated'
  }

  // Check tenant_memberships — find their tenant slug
  const { data: membership } = await serviceClient
    .from('tenant_memberships')
    .select('tenant_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin', 'staff'])
    .is('deleted_at', null)
    .limit(1)
    .single()

  if (membership) {
    const { data: tenant } = await serviceClient
      .from('tenants')
      .select('slug')
      .eq('id', membership.tenant_id)
      .single()

    if (tenant?.slug) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
      const tenantUrl = siteUrl.replace('://', `://${tenant.slug}.`)
      return `${tenantUrl}/admin/login?message=password-updated`
    }
  }

  // Fallback
  return '/admin/login?message=password-updated'
}
