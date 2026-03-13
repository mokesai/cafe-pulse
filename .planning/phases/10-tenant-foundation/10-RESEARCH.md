# Phase 10 Research: Tenant Foundation

## Supabase Session Variables for RLS

### How `set_config` / `current_setting` Work

PostgreSQL provides two functions for session-scoped configuration:

```sql
-- Set a custom variable
set_config('app.tenant_id', 'some-uuid', is_local)

-- Read it back
current_setting('app.tenant_id')
current_setting('app.tenant_id', true)  -- true = return NULL instead of error if missing
```

The `is_local` boolean parameter is critical:

| `is_local` | Scope | Duration | Behavior |
|------------|-------|----------|----------|
| `true` | Current transaction only | Reverts after COMMIT/ROLLBACK | Safer for multi-tenant; automatically cleans up |
| `false` | Current session | Persists until session ends or changed | Dangerous with connection pooling; stale tenant context can leak |

**For multi-tenant RLS, always use `is_local = true`** to ensure tenant context is scoped to the current transaction and cannot leak to the next request that reuses the same connection.

### How PostgREST (Supabase API) Handles This Internally

PostgREST (which powers the Supabase REST API) wraps every request in a transaction:

```
START TRANSACTION
  -> Set transaction-scoped settings (request.jwt.claims, request.headers, etc.)
  -> Execute db-pre-request function (if configured)
  -> Execute main query
COMMIT
```

This means PostgREST already sets `request.jwt.claims` and `request.jwt.claim.sub` (equivalent to `auth.uid()`) as transaction-scoped session variables. The RLS functions `auth.uid()` and `auth.jwt()` are wrappers around `current_setting('request.jwt.claim.sub')` etc.

### Calling RPC from Supabase JS Client

Yes, you can call an RPC function from the Supabase JS client:

```typescript
const supabase = createServerClient(...)
await supabase.rpc('set_tenant_context', { p_tenant_id: tenantId })
```

**However, there is a critical gotcha:** Each `.rpc()` call and each `.from()` query is a separate HTTP request to PostgREST. PostgREST wraps each HTTP request in its own transaction. This means:

```typescript
// These are TWO separate HTTP requests = TWO separate transactions
await supabase.rpc('set_tenant_context', { p_tenant_id: tenantId })  // Transaction 1
await supabase.from('orders').select('*')                              // Transaction 2 (tenant_id NOT set!)
```

**The `set_config` from the RPC call does NOT persist to the next query** because `is_local = true` scopes it to the RPC's transaction, which already committed.

### Solutions

**Option A: Use `db-pre-request` function (Recommended)**

PostgREST supports a `db-pre-request` configuration that runs a function before every query, inside the same transaction. Supabase exposes this in the Dashboard under Database > Webhooks & Functions > Hooks (or via API settings).

```sql
-- Create the pre-request function
CREATE OR REPLACE FUNCTION public.set_tenant_from_header()
RETURNS void AS $$
DECLARE
  tenant_id_header text;
BEGIN
  -- Read custom claim from JWT or a custom header
  tenant_id_header := current_setting('request.jwt.claims', true)::json->>'tenant_id';
  IF tenant_id_header IS NOT NULL THEN
    PERFORM set_config('app.tenant_id', tenant_id_header, true);
  END IF;
END;
$$ LANGUAGE plpgsql;
```

Then set this as the pre-request function in Supabase Dashboard > API Settings.

Pros: Every query automatically gets tenant context. No extra RPC call needed.
Cons: Requires tenant_id in the JWT claims, which means custom claims on sign-up or a wrapper.

**Option B: Service role client with raw SQL**

Use `createServiceClient()` (service role bypasses RLS) and manually include `tenant_id` in every WHERE clause. Less secure but simpler for Phase 10.

```typescript
export function createTenantServiceClient(tenantId: string) {
  const supabase = createServiceClient()
  // Wrap queries to always include tenant_id
  return { supabase, tenantId }
}
```

