'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export type ActionState = {
  errors?: Record<string, string[]>;
  success?: boolean;
};

// Schema for creating a new tenant
const createTenantSchema = z.object({
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
  name: z.string().min(1).max(200),
  business_name: z.string().min(1).max(200),
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
 */
export async function createTenant(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  // Validation
  const validatedFields = createTenantSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    business_name: formData.get('business_name'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  // Create tenant
  const supabase = createServiceClient();
  const { error: createError } = await supabase.from('tenants').insert({
    slug: validatedFields.data.slug,
    name: validatedFields.data.name,
    business_name: validatedFields.data.business_name,
    status: 'trial',
    is_active: true,
  });

  if (createError) {
    return {
      errors: {
        _form: ['Failed to create tenant: ' + createError.message],
      },
    };
  }

  // Revalidate tenants list
  revalidatePath('/platform/tenants');

  return {
    success: true,
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
