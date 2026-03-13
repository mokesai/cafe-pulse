// Tenant identity loading module
// Provides cached function to retrieve business information from the tenants table.

import { cache } from 'react'

import { createServiceClient } from '@/lib/supabase/server'

import { getCurrentTenantId } from './context'
import type { TenantPublic } from './types'

/**
 * Retrieve business identity information for the current tenant.
 * Uses React cache() for request-level deduplication.
 *
 * This function returns public-safe tenant data (excludes Square credentials)
 * for use in both server and client components.
 *
 * @throws Error if tenant cannot be loaded
 * @returns TenantPublic - Business name, contact info, branding, and display settings
 */
export const getTenantIdentity = cache(async (): Promise<TenantPublic> => {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient() // OK: reading public tenant info

  const { data, error } = await supabase
    .from('tenants')
    .select(`
      id, slug, name, business_name,
      business_address, business_phone, business_email,
      business_hours, email_sender_name, email_sender_address,
      logo_url, primary_color, secondary_color,
      square_merchant_id, square_environment, square_location_id,
      is_active, features, created_at, updated_at
    `)
    .eq('id', tenantId)
    .single()

  if (error || !data) {
    throw new Error(`Failed to load tenant identity: ${error?.message}`)
  }

  return data as TenantPublic
})