**Option C: Custom header via PostgREST (Best for Phase 10)**

Pass tenant_id as a custom header that PostgREST makes available via `current_setting('request.header.x-tenant-id')`. The pre-request function reads it:

```sql
CREATE OR REPLACE FUNCTION public.set_tenant_from_request()
RETURNS void AS $$
DECLARE
  header_tenant_id text;
BEGIN
  header_tenant_id := current_setting('request.header.x-tenant-id', true);
  IF header_tenant_id IS NOT NULL AND header_tenant_id != '' THEN
    PERFORM set_config('app.tenant_id', header_tenant_id, true);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Then in the Supabase JS client, pass the header:

```typescript
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
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
```

PostgREST automatically exposes request headers as `request.header.<name>` session variables. The pre-request function reads `request.header.x-tenant-id` and calls `set_config('app.tenant_id', ...)`.

Pros: Works with Supabase's standard REST API. No JWT modification needed. Each query carries tenant context.
Cons: Requires configuring `db-pre-request` in Supabase settings.

### Connection Pooling Considerations

Supabase uses **Supavisor** as its connection pooler with two modes:

| Mode | Port | Session Variables | Use Case |
|------|------|-------------------|----------|
| **Transaction mode** (default for serverless) | 6543 | `is_local=true` works (within transaction) | Edge functions, serverless, short-lived connections |
| **Session mode** | 5432 | `is_local=false` works (session-scoped) | Long-lived connections, prepared statements |

**For our use case (Next.js on Vercel/serverless):** Transaction mode is the default. Since PostgREST wraps each request in a transaction and the pre-request function runs inside that transaction, `set_config('app.tenant_id', ..., true)` is safe. The variable is set at the start of the transaction and cleared when it commits.

**Key safety guarantee:** With `is_local = true`, even if Supavisor reuses the same PostgreSQL connection for a different tenant's next request, the previous `app.tenant_id` is gone because the transaction committed.

---

## Next.js Middleware Subdomain Routing

### Current Middleware Pattern

The existing `middleware.ts` does two things:
1. Calls `updateSession(request)` from `@/lib/supabase/middleware` to refresh Supabase auth cookies
2. Checks maintenance mode via `getCachedSiteStatus(request)` and rewrites to `/under-construction` if needed

### Subdomain Extraction Pattern

```typescript
function extractSubdomain(request: NextRequest): string | null {
  const host = request.headers.get('host') || ''

  // Production: slug.yourdomain.com
  // Dev: slug.localhost:3000
  // Strip port if present
  const hostname = host.split(':')[0]

  // Split into parts
  const parts = hostname.split('.')

  // localhost (no subdomain)
  if (hostname === 'localhost') return null

  // slug.localhost (dev subdomain)
  if (parts.length === 2 && parts[1] === 'localhost') {
    return parts[0]
  }

  // slug.domain.com (production subdomain)
  // Assumes 2-part TLD (e.g., .com, .io) = 3 parts minimum with subdomain
  if (parts.length >= 3) {
    return parts[0]
  }

  return null
}
```

### Handling `localhost` vs Subdomains in Development

There are several approaches for local development:

**Approach 1: `slug.localhost:3000` (Recommended)**

Modern browsers resolve `*.localhost` to `127.0.0.1` automatically (Chrome, Firefox, Edge). No `/etc/hosts` editing needed.

```
littlecafe.localhost:3000  -> slug = 'littlecafe'
localhost:3000             -> slug = null (use default tenant or platform)
```

**Approach 2: Query parameter fallback for dev**

```typescript
// In development, allow ?tenant=littlecafe as override
if (process.env.NODE_ENV === 'development') {
  const tenantParam = request.nextUrl.searchParams.get('tenant')
  if (tenantParam) return tenantParam
}
```

**Approach 3: Cookie-based tenant (for API routes)**

Middleware sets the tenant in a cookie. Downstream Server Components and API routes read from the cookie instead of re-parsing the Host header.

```typescript
// In middleware
const slug = extractSubdomain(request)
if (slug) {
  response.cookies.set('x-tenant-slug', slug, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  })
}
```

### Runtime Constraints

As of Next.js 15.5 (our version: `^15.5.7`), middleware uses the **Node.js runtime** by default (this changed in 15.5 from Edge to Node.js). This means:

- Full Node.js APIs are available (no Edge runtime restrictions)
- Can use `node:crypto`, `Buffer`, etc. freely
- No code size limits from Edge bundling
- Supabase client works without Edge-specific polyfills

**Important future note:** Next.js 16 renames `middleware.ts` to `proxy.ts` and the exported function from `middleware()` to `proxy()`. A codemod is available: `npx @next/codemod@canary middleware-to-proxy .` We should plan for this when upgrading, but for now, `middleware.ts` is the correct convention.

### Proposed Middleware Flow

```typescript
export async function middleware(request: NextRequest) {
  // 1. Refresh Supabase auth session (existing)
  const sessionResponse = await updateSession(request)

  // 2. Extract tenant from subdomain (NEW)
  const slug = extractSubdomain(request)
  if (slug) {
    // Lookup tenant (from cache or DB)
    const tenant = await resolveTenantBySlug(slug)
    if (!tenant || !tenant.is_active) {
      // Unknown or inactive tenant -> 404 or redirect
      return NextResponse.rewrite(new URL('/404', request.url))
    }
    // Set tenant info in cookie for downstream use
    sessionResponse.cookies.set('x-tenant-id', tenant.id, { httpOnly: true, path: '/' })
    sessionResponse.cookies.set('x-tenant-slug', tenant.slug, { httpOnly: true, path: '/' })
  }

  // 3. Maintenance mode check (existing, now tenant-aware)
  if (shouldBypassMaintenance(request)) {
    return sessionResponse
  }
  // ...rest of existing logic
}
```

### Setting Request Headers vs Cookies

For passing tenant context downstream, we have two options:

| Method | Pros | Cons |
|--------|------|------|
| **Cookie** (`x-tenant-id`) | Persists across requests, available in client components via `document.cookie` | Requires `Set-Cookie` header, 4KB limit per cookie |
| **Request Header** (`x-tenant-id`) | Available via `headers()` in Server Components, no cookie overhead | Only available in the current request, not in client components |

**Recommendation:** Use both. Set a request header for immediate server-side access in the current request, and a cookie for persistence across navigation. The middleware already demonstrates this pattern with `applyRewriteWithCookies()`.

---

## In-Memory Caching Strategy

### How Module-Level Caching Works in Next.js

The codebase already uses module-level caching in `siteSettings.edge.ts`:

```typescript
// src/lib/services/siteSettings.edge.ts
declare global {
  var __siteStatusCacheEdge: CacheEntry | undefined
}

