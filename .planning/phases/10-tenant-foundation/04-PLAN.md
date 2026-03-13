---
phase: 10
plan: 04
name: tenant-types-and-cache
wave: 2
depends_on: [1]
files_modified: []
files_created:
  - src/lib/tenant/types.ts
  - src/lib/tenant/cache.ts
  - src/lib/tenant/index.ts
autonomous: true
---

## Objective

Create the TypeScript type definitions for the tenant system and the in-memory cache module. These are the foundational building blocks that the tenant context module and middleware will depend on.

## Tasks

1. Create `src/lib/tenant/types.ts` with the following interfaces:

   - `Tenant` interface matching the `tenants` table columns:
     ```typescript
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
     ```

   - `TenantMembership` interface matching `tenant_memberships`:
     ```typescript
     export type TenantRole = 'owner' | 'admin' | 'staff' | 'customer'

     export interface TenantMembership {
       id: string
       tenant_id: string
       user_id: string
       role: TenantRole
       created_at: string
     }
     ```

   - `TenantPublic` type that excludes sensitive fields (Square credentials) for client-side use:
     ```typescript
     export type TenantPublic = Omit<Tenant,
       | 'square_access_token'
       | 'square_webhook_signature_key'
       | 'square_application_id'
     >
     ```

   - `DEFAULT_TENANT_ID` constant:
     ```typescript
     export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'
     export const DEFAULT_TENANT_SLUG = 'littlecafe'
     ```

2. Create `src/lib/tenant/cache.ts` following the `globalThis` pattern from `src/lib/services/siteSettings.edge.ts`:

   - Define a `TenantCacheEntry` type with `tenant` and `expiresAt` fields
   - Use `globalThis.__tenantCache` as a `Map<string, TenantCacheEntry>` (keyed by slug)
   - Implement `getCachedTenant(slug: string): Tenant | null` -- returns tenant if cache hit and not expired, null otherwise
   - Implement `setCachedTenant(slug: string, tenant: Tenant): void` -- stores tenant with TTL
   - Implement `invalidateTenantCache(slug?: string): void` -- clears one entry or entire cache
   - Use 60-second TTL (`TENANT_CACHE_TTL_MS = 60 * 1000`)
   - Declare the global type properly:
     ```typescript
     declare global {
       var __tenantCache: Map<string, TenantCacheEntry> | undefined
     }
     ```

3. Create `src/lib/tenant/index.ts` barrel export:
   ```typescript
   export * from './types'
   export * from './cache'
   ```

## Verification

- Run `npm run build` -- TypeScript compilation should succeed with no errors in the new files
- Run `npm run lint` -- no lint errors in the new files
- Verify imports work: the types should be importable via `@/lib/tenant` or `@/lib/tenant/types`
- Verify `DEFAULT_TENANT_ID` matches the UUID used in the seed migration (plan 03)

## must_haves

- `Tenant` interface accurately reflects all columns in the `tenants` table
- `TenantMembership` interface accurately reflects all columns in the `tenant_memberships` table
- The cache uses the established `globalThis` pattern from `siteSettings.edge.ts`
- Cache TTL is 60 seconds
- Cache is keyed by slug (not tenant ID) since middleware resolves by slug
- `DEFAULT_TENANT_ID` constant matches the seeded UUID
