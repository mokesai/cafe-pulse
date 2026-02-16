'use server';

import { createServiceClient } from '@/lib/supabase/server';
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

/**
 * Create a new tenant
 * Server Action for onboarding wizard (Plan 60-05)
 *
 * Validates input, checks slug uniqueness, creates tenant record with trial status.
 */
export async function createTenant(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
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

  // 2. Check slug uniqueness
  const supabase = await createServiceClient();
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

  // 4. TODO: Create admin user account (Supabase Admin API or invite link)
  // For now, skip user creation - will add in future plan

  // 5. Revalidate tenant list
  revalidatePath('/platform/tenants');

  return {
    success: true,
    tenantId: tenant.id,
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
  prevState: ActionState
): Promise<ActionState> {
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
  } catch (error: any) {
    return {
      errors: {
        _form: ['Unexpected error: ' + error.message],
      },
    };
  }
}

/**
 * Soft delete a tenant
 * Server Action for tenant lifecycle management (Plan 60-07)
 *
 * Sets deleted_at timestamp and status='deleted'. Tenant data retained for 30 days.
 */
export async function deleteTenant(
  tenantId: string,
  prevState: ActionState
): Promise<ActionState> {
  try {
    const supabase = createServiceClient();

    // Soft delete by setting deleted_at timestamp
    const { error: deleteError } = await supabase
      .from('tenants')
      .update({
        deleted_at: new Date().toISOString(),
        status: 'deleted',
      })
      .eq('id', tenantId);

    if (deleteError) {
      return {
        errors: {
          _form: ['Failed to delete tenant: ' + deleteError.message],
        },
      };
    }

    // Revalidate tenant list
    revalidatePath('/platform/tenants');

    return {
      success: true,
      deleted: true,
    };
  } catch (error: any) {
    return {
      errors: {
        _form: ['Unexpected error: ' + error.message],
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
  prevState: ActionState
): Promise<ActionState> {
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
  } catch (error: any) {
    return {
      errors: {
        _form: ['Unexpected error: ' + error.message],
      },
    };
  }
}