const CACHE_TTL_MS = 5 * 1000

export async function getCachedSiteStatus(request: NextRequest, forceRefresh = false): Promise<SiteStatus> {
  const now = Date.now()
  const cache = globalThis.__siteStatusCacheEdge
  if (!forceRefresh && cache && cache.expiresAt > now) {
    return cache.status  // Cache hit
  }
  // ...fetch and cache
}
```

This uses `globalThis` to persist across requests within the same process.

### Do Serverless Function Instances Share Memory?

**No.** Each serverless function instance (Lambda, Vercel Function) is an isolated process. However:

- **Within a single instance:** Module-level variables persist across requests served by that instance (warm starts)
- **Across instances:** No shared memory. Each instance has its own cache
- **Cold starts:** Cache is empty. First request always hits the database
- **Instance recycling:** Platform may terminate idle instances, losing the cache

**For Next.js on a traditional server (PM2, Docker):** The cache persists for the lifetime of the Node.js process. All requests share the same in-memory cache. This is the simpler case.

**For Next.js on Vercel serverless:** Each function invocation reuses the module-level cache if the instance is warm, but cold starts create a new empty cache.

### Right TTL Strategy for Tenant Cache

Tenant configuration changes infrequently (slug, business name, Square credentials). The cache strategy should balance freshness with performance:

```typescript
// src/lib/tenant/cache.ts

