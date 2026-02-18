# Phase 95: Admin Auth Hardening & Orders Isolation - Research

**Researched:** 2026-02-18
**Domain:** Next.js API route auth migration + Supabase tenant-scoped queries
**Confidence:** HIGH

---

## Summary

Phase 95 closes three tech debt findings from the v1.0 milestone audit (file: `.planning/v1.0-MILESTONE-AUDIT.md`). All findings are in files that were written before Phase 50 introduced `requireAdminAuth()` and `tenant_memberships`-based auth.

The work splits into two concern areas:

1. **Query scope fixes** on `admin/orders/route.ts`: the PATCH handler's UPDATE is missing `.eq('tenant_id', tenantId)`, and the GET handler's count query is also missing the tenant filter. These are straightforward one-line additions.

2. **Auth pattern migration** on 6 route handlers: replace `profiles.role === 'admin'` (or email-based `validateAdminAccess`) with `requireAdminAuth()` from `src/lib/admin/middleware.ts`. The middleware already handles rate limiting, CSRF, and `tenant_memberships` lookup — the routes just need to call it and check the result.

The migration pattern is already well-established. Multiple routes (`customers/route.ts`, `suppliers/route.ts`, `invoices/route.ts`, `cogs/products/route.ts`) show the exact before/after pattern. Two style variants exist; both are acceptable.

**Primary recommendation:** Migrate auth first, then add tenant filters — this order ensures the auth guard is tightened before touching data logic.

---

## Current State of Each File

### File 1: `src/app/api/admin/orders/route.ts`

**Auth pattern:** Inline `profiles.role` check (pre-Phase-50 style)

```typescript
// Lines 14-32 (GET handler) — duplicated in PATCH handler (lines 149-166)
const authClient = await createClient()
const { data: { user }, error: authError } = await authClient.auth.getUser()
if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

const { data: profile, error: profileError } = await authClient
  .from('profiles')
  .select('role')
  .eq('id', user.id)
  .single()

if (profileError || profile?.role !== 'admin') {
  return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
}
```

**Tenant ID acquisition:** Manual cookie read

```typescript
// Line 46-47
const cookieStore = await cookies()
const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'
```

**GET data query:** Correctly scoped — `.eq('tenant_id', tenantId)` present on the orders SELECT (line 56).

**GET count query (BUG):** Missing tenant filter — lines 106-124. The count query has no `.eq('tenant_id', tenantId)`, so pagination totals include all tenants' orders.

```typescript
// Current (broken)
let countQuery = supabase
  .from('orders')
  .select('*', { count: 'exact', head: true })
// No .eq('tenant_id', tenantId) applied
```

**PATCH UPDATE query (BUG):** Missing tenant filter — line 189-197. The update only filters by `orderId`, not `tenant_id`. A cross-tenant write is possible.

```typescript
// Current (broken)
const { data: updatedOrder, error: updateError } = await supabase
  .from('orders')
  .update(updates)
  .eq('id', orderId)    // <-- no tenant_id guard
  .select(...)
  .single()
```

The PATCH handler also uses `createServiceClient()` (bypasses RLS), making the missing filter a real exploitable gap.

---

### File 2: `src/app/api/admin/dashboard/stats/route.ts`

**Auth pattern:** Inline `profiles.role` check (same pre-Phase-50 style as orders).

**Data queries:** All correctly scoped. The route reads `x-tenant-id` cookie and applies `.eq('tenant_id', tenantId)` to `orders` queries (lines 45, 67). The `profiles` count query (line 54-57) does not filter by tenant — but `profiles` is a global user table, so a global count of customers is likely acceptable behavior (not a security issue).

**Change needed:** Auth replacement only. No data query changes needed.

---

### File 3: `src/app/api/admin/inventory/bulk-upload/route.ts`

**Auth pattern:** Custom `validateAdminAccess(adminEmail)` function (lines 35-48). Takes `adminEmail` from the POST body — this is the oldest and weakest pattern. Anyone who knows an admin email can craft a request.

