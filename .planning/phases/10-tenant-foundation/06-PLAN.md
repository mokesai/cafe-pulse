---
phase: 10
plan: 06
name: middleware-tenant-resolution
wave: 4
depends_on: [5]
files_modified:
  - middleware.ts
files_created: []
autonomous: true
---

## Objective

Update the Next.js middleware to extract the tenant subdomain from the `Host` header, resolve the tenant from the database (with caching), and set `x-tenant-id` and `x-tenant-slug` cookies on the response. This makes tenant context available to all downstream Server Components and API routes.

## Tasks

1. Open `middleware.ts` and add the following imports at the top:
   ```typescript
   import { extractSubdomain, resolveTenantBySlug } from '@/lib/tenant/context'
   import { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from '@/lib/tenant/types'
   ```

2. Add tenant resolution logic between the `updateSession()` call and the `shouldBypassMaintenance()` check. The updated flow should be:

   ```typescript
   export async function middleware(request: NextRequest) {
     // 1. Refresh Supabase auth session (existing)
     const sessionResponse = await updateSession(request)

     // 2. Resolve tenant from subdomain (NEW)
     const host = request.headers.get('host') || ''
     const slug = extractSubdomain(host)

     if (slug) {
       const tenant = await resolveTenantBySlug(slug)
       if (tenant) {
         sessionResponse.cookies.set('x-tenant-id', tenant.id, {
           httpOnly: true,
           sameSite: 'strict',
           path: '/',
         })
         sessionResponse.cookies.set('x-tenant-slug', tenant.slug, {
           httpOnly: true,
           sameSite: 'strict',
           path: '/',
         })
       } else {
         // Subdomain provided but tenant not found — return 404
         const notFoundUrl = request.nextUrl.clone()
         notFoundUrl.pathname = '/404'
         return applyRewriteWithCookies(sessionResponse, notFoundUrl)
       }
     } else {
       // No subdomain (bare localhost or bare domain)
       // Set default tenant if no tenant cookie already exists
       if (!request.cookies.get('x-tenant-id')?.value) {
         sessionResponse.cookies.set('x-tenant-id', DEFAULT_TENANT_ID, {
           httpOnly: true,
           sameSite: 'strict',
           path: '/',
         })
         sessionResponse.cookies.set('x-tenant-slug', DEFAULT_TENANT_SLUG, {
           httpOnly: true,
           sameSite: 'strict',
           path: '/',
         })
       }
     }

     // 3. Maintenance mode check (existing, unchanged)
     if (shouldBypassMaintenance(request)) {
       return sessionResponse
     }
     // ... rest of existing maintenance logic
   }
   ```

3. Ensure the `applyRewriteWithCookies()` function continues to work correctly -- it already copies cookies from the session response to the rewrite response, so the tenant cookies will automatically propagate through maintenance mode rewrites.

4. Do NOT modify the `config.matcher` -- the existing matcher already handles the paths we need.

5. Do NOT modify `shouldBypassMaintenance()` -- tenant resolution should happen for all routes including admin and API routes, because those will eventually need tenant context too.

6. Keep the KDS paths (`/kds/*`) working with tenant context -- they should get the default tenant if no subdomain is present.

## Verification

- Start the dev server: `npm run dev:webpack`
- Visit `http://littlecafe.localhost:3000` -- page should load without errors
- Open browser DevTools > Application > Cookies -- should see `x-tenant-id` cookie with value `00000000-0000-0000-0000-000000000001` and `x-tenant-slug` with value `littlecafe`
- Visit `http://localhost:3000` -- should see `x-tenant-id` with the default tenant ID
- Visit `http://nonexistent.localhost:3000` -- should show 404 page (unknown tenant)
- Verify no console errors related to tenant resolution
- Verify existing functionality (menu page, admin page, KDS page) still works at `localhost:3000`

## must_haves

- Middleware extracts subdomain and resolves tenant from the database
- Tenant ID and slug are set as httpOnly cookies on the response
- Bare `localhost:3000` falls back to the default tenant
- Existing middleware behavior (session refresh, maintenance mode) is preserved
- The `applyRewriteWithCookies` helper continues to propagate tenant cookies through rewrites
- No regressions in existing page loads