type TenantCacheEntry = {
  tenant: Tenant
  expiresAt: number
}

const TENANT_CACHE_TTL_MS = 60 * 1000  // 1 minute
const tenantCache = new Map<string, TenantCacheEntry>()

export function getCachedTenant(slug: string): Tenant | null {
  const entry = tenantCache.get(slug)
  if (entry && entry.expiresAt > Date.now()) {
    return entry.tenant
  }
  return null
}

export function setCachedTenant(slug: string, tenant: Tenant): void {
  tenantCache.set(slug, {
    tenant,
    expiresAt: Date.now() + TENANT_CACHE_TTL_MS,
  })
}

export function invalidateTenantCache(slug: string): void {
  tenantCache.delete(slug)
}
```

**Recommended TTL:** 60 seconds for tenant resolution. This means at most 1 DB query per minute per tenant per process instance. Tenant config rarely changes, so even 5 minutes would be safe, but 60 seconds gives a reasonable refresh window if a tenant is deactivated.

**Cache key:** Use `slug` (string), not `tenant_id` (UUID), because middleware resolves by slug.

### Middleware vs Server Component Caching

The middleware runs in a different execution context than Server Components:

- **Middleware cache:** Uses `globalThis` (same pattern as `siteSettings.edge.ts`). Persists across middleware invocations in the same process.
- **Server Component cache:** Module-level `Map` in `src/lib/tenant/cache.ts`. Persists across Server Component renders in the same process.
- **These are different caches** if middleware runs in a separate worker (Edge Runtime). But since Next.js 15.5+ defaults middleware to Node.js runtime, they share the same process, and thus the same `globalThis` / module scope.

### Alternative: `unstable_cache` or `next/cache`

Next.js provides `unstable_cache` (now stable in 15.x as part of the caching layer) for data caching with tags and revalidation. However, for tenant resolution in middleware, a simple in-memory `Map` with TTL is simpler and avoids the complexity of the Next.js cache layer. Reserve `unstable_cache` for data-heavy queries (menu items, orders) in later phases.

---

## Credential Storage (Vault vs Plain)

### Supabase Vault Overview

Supabase Vault is a PostgreSQL extension (built on `pgsodium`) that provides authenticated encryption at rest for secrets:

```sql
-- Store a secret
SELECT vault.create_secret('sk_live_abc123', 'square_access_token_tenant_abc', 'Square access token for tenant ABC');

