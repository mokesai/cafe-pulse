---
phase: 10
plan: 07
name: create-tenant-client
wave: 4
depends_on: [5]
files_modified:
  - src/lib/supabase/server.ts
files_created: []
autonomous: true
---

## Objective

Add `createTenantClient(tenantId)` to the Supabase server module. This factory creates a Supabase client that passes the `x-tenant-id` header with every request, enabling the `set_tenant_from_request()` pre-request function in PostgreSQL to set the session variable `app.tenant_id` for RLS policies.

## Tasks

1. Open `src/lib/supabase/server.ts` and add the following import if not already present:
   ```typescript
   // cookies import should already exist
   import { cookies } from 'next/headers'
   ```

2. Add the `createTenantClient()` function after the existing `createServiceClient()`:

   ```typescript
   /**
    * Create a Supabase client scoped to a specific tenant.
    * Passes x-tenant-id header which the PostgreSQL pre-request function
    * reads to set app.tenant_id session variable for RLS policies.
    */
   export async function createTenantClient(tenantId: string) {
     const cookieStore = await cookies()

     return createServerClient(
       process.env.NEXT_PUBLIC_SUPABASE_URL!,
       process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
       {
         global: {
           headers: {
             'x-tenant-id': tenantId,
           },
         },
         cookies: {
           getAll() {
             return cookieStore.getAll()
           },
           setAll(cookiesToSet) {
             try {
               cookiesToSet.forEach(({ name, value, options }) =>
                 cookieStore.set(name, value, options)
               )
             } catch {
               // The `setAll` method was called from a Server Component.
               // This can be ignored if you have middleware refreshing
               // user sessions.
             }
           },
         },
       }
     )
   }
   ```

3. Also add a convenience function that reads the tenant ID from the cookie automatically:

   ```typescript
   /**
    * Create a Supabase client scoped to the current tenant (from cookie).
    * Use this in Server Components and API routes where tenant context
    * has already been set by middleware.
    */
   export async function createCurrentTenantClient() {
     const cookieStore = await cookies()
     const tenantId = cookieStore.get('x-tenant-id')?.value
     if (!tenantId) {
       // Fall back to default tenant
       const { DEFAULT_TENANT_ID } = await import('@/lib/tenant/types')
       return createTenantClient(DEFAULT_TENANT_ID)
     }
     return createTenantClient(tenantId)
   }
   ```

4. Add a JSDoc comment to the existing `createClient()` and `createServiceClient()` explaining when to use each:
   - `createClient()` -- user-scoped, no tenant context, for auth operations
   - `createServiceClient()` -- admin, bypasses RLS, no tenant context
   - `createTenantClient(tenantId)` -- user-scoped with tenant context for RLS
   - `createCurrentTenantClient()` -- same as above but reads tenant from cookie

## Verification

- Run `npm run build` -- TypeScript compilation should succeed
- Run `npm run lint` -- no lint errors
- Verify the function signatures are correct by checking that `createTenantClient` returns the same type as `createClient`
- Manual test: In a Server Component or API route, call `createTenantClient('00000000-0000-0000-0000-000000000001')` and query a table -- should work without errors (tenant context is set but no RLS policies use it yet, so no data filtering expected)

## must_haves

- `createTenantClient(tenantId)` exists in `src/lib/supabase/server.ts`
- It passes the `x-tenant-id` header via the `global.headers` option
- It uses the same cookie handling pattern as the existing `createClient()`
- `createCurrentTenantClient()` reads tenant ID from the `x-tenant-id` cookie
- The existing `createClient()` and `createServiceClient()` are unchanged
