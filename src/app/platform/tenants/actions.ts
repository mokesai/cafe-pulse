'use server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { isPlatformAdmin, type PlatformAdminInfo } from '@/lib/platform/auth';
import { EmailService } from '@/lib/email/service';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export type ActionState = {
  errors?: {
    slug?: string[]
    name?: string[]
    admin_email?: string[]
    _form?: string[]
  };
  success?: boolean;
  tenantId?: string;
  tenantName?: string;
  tenantSlug?: string;
  adminEmail?: string;
  inviteId?: string;
  inviteSuccess?: boolean;
  inviteError?: string;
  userExists?: boolean;
  deleted?: boolean;
};

// Schema for creating a new tenant
const createTenantSchema = z.object({
  slug: z.string()
    .min(3, 'Slug must be at least 3 characters')
    .max(50, 'Slug must be less than 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
    .refine(s => !s.startsWith('-') && !s.endsWith('-'), 'Slug cannot start or end with hyphen'),
  name: z.string()
    .min(1, 'Business name is required')
    .max(200, 'Business name must be less than 200 characters'),
  admin_email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must be less than 255 characters'),
});

// Schema for updating an existing tenant
const updateTenantSchema = z.object({
  name: z.string().min(1).max(200),
  business_name: z.string().min(1).max(200).optional(),
  logo_url: z.string().url().nullable().optional(),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').nullable().optional(),
  secondary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').nullable().optional(),
  is_active: z.boolean(),
});

async function getAuthenticatedPlatformAdmin(): Promise<{ userId: string; admin: PlatformAdminInfo } | null> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user || !(await isPlatformAdmin(user.id))) {
    return null;
  }

  // Fetch role and scoped tenants
  const supabase = createServiceClient();
  const { data: adminRows } = await supabase
    .from('platform_admins')
    .select('role, tenant_id')
    .eq('user_id', user.id);

  const isSuperAdmin = adminRows?.some((row: { role: string }) => row.role === 'super_admin');
  const role = isSuperAdmin ? 'super_admin' : 'tenant_admin';
  const tenantIds = isSuperAdmin
    ? []
    : (adminRows || [])
        .filter((row: { tenant_id: string | null }) => row.tenant_id !== null)
        .map((row: { tenant_id: string | null }) => row.tenant_id as string);

  return {
    userId: user.id,
    admin: { userId: user.id, role, tenantIds } as PlatformAdminInfo,
  };
}

function canAccessTenant(admin: PlatformAdminInfo, tenantId: string): boolean {
  return admin.role === 'super_admin' || admin.tenantIds.includes(tenantId);
}

/**
 * Create a new tenant
 * Server Action for onboarding wizard (Plan 60-05)
 *
 * Validates input, checks slug uniqueness, creates tenant record with trial status,
 * and sends an invite email to the admin user (Plan 90-03).
 */
export async function createTenant(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  // Auth guard (SEC-2) — only super_admin can create tenants
  const auth = await getAuthenticatedPlatformAdmin();
  if (!auth || auth.admin.role !== 'super_admin') {
    return { errors: { _form: ['Unauthorized — only super admins can create tenants'] } };
  }

  // 1. Validate input
  const validatedFields = createTenantSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    admin_email: formData.get('admin_email'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const supabase = createServiceClient();

  // 2. Check slug uniqueness
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', validatedFields.data.slug)
    .single();

  if (existing) {
    return {
      errors: {
        slug: ['Slug is already in use'],
      },
    };
  }

  // 3. Create tenant record
  const { data: tenant, error: createError } = await supabase
    .from('tenants')
    .insert({
      slug: validatedFields.data.slug,
      name: validatedFields.data.name,
      business_name: validatedFields.data.name,
      status: 'trial',
      is_active: true,
    })
    .select('id')
    .single();

  if (createError || !tenant) {
    return {
      errors: {
        _form: ['Failed to create tenant: ' + (createError?.message || 'Unknown error')],
      },
    };
  }

  // 4. Check if user already exists
  const { data: existingUser } = await supabase.auth.admin.listUsers();
  const userExists = existingUser?.users?.some(
    (u) => u.email === validatedFields.data.admin_email
  );

  let inviteSuccess = false;
  let inviteError: string | undefined;

  // 5. Send invite email to admin (GAP-4) - only if user doesn't exist
  // Redirect to bare domain where AuthHashRedirect handles the hash fragment.
  // After account setup (password + MFA), smart redirect routes to tenant.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  if (!userExists) {
    const { error } = await supabase.auth.admin.inviteUserByEmail(
      validatedFields.data.admin_email,
      { redirectTo: siteUrl }
    );
    inviteSuccess = !error;
    inviteError = error?.message;
  } else {
    // User exists - they can claim invite on next login
    inviteSuccess = true;
    inviteError = undefined;
  }

  // 6. Record pending invite regardless (enables first-login claim)
  const { data: pendingInvite } = await supabase
    .from('tenant_pending_invites')
    .insert({
      tenant_id: tenant.id,
      invited_email: validatedFields.data.admin_email,
      role: 'owner',
      invited_by: auth.userId,
    })
    .select('id')
    .single();

  // 7. Revalidate tenant list
  revalidatePath('/platform/tenants');

  return {
    success: true,
    tenantId: tenant.id,
    tenantName: validatedFields.data.name,
    tenantSlug: validatedFields.data.slug,
    adminEmail: validatedFields.data.admin_email,
    inviteId: pendingInvite?.id,
    inviteSuccess,
    inviteError,
    userExists, // Pass this to UI so it can show appropriate message
  };
}