-- Retrieve decrypted secrets
SELECT * FROM vault.decrypted_secrets WHERE name = 'square_access_token_tenant_abc';
-- Returns: id, name, description, secret (plaintext), key_id, nonce, created_at, updated_at
```

**How encryption works:**
- Secrets are encrypted using AES-256-GCM (via pgsodium/libsodium)
- The encryption key is managed by Supabase infrastructure, stored separately from the database
- The `vault.secrets` table stores ciphertext; the `vault.decrypted_secrets` view decrypts on read
- Backups and replication streams contain only ciphertext

### Vault for Square Access Tokens: Pros and Cons

| Factor | Vault | Plain Column |
|--------|-------|-------------|
| **Security at rest** | Encrypted (AES-256-GCM) | Plaintext in database |
| **Security in backups** | Encrypted | Plaintext |
| **Query complexity** | Requires JOIN to `vault.decrypted_secrets` | Direct column read |
| **Performance** | Slight overhead for decryption | No overhead |
| **Migration complexity** | Separate table, foreign key or name-based lookup | Simple column on `tenants` table |
| **Phase 10 scope** | Adds complexity to foundation phase | Simpler to implement |

### Recommendation for Phase 10

**Start with plain columns on the `tenants` table for Phase 10. Migrate to Vault in a later phase.**

Rationale:
1. Phase 10 is about foundation -- getting tenant resolution working. Adding Vault adds migration complexity and a JOIN to every credential lookup.
2. The `tenants` table is already protected by RLS (only platform admins can read credentials). The access tokens are not exposed to the client.
3. The service role client bypasses RLS anyway, so the real risk is database backup exposure or unauthorized DB access, both of which are mitigated by Supabase's infrastructure encryption.
4. Vault can be added in a dedicated security hardening phase (e.g., Phase 8 or a post-launch sprint) with a migration that moves credentials from plain columns to Vault entries.

**If Vault is added later, the pattern would be:**

```sql
-- Migration: move credentials to Vault
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id, slug, square_access_token FROM tenants WHERE square_access_token IS NOT NULL LOOP
    PERFORM vault.create_secret(
      t.square_access_token,
      'square_token_' || t.slug,
      'Square access token for tenant ' || t.slug
    );
    UPDATE tenants SET square_access_token = NULL,
                       square_token_vault_name = 'square_token_' || t.slug
    WHERE id = t.id;
  END LOOP;
