---
phase: 10
plan: 05
name: tenant-context-module
wave: 3
depends_on: [4]
files_modified:
  - src/lib/tenant/index.ts
files_created:
  - src/lib/tenant/context.ts
autonomous: true
---

## Objective

Create the tenant context resolution module that looks up tenants by slug (with caching) and provides helper functions to read the current tenant from request cookies. This is the core logic that middleware and server components will use.

## Tasks

1. Create `src/lib/tenant/context.ts` with the following functions:

2. `resolveTenantBySlug(slug: string): Promise<Tenant | null>`:
   - Check the in-memory cache first via `getCachedTenant(slug)` from `cache.ts`
   - On cache miss, query the `tenants` table using `createServiceClient()` from `@/lib/supabase/server`:
     ```typescript
     const supabase = createServiceClient()
     const { data, error } = await supabase
       .from('tenants')
       .select('*')
       .eq('slug', slug)
       .eq('is_active', true)
       .single()
     ```
   - If found, store in cache via `setCachedTenant(slug, data)` and return
   - If not found or error, return null
   - Use service client (not user-scoped) because this runs in middleware before auth context exists

3. `getCurrentTenantId(): Promise<string>`:
   - Read the `x-tenant-id` cookie from `next/headers` cookies
   - If not set, return `DEFAULT_TENANT_ID`
   - This is for use in Server Components and API routes (NOT middleware)
   ```typescript
   import { cookies } from 'next/headers'
   import { DEFAULT_TENANT_ID } from './types'

   export async function getCurrentTenantId(): Promise<string> {
     const cookieStore = await cookies()
     return cookieStore.get('x-tenant-id')?.value ?? DEFAULT_TENANT_ID
   }
   ```

4. `getCurrentTenantSlug(): Promise<string>`:
   - Read the `x-tenant-slug` cookie from `next/headers` cookies
   - If not set, return `DEFAULT_TENANT_SLUG`
   ```typescript
   export async function getCurrentTenantSlug(): Promise<string> {
     const cookieStore = await cookies()
     return cookieStore.get('x-tenant-slug')?.value ?? DEFAULT_TENANT_SLUG
   }
   ```

5. `extractSubdomain(host: string): string | null`:
   - Parse the `Host` header to extract the subdomain
   - Handle `slug.localhost` for dev and `slug.domain.com` for production
   - Return null for bare `localhost` or bare domain (no subdomain)
   - Strip port number if present
   ```typescript
   export function extractSubdomain(host: string): string | null {
     const hostname = host.split(':')[0]
     if (hostname === 'localhost') return null
     const parts = hostname.split('.')
     if (parts.length === 2 && parts[1] === 'localhost') {
       return parts[0]
     }
     if (parts.length >= 3) {
       return parts[0]
     }
     return null
   }
   ```

6. Update `src/lib/tenant/index.ts` to also export from `./context`:
   ```typescript
   export * from './types'
   export * from './cache'
   export * from './context'
   ```

## Verification

- Run `npm run build` -- TypeScript compilation should succeed
- Run `npm run lint` -- no lint errors
- Unit-test `extractSubdomain()` mentally:
  - `'littlecafe.localhost:3000'` -> `'littlecafe'`
  - `'localhost:3000'` -> `null`
  - `'littlecafe.example.com'` -> `'littlecafe'`
  - `'example.com'` -> `null`
  - `'www.example.com'` -> `'www'` (expected; www is treated as subdomain)

## must_haves

- `resolveTenantBySlug()` checks cache before querying DB
- `resolveTenantBySlug()` uses `createServiceClient()` (service role, not user-scoped)
- `getCurrentTenantId()` falls back to `DEFAULT_TENANT_ID` when no cookie is set
- `extractSubdomain()` correctly parses `slug.localhost:PORT` for development
- The module is importable from `@/lib/tenant`
