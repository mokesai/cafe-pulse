// Tenant system type definitions
// These interfaces mirror the tenants and tenant_memberships database tables

export interface Tenant {
  id: string
  slug: string
  name: string
  business_name: string
  business_address: string | null
  business_phone: string | null
  business_email: string | null
  business_hours: Record<string, string> | null
  square_application_id: string | null
  square_access_token: string | null
  square_location_id: string | null
  square_environment: string
  square_merchant_id: string | null
  square_webhook_signature_key: string | null
  email_sender_name: string | null
  email_sender_address: string | null
  is_active: boolean
  features: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type TenantRole = 'owner' | 'admin' | 'staff' | 'customer'

export interface TenantMembership {
  id: string
  tenant_id: string
  user_id: string
  role: TenantRole
  created_at: string
}

/**
 * Public-safe tenant data that excludes sensitive fields (Square credentials).
 * Use this type for client-side components and public API responses.
 */
export type TenantPublic = Omit<
  Tenant,
  | 'square_access_token'
  | 'square_webhook_signature_key'
  | 'square_application_id'
>

/** Default tenant UUID matching the seed migration */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

/** Default tenant slug for single-tenant mode */
export const DEFAULT_TENANT_SLUG = 'littlecafe'