END $$;
```

```typescript
// Future: load credentials from Vault
async function getTenantSquareToken(tenantSlug: string): Promise<string> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('decrypted_secrets')  // vault.decrypted_secrets view
    .select('decrypted_secret')
    .eq('name', `square_token_${tenantSlug}`)
    .single()
  return data?.decrypted_secret
}
```

---

## Existing Codebase Patterns

### `middleware.ts` -- Current Pattern

**Location:** `/Users/jerrym/Documents/projects/KP3-cafe/cafe-web/website/middleware.ts`

The middleware does two things in sequence:
1. **Session refresh:** Calls `updateSession(request)` which creates a Supabase client, calls `supabase.auth.getUser()` to refresh the JWT, and propagates cookies.
2. **Maintenance gate:** Fetches site status from `/api/public/site-status` (with 5-second in-memory cache) and rewrites to `/under-construction` if `isCustomerAppLive` is false.

Key patterns to preserve:
- `applyRewriteWithCookies()` helper for applying rewrites while preserving cookies from the session response
- `shouldBypassMaintenance()` for exempting admin, API, and auth routes
- Matcher config excludes static files and images

**Insertion point for tenant resolution:** Between steps 1 and 2, after the session is refreshed but before the maintenance check. Tenant resolution should not affect admin/API/auth routes (or should it? Decision needed -- likely yes for API routes that need tenant context).

### `src/lib/supabase/server.ts` -- Supabase Client Creation

**Location:** `/Users/jerrym/Documents/projects/KP3-cafe/cafe-web/website/src/lib/supabase/server.ts`

Two client factories:
- `createClient()` -- User-scoped, reads/writes cookies, uses the publishable key (anon). Respects RLS.
- `createServiceClient()` -- Admin-scoped, no cookies, uses the secret key (service role). Bypasses RLS.

`createTenantClient()` would be a third factory that adds the `x-tenant-id` header:

```typescript
export async function createTenantClient(tenantId: string) {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: {
        headers: { 'x-tenant-id': tenantId },
      },
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
```

Note: The middleware file uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` while server.ts uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These should be the same value (Supabase renamed "anon key" to "publishable key"). Both env vars should be set to the same value in `.env.local`.

### `src/lib/supabase/middleware.ts` -- Session Update

**Location:** `/Users/jerrym/Documents/projects/KP3-cafe/cafe-web/website/src/lib/supabase/middleware.ts`

Creates a Supabase client within the middleware context (using request cookies, not `next/headers`), calls `auth.getUser()` to refresh the session, and propagates the updated cookies to the response.

**Important comment in the file:** "Avoid writing any logic between createServerClient and supabase.auth.getUser()." This means tenant resolution should happen AFTER `updateSession()` returns, not inside the Supabase middleware.

### `src/lib/supabase/database.ts` -- Database Operations

**Location:** `/Users/jerrym/Documents/projects/KP3-cafe/cafe-web/website/src/lib/supabase/database.ts`

All operations use `createClient()` (user-scoped) or `createServiceClient()` (for order creation). None pass `tenant_id`. In later phases, these will need to either:
- Switch to `createTenantClient(tenantId)` which sets the header, or
- Add explicit `.eq('tenant_id', tenantId)` to every query (less safe).

### `src/lib/constants/app.ts` -- Hardcoded Business Info

**Location:** `/Users/jerrym/Documents/projects/KP3-cafe/cafe-web/website/src/lib/constants/app.ts`

All business identity is hardcoded:
- `APP_NAME = 'Little Cafe'`
- `BUSINESS_INFO` with address, phone, hours
- `ROUTES`, `API_ENDPOINTS` (these stay the same across tenants)
- `STORAGE_KEYS` (will need tenant prefixing in Phase 6)
- `ENV` object (will need tenant-specific Square config in Phase 3)

In Phase 4, `APP_NAME` and `BUSINESS_INFO` will come from the `tenants` table. For Phase 10 (foundation), these remain hardcoded -- the default tenant row will match these values.

### `src/lib/services/siteSettings.edge.ts` -- Caching Pattern

**Location:** `/Users/jerrym/Documents/projects/KP3-cafe/cafe-web/website/src/lib/services/siteSettings.edge.ts`

Uses `globalThis.__siteStatusCacheEdge` with a 5-second TTL. This is the established caching pattern in the codebase and should be followed for tenant caching:

```typescript
declare global {
  var __tenantCache: Map<string, TenantCacheEntry> | undefined
}

const tenantCache = globalThis.__tenantCache ??= new Map<string, TenantCacheEntry>()
```

### `src/lib/admin/auth.ts` -- Admin Auth

**Location:** `/Users/jerrym/Documents/projects/KP3-cafe/cafe-web/website/src/lib/admin/auth.ts`

Checks `profiles.role === 'admin'` for admin access. In Phase 5, this will check `tenant_memberships` instead. For Phase 10, the `tenant_memberships` table is created but admin auth remains unchanged.

---

## Recommendations

### Phase 10 Implementation Plan

Based on this research, here are the specific recommendations for Phase 10:

#### 1. Database: Use Option C (Custom Header) for Tenant Context

Create the `set_tenant_from_request()` pre-request function that reads `request.header.x-tenant-id` and sets `app.tenant_id`. This is the cleanest approach because:
- It works with the standard Supabase JS client (just add a global header)
- No JWT modification needed
- Each PostgREST request carries tenant context in the same transaction
- Safe with connection pooling (transaction-scoped `set_config`)

```sql
-- Migration: Create pre-request function
CREATE OR REPLACE FUNCTION public.set_tenant_from_request()
RETURNS void AS $$
DECLARE
  header_tenant_id text;
BEGIN
  header_tenant_id := current_setting('request.header.x-tenant-id', true);
  IF header_tenant_id IS NOT NULL AND header_tenant_id != '' THEN
    PERFORM set_config('app.tenant_id', header_tenant_id, true);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: After creating this function, go to Supabase Dashboard > Database > Webhooks & Functions
-- and set it as the db-pre-request function. Or use the API:
-- ALTER ROLE authenticator SET pgrst.db_pre_request = 'set_tenant_from_request';
-- NOTIFY pgrst, 'reload config';
```

**Important:** After deploying the migration, configure PostgREST to use this function as the pre-request hook via the Supabase Dashboard or by running the `ALTER ROLE` command.

#### 2. Middleware: Subdomain Extraction + Cookie + Header

Add tenant resolution to the existing middleware between session refresh and maintenance check. Use the `slug.localhost:3000` pattern for development.

```typescript
// Pseudocode for middleware addition
const slug = extractSubdomain(request)
let tenantId: string | null = null

if (slug) {
  const tenant = await getCachedTenantBySlug(slug)
  if (tenant?.is_active) {
    tenantId = tenant.id
    // Set cookie for persistence across navigations
    sessionResponse.cookies.set('x-tenant-id', tenantId, { httpOnly: true, path: '/' })
    sessionResponse.cookies.set('x-tenant-slug', slug, { httpOnly: true, path: '/' })
  }
} else {
  // No subdomain: use default tenant (littlecafe)
  // Or read from existing cookie
  tenantId = request.cookies.get('x-tenant-id')?.value ?? DEFAULT_TENANT_ID
}
```

#### 3. Supabase Client: Add `createTenantClient(tenantId)`

Add to `src/lib/supabase/server.ts`. It mirrors `createClient()` but adds the `x-tenant-id` global header. The pre-request function in PostgreSQL reads this header and sets the session variable.

#### 4. Caching: Follow Existing `globalThis` Pattern

Use the `globalThis` + `Map` + TTL pattern already established in `siteSettings.edge.ts`. 60-second TTL for tenant lookups.

#### 5. Credentials: Plain Columns for Now

Store Square credentials as plain text columns on the `tenants` table. The table is RLS-protected. Plan for Vault migration in a security hardening phase.

#### 6. Default Tenant Seed

Seed a "Little Cafe" default tenant with `slug = 'littlecafe'` and current business info from `constants/app.ts`. This ensures the existing app continues working without any subdomain.

### Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Pre-request function not configured | Add a check in `createTenantClient()` that verifies `app.tenant_id` was set (query `current_setting` after creation) |
| `request.header.x-tenant-id` not exposed by PostgREST | Test this in Supabase sandbox first. PostgREST exposes all request headers as `request.header.<lowercase-name>` |
| Middleware subdomain parsing fails | Add fallback to cookie-based tenant lookup and default tenant |
| Cache stampede on cold start | Use a simple mutex/promise cache to avoid concurrent DB lookups for the same slug |
| Next.js 16 renames middleware to proxy | Isolated to one file rename + function rename. Codemod available. Not a concern for Phase 10 |

### Files to Create/Modify

**New files:**
- `src/lib/tenant/types.ts` -- Tenant, TenantMembership interfaces
- `src/lib/tenant/cache.ts` -- In-memory tenant cache with TTL
- `src/lib/tenant/context.ts` -- `resolveTenantBySlug()`, `getCurrentTenantId()`

**Modified files:**
- `middleware.ts` -- Add subdomain extraction and tenant cookie setting
- `src/lib/supabase/server.ts` -- Add `createTenantClient(tenantId)`

**Migrations:**
- `create_tenants_table.sql` -- tenants table + set_tenant_from_request() function
- `create_tenant_memberships_table.sql` -- tenant_memberships table
- `seed_default_tenant.sql` -- Insert Little Cafe as default tenant

### Open Questions for Phase 10

1. **Should API routes require tenant context?** If yes, they need to read `x-tenant-id` from the cookie. If no, they continue using `createServiceClient()` unscoped.
2. **Should `localhost:3000` (no subdomain) resolve to the default tenant?** Recommended: yes, with the cookie fallback or a `DEFAULT_TENANT_ID` env var.
3. **Should the pre-request function fail if no tenant_id is set?** For Phase 10, no -- it should be a no-op to avoid breaking existing non-tenant-aware queries. Strict enforcement comes in Phase 2 when RLS policies are rewritten.
4. **How to configure `db-pre-request` in Supabase?** This can be done via Dashboard or SQL: `ALTER ROLE authenticator SET pgrst.db_pre_request = 'set_tenant_from_request'; NOTIFY pgrst, 'reload config';`
