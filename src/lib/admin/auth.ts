import { createClient, createServiceClient, createTenantClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { redirect } from 'next/navigation'

/**
 * Server-side admin authentication check
 * Redirects to /admin/login if not authenticated or not admin of the current tenant.
 *
 * First-login flow (Plan 90-04): If the user has a pending invite for this tenant,
 * the membership is auto-created and the invite is consumed.
 */
export async function requireAdmin() {
  const supabase = await createClient()

  // 1. Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/admin/login')
  }

  // 2. Enforce MFA (all app admins require 2FA)
  // Skip MFA check entirely in E2E test mode (SKIP_MFA_FOR_TESTING=true)
  // or for test accounts identified by email domain
  const skipMfa =
    process.env.SKIP_MFA_FOR_TESTING === 'true' ||
    user.email?.endsWith('@cafe-pulse.test') === true

  if (!skipMfa) {
    const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

    if (!mfaData) {
      redirect('/mfa-enroll?return=/admin/dashboard')
    }

    const { currentLevel, nextLevel } = mfaData

    if (nextLevel === 'aal2' && currentLevel !== 'aal2') {
      // MFA enrolled but not verified this session
      redirect('/mfa-challenge?return=/admin/dashboard')
    }

    if (currentLevel !== 'aal2' && nextLevel !== 'aal2') {
      // No MFA enrolled — require enrollment
      redirect('/mfa-enroll?return=/admin/dashboard')
    }
  }

  // 3. Get tenant context from cookie (set by middleware)
  const tenantId = await getCurrentTenantId()

  // 4. Check for pending invite (first-login claim flow)
  if (user.email) {
    const serviceClient = createServiceClient()
    const { data: pendingInvite } = await serviceClient
      .from('tenant_pending_invites')
      .select('id, role')
      .eq('tenant_id', tenantId)
      .eq('invited_email', user.email)
      .is('deleted_at', null)
      .single()

    if (pendingInvite) {
      // Claim the invite: create membership (ignore conflict if already exists)
      await serviceClient
        .from('tenant_memberships')
        .upsert(
          { tenant_id: tenantId, user_id: user.id, role: pendingInvite.role },
          { onConflict: 'tenant_id,user_id', ignoreDuplicates: true }
        )

      // Hard-delete the pending invite (consumed)
      await serviceClient
        .from('tenant_pending_invites')
        .delete()
        .eq('id', pendingInvite.id)
    }
  }

  // 5. Check tenant membership with owner/admin/staff role (filter out soft-deleted)
  const { data: membership, error: membershipError } = await supabase
    .from('tenant_memberships')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin', 'staff'])
    .is('deleted_at', null)
    .single()

  if (membershipError || !membership) {
    // User authenticated but not admin of this tenant
    redirect('/admin/login?error=no-access')
  }

  // 6. Create tenant-scoped client (calls set_tenant_context RPC)
  const tenantClient = await createTenantClient(tenantId)

  return { user, membership, tenantClient, tenantId }
}
