// Tenant system type definitions
// These interfaces mirror the tenants and tenant_memberships database tables

/**
 * Tenant lifecycle states with enforced state machine transitions:
 * - trial → active, paused, deleted
 * - active → paused, suspended, deleted
 * - paused → active, suspended, deleted
 * - suspended → active, deleted
 * - deleted (final state, cannot transition away)
 */
export type TenantStatus = 'trial' | 'active' | 'paused' | 'suspended' | 'deleted'

export interface Tenant {
  id: string
  slug: string
  name: string
  business_name: string
  business_address: string | null
  business_phone: string | null
  business_email: string | null
  business_hours: Record<string, string> | null
  logo_url: string | null
  primary_color: string | null
  secondary_color: string | null
  square_application_id: string | null
  square_access_token: string | null
  square_location_id: string | null
  square_environment: string
  square_merchant_id: string | null
  square_webhook_signature_key: string | null
  square_access_token_vault_id: string | null
  square_webhook_key_vault_id: string | null
  email_sender_name: string | null
  email_sender_address: string | null
  is_active: boolean
  features: Record<string, unknown>
  status: TenantStatus
  status_changed_at: string
  trial_expires_at: string | null
  trial_days: number
  deleted_at: string | null
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
 * Platform super-admin who can manage all tenants.
 * Separate from tenant-level roles (owner, admin, staff).
 */
export interface PlatformAdmin {
  id: string
  user_id: string
  created_at: string
  created_by: string | null
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
  | 'square_access_token_vault_id'
  | 'square_webhook_key_vault_id'
>

/** Default tenant UUID matching the seed migration */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

/** Default tenant slug for single-tenant mode */
export const DEFAULT_TENANT_SLUG = 'littlecafe'
