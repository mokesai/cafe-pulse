'use server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getCurrentTenantId } from '@/lib/tenant/context';
import { EmailService } from '@/lib/email/service';
import { revalidatePath } from 'next/cache';

type TeamActionResult = {
  success?: boolean;
  error?: string;
  message?: string;
};

async function getAuthenticatedAppAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const tenantId = await getCurrentTenantId();
  const { data: membership } = await supabase
    .from('tenant_memberships')
    .select('id, role')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin', 'staff'])
    .is('deleted_at', null)
    .single();

  if (!membership) return null;

  return { user, membership, tenantId };
}

async function getTenantInfo(tenantId: string) {
  const supabase = createServiceClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, slug')
    .eq('id', tenantId)
    .single();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const tenantUrl = tenant?.slug
    ? siteUrl.replace('://', `://${tenant.slug}.`)
    : siteUrl;

  return {
    name: tenant?.name || 'Unknown',
    loginUrl: `${tenantUrl}/admin/login`,
  };
}

/**
 * Invite a team member (app-level).
 *
 * Auth rules:
 * - owner can invite admin, staff
 * - admin can invite staff only
 * - staff cannot invite
 */
export async function inviteAppTeamMember(
  email: string,
  role: string
): Promise<TeamActionResult> {
  const auth = await getAuthenticatedAppAdmin();
  if (!auth) return { error: 'Unauthorized' };

  const { user, membership, tenantId } = auth;

  // Permission check
  const allowedRoles: Record<string, string[]> = {
    owner: ['admin', 'staff'],
    admin: ['staff'],
  };
  const canInvite = allowedRoles[membership.role] || [];
  if (!canInvite.includes(role)) {
    return { error: `You cannot invite users with the "${role}" role` };
  }

  if (!email || !email.includes('@')) {
    return { error: 'Invalid email address' };
  }

  const supabase = createServiceClient();

  // Check for existing membership
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const targetUser = existingUsers?.users?.find(u => u.email === email);

  if (targetUser) {
    const { data: existingMembership } = await supabase
      .from('tenant_memberships')
      .select('id, role')
      .eq('tenant_id', tenantId)
      .eq('user_id', targetUser.id)
      .is('deleted_at', null)
      .single();

    if (existingMembership) {
      return { error: `This user is already a team member (${existingMembership.role})` };
    }
  }

  // Check for existing pending invite
  const { data: existingInvite } = await supabase
    .from('tenant_pending_invites')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('invited_email', email)
    .is('deleted_at', null)
    .single();

  if (existingInvite) {
    return { error: 'An invite is already pending for this email' };
  }

  // Create pending invite
  const { error: insertError } = await supabase
    .from('tenant_pending_invites')
    .insert({
      tenant_id: tenantId,
      invited_email: email,
      role,
      invited_by: user.id,
    });

  if (insertError) {
    return { error: 'Failed to create invite: ' + insertError.message };
  }

  // Build tenant-specific redirect URL
  const { data: tenant } = await supabase
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .single();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const tenantRedirectUrl = tenant?.slug
    ? siteUrl.replace('://', `://${tenant.slug}.`)
    : siteUrl;

  const tenantInfo = await getTenantInfo(tenantId);

  // Send invite email for new users, notify existing users
  if (!targetUser) {
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      { redirectTo: tenantRedirectUrl }
    );

    if (inviteError) {
      return { error: 'Failed to send invite email: ' + inviteError.message };
    }
  } else {
    EmailService.sendTeamNotification({
      recipientEmail: email,
      eventType: 'invited',
      tenantName: tenantInfo.name,
      role,
      loginUrl: tenantInfo.loginUrl,
    }).catch(() => {});
  }

  revalidatePath('/admin/team');

  return {
    success: true,
    message: targetUser
      ? 'Invite created and notification sent.'
      : 'Invite email sent successfully.',
  };
}

/**
 * Change a team member's role (owner only).
 *
 * Rules:
 * - Only owner can change roles
 * - Can promote admin → owner
 * - Can demote owner → admin, admin → staff, etc.
 * - Cannot demote self if sole owner
 */