```typescript
// Body: { adminEmail: string, items: [...] }
await validateAdminAccess(body.adminEmail)
```

The `validateAdminAccess` function queries `profiles.role === 'admin'` using a raw `createClient()` from `@supabase/supabase-js` (not the app's shared client).

**Data queries:** No tenant filtering on `inventory_items` INSERT (line 148). Items are inserted without `tenant_id`. This is a secondary issue — the table likely has a tenant_id column but this route pre-dates multi-tenant schema.

**Note:** This route uses a direct `createClient()` from `@supabase/supabase-js` at the top of the file (not from `@/lib/supabase/server`). The migration needs to update imports too.

**Change needed:** Replace email-based auth with `requireAdminAuth(request)`. The `adminEmail` body field requirement can be removed.

---

### File 4: `src/app/api/admin/inventory/push-to-square/route.ts`

**Auth pattern:** Same `validateAdminAccess(supabase, adminEmail)` pattern from POST body (line 31-43, called at line 234). Uses `profiles.role` check.

**Data queries:** Already tenant-scoped. `getInventoryItemsToPush` filters with `.eq('tenant_id', tenantId)` (line 58). `stock_movements` insert includes `tenant_id: tenantId` (line 177). `getCurrentTenantId()` is already called at the handler level (line 224).

**Change needed:** Replace `validateAdminAccess` call + remove `adminEmail` body requirement. Keep `getCurrentTenantId()` call where it already is. The `supabase` parameter to `validateAdminAccess` can be dropped once the function is replaced.

---

### File 5: `src/app/api/admin/inventory/hybrid-sync/route.ts`

**Auth pattern:** Same `validateAdminAccess(adminEmail)` pattern (lines 77-90, called at line 320). Uses a local `getSupabaseClient()` that builds a direct `createClient()` from env vars — not the shared app client.

**Data queries:** No tenant filtering on the enrichment data queries (lines 154-175: `inventory_items` SELECT, `suppliers` SELECT). These are missing tenant scope.

**Note:** `hybrid-sync` also calls `sync-square` internally via `fetch()` (line 114), passing `adminEmail` in the body. After migration, this internal call will fail because `sync-square` will require HTTP auth headers, not just `adminEmail`. This is a dependency to handle — see Pitfalls section.

**Change needed:** Replace auth pattern. Add tenant filtering to internal data queries (suppliers, inventory_items). Remove `adminEmail` from body.

---

### File 6: `src/app/api/admin/inventory/sync-square/route.ts`

**Auth pattern:** Same `validateAdminAccess(supabase, adminEmail)` pattern (lines 60-72, called at line 439). Uses `profiles.role` check.

**Data queries:** Correctly scoped. `getExistingInventoryItems` filters with `.eq('tenant_id', tenantId)` (line 120). `syncInventoryItems` inserts with `tenant_id: tenantId` (line 380). `getCurrentTenantId()` already called at handler level (line 429).

**Change needed:** Replace `validateAdminAccess` call + remove `adminEmail` body requirement. Keep existing `getCurrentTenantId()` usage.

---

## What `requireAdminAuth()` Returns

**File:** `src/lib/admin/middleware.ts`

```typescript
export interface AdminAuthSuccess {
  user: User
  membership: { role: string }
  userId: string
  tenantId: string       // <-- tenantId already resolved here
  sessionInfo: {
    age: number
    ip: string
  }
}

export type AdminAuthResult = Response | AdminAuthSuccess
```

**How it works:**
1. Applies rate limiting (`rateLimiters.admin`)
2. Checks CSRF (origin/referer validation)
3. Gets user via `supabase.auth.getUser()`
4. Calls `getCurrentTenantId()` internally
5. Checks `tenant_memberships` for `owner` or `admin` role at that tenantId
6. Returns `AdminAuthSuccess` on pass, `Response` (NextResponse error) on fail

**Important:** `requireAdminAuth()` already calls `getCurrentTenantId()` and returns it in `authResult.tenantId`. Routes can use `authResult.tenantId` directly instead of calling `getCurrentTenantId()` again — but using `getCurrentTenantId()` redundantly is harmless (it reads the same cookie).

**Type guard:** `isAdminAuthSuccess(result)` returns `true` if the result is `AdminAuthSuccess` (checks for `'userId' in result`). Alternatively, check `result instanceof NextResponse` or `authResult instanceof Response`.

---

## Migration Pattern (from recently migrated routes)

Two style variants exist in the codebase. Both are correct.

### Variant A — `isAdminAuthSuccess` guard (preferred, cleaner)

```typescript
// Source: src/app/api/admin/customers/route.ts
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()
    // OR: const { tenantId } = authResult  (already resolved by requireAdminAuth)

    // ... data queries with .eq('tenant_id', tenantId)
  } catch (error) { ... }
}
```

### Variant B — `instanceof NextResponse` check (older style, still valid)

```typescript
// Source: src/app/api/admin/suppliers/route.ts
import { requireAdminAuth } from '@/lib/admin/middleware'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }
    // authResult is AdminAuthSuccess here
    // ...
  }
}
```

**Recommendation:** Use Variant A (`isAdminAuthSuccess`) for consistency with the most recently migrated routes (`customers`, `cogs/products`, `invoices`).

---

## Exact Changes Needed Per File

### Change 1: `src/app/api/admin/orders/route.ts`

**Auth (both GET and PATCH):** Replace the 15-line inline auth block with 3 lines.

Remove:
```typescript
const authClient = await createClient()
const { data: { user }, error: authError } = await authClient.auth.getUser()
if (authError || !user) {
  return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
}
const { data: profile, error: profileError } = await authClient
  .from('profiles')
  .select('role')
  .eq('id', user.id)
  .single()
if (profileError || profile?.role !== 'admin') {
  return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
}
```

Add:
```typescript
const authResult = await requireAdminAuth(request)
if (!isAdminAuthSuccess(authResult)) return authResult
```

**GET handler — count query fix (line 106):** Add tenant filter immediately after the initial `select`.

```typescript
// Before
let countQuery = supabase
  .from('orders')
  .select('*', { count: 'exact', head: true })

// After
let countQuery = supabase
  .from('orders')
  .select('*', { count: 'exact', head: true })
  .eq('tenant_id', tenantId)
```

**PATCH handler — UPDATE query fix (line 189):** Add tenant filter to the update chain.

```typescript
// Before
const { data: updatedOrder, error: updateError } = await supabase
  .from('orders')
  .update(updates)
  .eq('id', orderId)
  .select(...)
  .single()

// After
const { data: updatedOrder, error: updateError } = await supabase
  .from('orders')
  .update(updates)
  .eq('id', orderId)
  .eq('tenant_id', tenantId)
  .select(...)
  .single()
```

**Import changes:** Add `requireAdminAuth, isAdminAuthSuccess` to imports. The `createClient` import from `@/lib/supabase/server` can be removed (only the `createServiceClient` import is needed now). The `cookies` import from `next/headers` should be kept because `tenantId` is still read from the cookie.

---

### Change 2: `src/app/api/admin/dashboard/stats/route.ts`

Auth replacement only. No data query changes needed.

Remove: 15-line inline auth block (lines 8-26)
Add: 2-line `requireAdminAuth` guard

Keep: `const cookieStore = await cookies()` / `tenantId` cookie read — still needed for data queries.

Import changes: Add `requireAdminAuth, isAdminAuthSuccess`. Remove `createClient` (already not used after auth block removal).

---

### Change 3: `src/app/api/admin/inventory/bulk-upload/route.ts`

**This is the most complex migration.** The route uses a raw `@supabase/supabase-js` client, a custom `validateAdminAccess(adminEmail)` function, and takes `adminEmail` from the POST body.

**Import changes:**
- Remove `import { createClient } from '@supabase/supabase-js'`
- Add `import { NextRequest } from 'next/server'` to the existing NextRequest import (already there)
- Add `import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'`
- The `getSupabaseClient()` local function can be removed — replace its usage with `createServiceClient()` from `@/lib/supabase/server`

**Body change:** Remove `adminEmail` requirement from `BulkUploadRequest` type and the early return at line 198-202.

**Handler change:** Add auth guard at the top of `POST`. Replace `validateAdminAccess(body.adminEmail)` call with the 3-line guard.

**Data query change:** The `validateInventoryItems` function queries `inventory_items` without tenant filter (line 57-61). After migration, this is acceptable for validation purposes (it's just checking for duplicate `square_item_id` across the system). However, ideally it should also be scoped to the tenant. Consider passing `tenantId` to `validateInventoryItems` and adding `.eq('tenant_id', tenantId)` to the duplicate check query.

The `insertInventoryItems` function at line 128-156 also does not stamp `tenant_id` on inserts. This needs `tenant_id` added to the `dbItems` map.

---

### Change 4: `src/app/api/admin/inventory/push-to-square/route.ts`

Remove: `validateAdminAccess(supabase, adminEmail)` function (lines 31-43) and call (line 234)
Remove: `adminEmail` from `PushToSquareRequest` interface (line 12) and body check (lines 212-217)

Add: `requireAdminAuth` guard at top of `POST` handler (before `tenantId` resolution)

Import changes: Add `requireAdminAuth, isAdminAuthSuccess` to imports from `@/lib/admin/middleware`.

Note: `getCurrentTenantId()` is already imported and used correctly. Keep it.

---

### Change 5: `src/app/api/admin/inventory/hybrid-sync/route.ts`

Same as bulk-upload — uses local `getSupabaseClient()` with raw `@supabase/supabase-js`.

Remove: `validateAdminAccess(adminEmail)` function and call. Remove `getSupabaseClient()` and replace usages with `createServiceClient()`.

Remove: `adminEmail` from `HybridSyncRequest` interface and body check.

Add: `requireAdminAuth` guard at top of `POST` handler. Add `getCurrentTenantId()` call to get `tenantId` (currently not resolved in this handler — the `getInventoryStats` and `runEnrichmentSync` functions use unscoped queries).

Add tenant filtering: `getInventoryStats()` (line 94) and `runEnrichmentSync` (lines 154-175) query `inventory_items` and `suppliers` without tenant filter. Add tenantId parameter and `.eq('tenant_id', tenantId)` to these queries.

**Dependency issue:** `runSquareSync` (line 111-142) makes an internal HTTP fetch to `sync-square`. After migration of `sync-square`, it will require proper HTTP headers (origin, auth cookies). The `body.adminEmail` field passed in this call will no longer be validated. Since this is an internal server-to-server call without a browser session, it won't have the auth cookies that `requireAdminAuth` needs. See Pitfalls section.

---

### Change 6: `src/app/api/admin/inventory/sync-square/route.ts`

Remove: `validateAdminAccess(supabase, adminEmail)` function and call (lines 60-72, line 439)
Remove: `adminEmail` from `SquareSyncRequest` interface and body check (lines 419-423)

Add: `requireAdminAuth` guard at top of `POST` handler

Import changes: Add `requireAdminAuth, isAdminAuthSuccess` from `@/lib/admin/middleware`.

Note: `getCurrentTenantId()` already imported and used correctly. Keep it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant ID resolution | Cookie parsing + fallback logic | `getCurrentTenantId()` from `@/lib/tenant/context` | Already handles middleware cookie, consistent fallback |
| Admin role check | `profiles.role === 'admin'` query | `requireAdminAuth()` from `@/lib/admin/middleware` | Includes rate limiting, CSRF, tenant_memberships check |
| Supabase service client | `createClient()` from `@supabase/supabase-js` | `createServiceClient()` from `@/lib/supabase/server` | Shared instance, consistent env var handling |

---

## Common Pitfalls

### Pitfall 1: hybrid-sync Calls sync-square Internally via fetch()

**What goes wrong:** `hybrid-sync` calls `sync-square` by making an HTTP POST to `${process.env.NEXT_PUBLIC_SITE_URL}/api/admin/inventory/sync-square` with `adminEmail` in the body. After both routes are migrated to `requireAdminAuth()`, this internal call will fail with a 403 — the internal fetch has no auth cookies and no valid origin that would pass CSRF.

**Why it happens:** The internal call was designed around the email-based auth pattern. It passes `adminEmail` as the credential, which worked before.

**How to avoid:** Two options:
1. **Recommended:** Refactor `runSquareSync()` to call the catalog sync logic directly (import and call the sync functions) instead of making an HTTP call. This avoids the CSRF/auth issue entirely.
2. **Simpler but messier:** Skip `sync-square` auth migration for now and keep it with a separate auth check, or add a service-role bypass path for internal calls.

**Recommendation:** Option 1. Extract `sync-square` logic into a shared function in a library file and call it directly from `hybrid-sync`.

### Pitfall 2: bulk-upload Missing tenant_id on INSERT

**What goes wrong:** After auth migration, `insertInventoryItems()` still inserts without `tenant_id`. Data will fail RLS constraints or land in the wrong tenant if the table has a NOT NULL constraint on `tenant_id`.

**How to avoid:** Pass `tenantId` from the handler down to `insertInventoryItems()` and add it to each inserted row:

```typescript
const dbItems = items.map(item => ({
  ...item,
  tenant_id: tenantId,  // add this
  // ...other fields
}))
```

### Pitfall 3: PATCH returns null order if tenant_id doesn't match

**What goes wrong:** After adding `.eq('tenant_id', tenantId)` to the PATCH UPDATE, if the provided `orderId` exists but belongs to a different tenant, the update returns no rows (not an error). The response would return `null` for `updatedOrder`, and the existing null check logic would return 500 ("Failed to update order").

**How to handle:** The current error handling at line 212-215 returns 500. Consider changing to a 404 response instead: "Order not found" (which is accurate and more appropriate than 500 when the order is simply not in this tenant's scope).

### Pitfall 4: `createClient` import cleanup in orders route

**What goes wrong:** After removing the auth block, `createClient` from `@/lib/supabase/server` is no longer used. ESLint will flag the unused import.

**How to avoid:** Remove the `createClient` import when migrating the auth block.

### Pitfall 5: `cookies` import still needed in stats and orders

**What goes wrong:** After removing the inline auth block, you might think `cookies` from `next/headers` is no longer needed. But the data handlers still use `const cookieStore = await cookies()` to read `tenantId`. Don't remove it.

**Alternative:** The routes could use `authResult.tenantId` (returned by `requireAdminAuth`) instead of the separate cookie read, eliminating the `cookies` import and the `cookieStore` code. This is cleaner and slightly more efficient.

---

## Architecture Notes

### requireAdminAuth already resolves tenantId

`requireAdminAuth()` calls `getCurrentTenantId()` internally (see middleware.ts line 82-83) and returns `tenantId` in `authResult.tenantId`. Routes can therefore replace:

```typescript
const cookieStore = await cookies()
const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'
```

With:

```typescript
const { tenantId } = authResult
```

This is cleaner. However, it means rearranging code so the auth result is used where previously cookies were used directly. Both approaches work.

### The GET handler for orders has a dual concern

The GET handler fetches orders AND profiles data. The profiles fetch (lines 91-103) uses the service client and queries `profiles.in('id', userIds)` with no tenant filter — but this is correct behavior. Profiles are global user records; fetching by IDs of order owners is fine.

### dashboard/stats has unscoped profiles count

The stats route counts `profiles` with `.eq('role', 'customer')` (line 54-57) without a tenant filter. This is a pre-existing data model issue — the `profiles` table may not have a meaningful `tenant_id` (users may belong to multiple tenants). This is not a Phase 95 concern — don't change it.

---

## Code Examples

### Canonical migration pattern (Variant A)

```typescript
// Source: src/app/api/admin/customers/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()
    // OR: const { tenantId } = authResult

    const { data, error } = await supabase
      .from('some_table')
      .select('*')
      .eq('tenant_id', tenantId)

    if (error) return NextResponse.json({ error: 'Failed' }, { status: 500 })
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

### Tenant-scoped UPDATE pattern

```typescript
// Adding tenant_id to an UPDATE query to prevent cross-tenant writes
const { data: updatedOrder, error: updateError } = await supabase
  .from('orders')
  .update(updates)
  .eq('id', orderId)
  .eq('tenant_id', tenantId)   // <-- prevents cross-tenant modification
  .select(...)
  .single()
```

---

## State of the Art

| Old Approach | Current Approach | Changed | Impact |
|--------------|------------------|---------|--------|
| `profiles.role === 'admin'` | `requireAdminAuth()` → `tenant_memberships` | Phase 50 | Auth is now tenant-scoped, not global |
| `createClient()` from `@supabase/supabase-js` | `createServiceClient()` from `@/lib/supabase/server` | Phase 10 | Shared client, consistent config |
| `adminEmail` in POST body | HTTP session cookies + `requireAdminAuth` | Phase 50 | Proper HTTP auth, no cleartext credentials in body |

---

## Open Questions

1. **hybrid-sync internal fetch dependency**
   - What we know: `runSquareSync()` calls sync-square via HTTP with `adminEmail` in body
   - What's unclear: Whether this internal call is actively used in production or just an artifact
   - Recommendation: Refactor to direct function call. If that's too complex for Phase 95, keep hybrid-sync's auth migration minimal — add `requireAdminAuth` for the outer handler but leave the internal call pattern, since sync-square's auth is now the gating check.

2. **bulk-upload tenant_id on INSERT**
   - What we know: Current code inserts `inventory_items` without `tenant_id`
   - What's unclear: Whether the `inventory_items` table has a NOT NULL constraint on `tenant_id`
   - Recommendation: Check schema. If NOT NULL, this is a breaking bug that must be fixed in this phase. If nullable, it's a data hygiene issue — still fix it, but not blocking.

---

## Sources

### Primary (HIGH confidence)

- Direct codebase reading of all 6 route files
- `src/lib/admin/middleware.ts` — `requireAdminAuth()` signature and return type confirmed
- `src/lib/admin/auth.ts` — `requireAdmin()` for comparison (page-level auth, not API route auth)
- `src/app/api/admin/customers/route.ts` — canonical migration pattern (Variant A)
- `src/app/api/admin/suppliers/route.ts` — canonical migration pattern (Variant B)
- `src/app/api/admin/cogs/products/route.ts` — canonical migration pattern (Variant A)
- `.planning/v1.0-MILESTONE-AUDIT.md` — findings documented by automated audit

### Secondary (MEDIUM confidence)

- CLAUDE.md API CLAUDE.md documentation (notes the old pattern and the new `requireAdminAuth` middleware)

---

## Metadata

**Confidence breakdown:**

- Current file state: HIGH — files read directly
- requireAdminAuth() behavior: HIGH — middleware read directly, return type verified
- Migration pattern: HIGH — multiple post-Phase-50 routes confirm the pattern
- hybrid-sync internal call risk: HIGH — code traced directly
- tenant_id on bulk-upload INSERT: MEDIUM — depends on schema constraint not read yet

**Research date:** 2026-02-18
**Valid until:** Stable — this is internal codebase analysis, not external library