/**
 * Connect Square credentials for a tenant (sandbox or production).
 *
 * For sandbox: credentials are entered manually (OAuth doesn't work).
 * For production: credentials can be entered manually or via OAuth callback.
 *
 * Stores the access token in Vault and updates application_id + location_id
 * on the tenants row. The active environment is determined by SQUARE_ENVIRONMENT.
 */
export async function connectSquareCredentials(
  tenantId: string,
  formData: FormData
): Promise<ActionState> {
  const auth = await getAuthenticatedPlatformAdmin();
  if (!auth || !canAccessTenant(auth.admin, tenantId)) {
    return { errors: { _form: ['Unauthorized'] } };
  }

  const accessToken = formData.get('access_token') as string;
  const applicationId = formData.get('application_id') as string;
  const locationId = formData.get('location_id') as string;

  if (!accessToken || !applicationId || !locationId) {
    return { errors: { _form: ['All three fields are required'] } };
  }

  const environment = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const supabase = createServiceClient();

  // Store access token in Vault via the internal RPC
  const { error: rpcError } = await supabase.rpc(
    'store_square_credentials_internal',
    {
      p_tenant_id: tenantId,
      p_environment: environment,
      p_access_token: accessToken,
      p_refresh_token: environment === 'sandbox' ? 'sandbox-no-refresh' : 'pending-oauth-refresh',
      p_merchant_id: 'manual-entry',
      p_expires_at: environment === 'sandbox' ? '2099-12-31T23:59:59Z' : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }
  );

  if (rpcError) {
    return { errors: { _form: ['Failed to store credentials: ' + rpcError.message] } };
  }

  // Update application_id and location_id on the tenants row
  const { error: updateError } = await supabase
    .from('tenants')
    .update({
      square_application_id: applicationId,
      square_location_id: locationId,
      square_environment: environment,
    })
    .eq('id', tenantId);

  if (updateError) {
    return { errors: { _form: ['Failed to update tenant: ' + updateError.message] } };
  }

  revalidatePath('/platform/tenants');
  revalidatePath(`/platform/tenants/${tenantId}`);

  return { success: true };
}

/**
 * Resend invite email for a specific pending invite.
 */
export async function resendInvite(
  tenantId: string,
  inviteId: string
): Promise<{ success?: boolean; error?: string }> {
  // Auth guard (SEC-2)
  const auth = await getAuthenticatedPlatformAdmin();
  if (!auth || !canAccessTenant(auth.admin, tenantId)) {
    return { error: 'Unauthorized' };
  }

  const supabase = createServiceClient();

  // Look up the specific pending invite
  const { data: invite, error: lookupError } = await supabase
    .from('tenant_pending_invites')
    .select('id, invited_email')
    .eq('id', inviteId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single();

  if (lookupError || !invite) {
    return { error: 'Pending invite not found' };
  }

  // Redirect to bare domain where AuthHashRedirect handles the hash fragment
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  // Resend invite
  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    invite.invited_email,
    { redirectTo: siteUrl }
  );

  if (inviteError) {
    return { error: inviteError.message };
  }

  return { success: true };
}