export async function changeTeamMemberRole(
  membershipId: string,
  newRole: string
): Promise<TeamActionResult> {
  const auth = await getAuthenticatedAppAdmin();
  if (!auth) return { error: 'Unauthorized' };

  if (auth.membership.role !== 'owner') {
    return { error: 'Only owners can change team member roles' };
  }

  if (!['owner', 'admin', 'staff'].includes(newRole)) {
    return { error: 'Invalid role' };
  }

  const supabase = createServiceClient();

  // Fetch the target membership
  const { data: target } = await supabase
    .from('tenant_memberships')
    .select('id, user_id, role')
    .eq('id', membershipId)
    .eq('tenant_id', auth.tenantId)
    .is('deleted_at', null)
    .single();

  if (!target) {
    return { error: 'Team member not found' };
  }

  // Sole owner protection: if demoting an owner, ensure there's another owner
  if (target.role === 'owner' && newRole !== 'owner') {
    const { count } = await supabase
      .from('tenant_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenantId)
      .eq('role', 'owner')
      .is('deleted_at', null);

    if ((count || 0) <= 1) {
      return { error: 'Cannot demote the sole owner. Promote another member to owner first.' };
    }
  }

  const { error: updateError } = await supabase
    .from('tenant_memberships')
    .update({ role: newRole })
    .eq('id', membershipId);

  if (updateError) {
    return { error: 'Failed to update role: ' + updateError.message };
  }

  // Notify the user about their role change (fire-and-forget)
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const targetEmail = usersData?.users?.find(u => u.id === target.user_id)?.email;
  if (targetEmail) {
    const tenantInfo = await getTenantInfo(auth.tenantId);
    EmailService.sendTeamNotification({
      recipientEmail: targetEmail,
      eventType: 'role_changed',
      tenantName: tenantInfo.name,
      role: newRole,
      previousRole: target.role,
      loginUrl: tenantInfo.loginUrl,
    }).catch(() => {});
  }

  revalidatePath('/admin/team');

  return { success: true, message: `Role updated to ${newRole}` };
}

/**
 * Remove a team member (owner only, soft-delete).
 *
 * Rules:
 * - Only owner can remove members
 * - Cannot remove self if sole owner
 */
export async function removeTeamMember(
  membershipId: string
): Promise<TeamActionResult> {
  const auth = await getAuthenticatedAppAdmin();
  if (!auth) return { error: 'Unauthorized' };

  if (auth.membership.role !== 'owner') {
    return { error: 'Only owners can remove team members' };
  }

  const supabase = createServiceClient();

  // Fetch the target membership
  const { data: target } = await supabase
    .from('tenant_memberships')
    .select('id, user_id, role')
    .eq('id', membershipId)
    .eq('tenant_id', auth.tenantId)
    .is('deleted_at', null)
    .single();

  if (!target) {
    return { error: 'Team member not found' };
  }

  // Sole owner protection
  if (target.user_id === auth.user.id && target.role === 'owner') {
    const { count } = await supabase
      .from('tenant_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenantId)
      .eq('role', 'owner')
      .is('deleted_at', null);

    if ((count || 0) <= 1) {
      return { error: 'Cannot remove yourself as the sole owner' };
    }
  }

  // Soft-delete
  const { error: deleteError } = await supabase
    .from('tenant_memberships')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', membershipId);

  if (deleteError) {
    return { error: 'Failed to remove team member: ' + deleteError.message };
  }

  // Notify the removed user (fire-and-forget)
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const targetEmail = usersData?.users?.find(u => u.id === target.user_id)?.email;
  if (targetEmail) {
    const tenantInfo = await getTenantInfo(auth.tenantId);
    EmailService.sendTeamNotification({
      recipientEmail: targetEmail,
      eventType: 'removed',
      tenantName: tenantInfo.name,
      role: target.role,
    }).catch(() => {});
  }

  revalidatePath('/admin/team');

  return { success: true, message: 'Team member removed' };
}