/**
 * Invite a team member to a tenant (platform-level).
 *
 * Auth rules:
 * - super_admin can invite any role (owner, admin, staff)
 * - tenant_admin can invite admin and staff only
 */
export async function inviteTeamMember(
  tenantId: string,
  email: string,
  role: string
): Promise<{ success?: boolean; error?: string; message?: string }> {
  const auth = await getAuthenticatedPlatformAdmin();
  if (!auth || !canAccessTenant(auth.admin, tenantId)) {
    return { error: 'Unauthorized' };
  }

  // Validate role
  const allowedRoles = auth.admin.role === 'super_admin'
    ? ['owner', 'admin', 'staff']
    : ['admin', 'staff'];

  if (!allowedRoles.includes(role)) {
    return { error: `You cannot invite users with the "${role}" role` };
  }

  // Validate email
  if (!email || !email.includes('@')) {
    return { error: 'Invalid email address' };
  }

  const supabase = createServiceClient();

  // Check if user already has an active membership for this tenant
  const { data: existingMembership } = await supabase
    .from('tenant_memberships')
    .select('id, role')
    .eq('tenant_id', tenantId)
    .eq('user_id', (await supabase.auth.admin.listUsers()).data?.users?.find(u => u.email === email)?.id || '')
    .is('deleted_at', null)
    .single();

  if (existingMembership) {
    return { error: `This user is already a team member (${existingMembership.role})` };
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
      invited_by: auth.userId,
    });

  if (insertError) {
    return { error: 'Failed to create invite: ' + insertError.message };
  }

  // Check if user already exists in auth
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const userExists = existingUsers?.users?.some(u => u.email === email);

  // Build redirect URLs
  const { data: tenant } = await supabase
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .single();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const tenantRedirectUrl = tenant?.slug
    ? siteUrl.replace('://', `://${tenant.slug}.`)
    : siteUrl;

  const tenantName = tenant?.slug || 'Unknown';

  if (!userExists) {
    // Send Supabase invite email for new users
    // Redirect to bare domain where AuthHashRedirect handles the hash fragment
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      { redirectTo: siteUrl }
    );

    if (inviteError) {
      return { error: 'Failed to send invite email: ' + inviteError.message };
    }
  } else {
    // Notify existing user about the invite (fire-and-forget)
    const loginUrl = `${tenantRedirectUrl}/admin/login`;
    EmailService.sendTeamNotification({
      recipientEmail: email,
      eventType: 'invited',
      tenantName,
      role,
      loginUrl,
    }).catch(() => {}); // swallow — don't fail the action
  }

  revalidatePath(`/platform/tenants/${tenantId}`);

  return {
    success: true,
    message: userExists
      ? 'Invite created and notification sent.'
      : 'Invite email sent successfully.',
  };
}

/**
 * Update an existing tenant
 * Server Action for tenant edit page (Plan 60-06)
 */
export async function updateTenant(
  tenantId: string,
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  // Auth guard (SEC-2)
  const auth = await getAuthenticatedPlatformAdmin();
  if (!auth || !canAccessTenant(auth.admin, tenantId)) {
    return { errors: { _form: ['Unauthorized'] } };
  }

  // 1. Validate input
  const validatedFields = updateTenantSchema.safeParse({
    name: formData.get('name'),
    business_name: formData.get('business_name'),
    logo_url: formData.get('logo_url') || null,
    primary_color: formData.get('primary_color') || null,
    secondary_color: formData.get('secondary_color') || null,
    is_active: formData.get('is_active') === 'true',
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  // 2. Update tenant
  const supabase = createServiceClient();
  const { error: updateError } = await supabase
    .from('tenants')
    .update({
      name: validatedFields.data.name,
      business_name: validatedFields.data.business_name,
      logo_url: validatedFields.data.logo_url,
      primary_color: validatedFields.data.primary_color,
      secondary_color: validatedFields.data.secondary_color,
      is_active: validatedFields.data.is_active,
    })
    .eq('id', tenantId);

  if (updateError) {
    return {
      errors: {
        _form: ['Failed to update tenant: ' + updateError.message],
      },
    };
  }

  // 3. Revalidate affected pages
  revalidatePath('/platform/tenants');
  revalidatePath(`/platform/tenants/${tenantId}`);

  return {
    success: true,
  };
}

/**
 * Change tenant status
 * Server Action for tenant lifecycle management (Plan 60-07)
 *
 * Updates tenant status. Database trigger validates state machine transitions.
 */
export async function changeStatus(
  tenantId: string,
  newStatus: 'trial' | 'active' | 'paused' | 'suspended',
  _prevState: ActionState
): Promise<ActionState> {
  // Auth guard (SEC-2) — only super_admin can change status
  const auth = await getAuthenticatedPlatformAdmin();
  if (!auth || auth.admin.role !== 'super_admin') {
    return { errors: { _form: ['Unauthorized — only super admins can change tenant status'] } };
  }

  try {
    const supabase = createServiceClient();

    // Update status - database trigger validates transition
    const { error: updateError } = await supabase
      .from('tenants')
      .update({ status: newStatus })
      .eq('id', tenantId);

    if (updateError) {
      // Check if error is from state machine validation
      if (updateError.message.includes('Invalid transition')) {
        return {
          errors: {
            _form: [`Invalid status transition: ${updateError.message}`],
          },
        };
      }
      return {
        errors: {
          _form: ['Failed to update status: ' + updateError.message],
        },
      };
    }

    // Revalidate pages
    revalidatePath('/platform/tenants');
    revalidatePath(`/platform/tenants/${tenantId}`);

    return {
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      errors: {
        _form: ['Unexpected error: ' + message],
      },
    };
  }
}

/**
 * Soft delete a tenant
 * Server Action for tenant lifecycle management (Plan 60-07)
 *
 * Sets deleted_at timestamp and status='deleted'. Tenant data retained for 30 days.
 * Also cascades soft-delete to memberships and pending invites (Plan 90-01).
 */
export async function deleteTenant(
  tenantId: string,
  _prevState: ActionState
): Promise<ActionState> {
  // Auth guard (SEC-2) — only super_admin can delete tenants
  const auth = await getAuthenticatedPlatformAdmin();
  if (!auth || auth.admin.role !== 'super_admin') {
    return { errors: { _form: ['Unauthorized — only super admins can delete tenants'] } };
  }

  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    // Soft delete by setting deleted_at timestamp
    const { error: deleteError } = await supabase
      .from('tenants')
      .update({
        deleted_at: now,
        status: 'deleted',
        is_active: false,
      })
      .eq('id', tenantId);

    if (deleteError) {
      return {
        errors: {
          _form: ['Failed to delete tenant: ' + deleteError.message],
        },
      };
    }

    // Cascade soft-delete to memberships
    await supabase
      .from('tenant_memberships')
      .update({ deleted_at: now })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    // Cascade soft-delete to pending invites
    await supabase
      .from('tenant_pending_invites')
      .update({ deleted_at: now })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    // Revalidate tenant list
    revalidatePath('/platform/tenants');

    return {
      success: true,
      deleted: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      errors: {
        _form: ['Unexpected error: ' + message],
      },
    };
  }
}

/**
 * Restore a soft-deleted tenant
 * Server Action for tenant lifecycle management (Plan 60-07)
 *
 * Calls RPC function to restore tenant (platform admin check, clears deleted_at).
 */
export async function restoreTenant(
  tenantId: string,
  _prevState: ActionState
): Promise<ActionState> {
  // Auth guard (SEC-2) — only super_admin can restore tenants
  const auth = await getAuthenticatedPlatformAdmin();
  if (!auth || auth.admin.role !== 'super_admin') {
    return { errors: { _form: ['Unauthorized — only super admins can restore tenants'] } };
  }

  try {
    const supabase = createServiceClient();

    // Call restore function created in 60-01
    const { error: restoreError } = await supabase.rpc('restore_tenant', {
      tenant_id: tenantId,
    });

    if (restoreError) {
      return {
        errors: {
          _form: ['Failed to restore tenant: ' + restoreError.message],
        },
      };
    }

    // Revalidate pages
    revalidatePath('/platform/tenants');
    revalidatePath(`/platform/tenants/${tenantId}`);

    return {
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      errors: {
        _form: ['Unexpected error: ' + message],
      },
    };
  }
}
