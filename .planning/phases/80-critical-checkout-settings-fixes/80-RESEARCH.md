# Phase 80: Critical Checkout & Settings Fixes - Research

**Researched:** 2026-02-16
**Domain:** Supabase INSERT payloads, PostgreSQL schema migration, multi-tenant RLS
**Confidence:** HIGH

---

## Summary

This phase closes two SC1 blockers identified in the v1.0 milestone audit. Both are surgical fixes with
well-understood scope. The research confirms exact line numbers, missing fields, and migration SQL.

**GAP-1 (checkout):** `process-payment/route.ts` already calls `getCurrentTenantId()` at line 39 and
has `tenantId` in scope for the rest of the handler. The `orders` INSERT at line 178 and `order_items`
map at line 208 simply omit `tenant_id`. The client is `createClient()` (user-scoped, no tenant
context) rather than `createTenantClient(tenantId)`. Three lines of code fix the bug.

**GAP-3 (site_settings):** The table was created with `id integer PRIMARY KEY DEFAULT 1`. Phase 20
added `tenant_id uuid NOT NULL` and a btree index. The service layer in `siteSettings.ts` already
queries and saves by `.eq('tenant_id', tenantId)` — so the read path and update path work. Only the
first-time INSERT for a second tenant fails because PostgreSQL fills `id = 1` by default, hitting the
PK collision. The fix is a schema migration that changes the PK to `uuid DEFAULT gen_random_uuid()`
and adds `UNIQUE(tenant_id)`. No application code changes are needed beyond the migration.

**Primary recommendation:** Fix GAP-1 with three targeted code edits in one file. Fix GAP-3 with one
migration file. No new abstractions needed.

---

## Standard Stack

### What already exists (no new libraries needed)

| Component | Location | Status |
|-----------|----------|--------|
| `createTenantClient(tenantId)` | `src/lib/supabase/server.ts:62` | Exists, calls `set_tenant_context` RPC |
| `createServiceClient()` | `src/lib/supabase/server.ts:41` | Exists, bypasses RLS |
| `getCurrentTenantId()` | `src/lib/tenant/context.ts:44` | Exists, reads `x-tenant-id` cookie |
| `saveSiteSettings()` | `src/lib/services/siteSettings.ts:63` | Exists, update/insert logic in place |

**Installation:** None required. All tools already in the codebase.

---

## Architecture Patterns

### Pattern 1: Tenant-scoped INSERT (the missing pattern in process-payment)

The established pattern in this codebase is to call `getCurrentTenantId()` at the route handler top,
then pass `tenantId` explicitly into INSERT payloads and use `createTenantClient(tenantId)` so RLS
applies.

```typescript
// CORRECT pattern (from src/lib/admin/auth.ts:36-38)
const tenantId = await getCurrentTenantId()
const tenantClient = await createTenantClient(tenantId)
// ...
const { data } = await tenantClient.from('orders').insert([{ tenant_id: tenantId, ... }])
```

```typescript
// CURRENT (broken) pattern in process-payment/route.ts:171-191
const supabase = await createClient()           // <- wrong: no tenant context
// ...
.insert([{
  user_id: user?.id || null,
  square_order_id: orderId,
  // ... tenant_id is MISSING
}])
```

### Pattern 2: site_settings upsert on tenant_id

`siteSettings.ts` already implements update-first then insert-if-not-exists logic. After the migration
adds `UNIQUE(tenant_id)`, the save logic can be simplified to a single upsert:

```typescript
// Post-migration: upsert on tenant_id conflict
await supabase
  .from('site_settings')
  .upsert(insertData, { onConflict: 'tenant_id' })
  .select()
  .single()
```

However, the current two-step update/insert logic also works correctly after the migration because:
- UPDATE by `.eq('tenant_id', tenantId)` finds existing row: works
- If no row exists, INSERT with `tenant_id` explicitly set: works (PK is now UUID, no DEFAULT 1 collision)

Either approach is valid. The upsert is cleaner; the existing two-step is safer (no behavior change).

### Recommended Project Structure (no changes needed)

```
src/
├── app/api/square/process-payment/route.ts   # GAP-1 fix here (3 edits)
├── lib/services/siteSettings.ts              # Optional upsert cleanup
├── types/settings.ts                         # Update SiteSettings.id type
└── supabase/migrations/
    └── YYYYMMDD_fix_site_settings_pk.sql     # GAP-3 migration
```

### Anti-Patterns to Avoid

- **Do not** change the `saveSiteSettings` function signature. `tenantId` is already the first parameter.
- **Do not** switch `siteSettings.ts` from `createServiceClient()` to `createTenantClient()`. The service
  layer intentionally uses service role for this table since it runs in both admin routes and public
  middleware paths (where no auth session exists).
- **Do not** seed a `site_settings` row for every existing tenant in the migration. The application
  already handles missing rows gracefully (returns `DEFAULT_SITE_STATUS`), and rows are created on
  first save.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant-scoped Supabase client | Custom headers/config | `createTenantClient(tenantId)` | Already calls `set_tenant_context` RPC which activates RLS policies |
| UUID PK generation | Custom ID logic | `gen_random_uuid()` PostgreSQL built-in | Already used on all other tables in initial schema |
| Upsert on unique constraint | Manual select+insert/update | `supabase.upsert(..., { onConflict: 'tenant_id' })` | Postgrest built-in, race-condition safe |

**Key insight:** Both bugs are missing 3-5 lines of code, not missing functionality. The entire
infrastructure (tenant clients, RPC functions, RLS policies) already exists and works correctly.

---

## Common Pitfalls

### Pitfall 1: createClient vs createTenantClient for order INSERT

**What goes wrong:** Using `createClient()` for the orders INSERT means the Supabase client does not
call `set_tenant_context`, so `app.tenant_id` is not set in the DB session. Even after adding
`tenant_id: tenantId` to the INSERT payload, RLS policies that check
`tenant_id = current_setting('app.tenant_id')::uuid` will not match for an authenticated user (the
user's session cookie is present, but no tenant context is set).

**Why it happens:** The route uses `createClient()` to get the authenticated user (correct for auth
checks), then reuses the same client for the INSERT (wrong — this client has no tenant context).

**How to avoid:** Create a second client for data operations:
```typescript
const supabase = await createClient()          // for auth only
const { data: { user } } = await supabase.auth.getUser()

const tenantSupabase = await createTenantClient(tenantId)   // for data inserts
const { data: orderData } = await tenantSupabase
  .from('orders')
  .insert([{ tenant_id: tenantId, ... }])
```

**Warning signs:** If the orders RLS policy `tenant_customer_insert_orders` requires
`tenant_id = current_setting('app.tenant_id')::uuid`, then using `createClient()` without
`set_tenant_context` will cause INSERT failures when RLS is enforced.

**Alternative simpler approach:** Keep `createClient()` for both auth and INSERT, but add
`tenant_id: tenantId` to the INSERT payload and call `client.rpc('set_tenant_context', { p_tenant_id: tenantId })` after auth. This avoids creating a second client.

**Recommended:** Use the cleanest approach — create `tenantSupabase` after getting the user, use it
for all data operations.

### Pitfall 2: site_settings migration ordering

**What goes wrong:** If the migration tries to DROP the PK before removing dependencies, it will fail.
The `id DEFAULT 1` PK has no foreign keys referencing it (verified: no other table has an FK to
`site_settings.id`), so the DROP is clean.

**How to avoid:** Migration order:
1. Add UUID column with `gen_random_uuid()` default
2. Populate existing rows with UUIDs
3. Drop old PK constraint
4. Set new UUID column as PK
5. Add `UNIQUE(tenant_id)` constraint

**Or simpler** (if no dependent objects): Use `ALTER TABLE ... ALTER COLUMN id TYPE uuid USING gen_random_uuid()` but this is blocked if the column is the PK. The safest path is:

```sql
-- Rename old PK column, add new UUID PK
ALTER TABLE public.site_settings RENAME COLUMN id TO id_legacy;
ALTER TABLE public.site_settings ADD COLUMN id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.site_settings DROP CONSTRAINT site_settings_pkey;
ALTER TABLE public.site_settings ADD PRIMARY KEY (id);
ALTER TABLE public.site_settings DROP COLUMN id_legacy;
ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_tenant_id_unique UNIQUE (tenant_id);
```

**Warning signs:** Migration fails with "column id is referenced by existing constraints" — check for
any constraint that references the PK by name.

### Pitfall 3: TypeScript type for SiteSettings.id must be updated

**What goes wrong:** `src/types/settings.ts` declares `id: number`. After the migration changes the
PK to `uuid`, TypeScript will still typecheck `id` as `number`. Code that does `settings.id` will
compile but behave incorrectly.

**How to avoid:** Update `SiteSettings` interface in `src/types/settings.ts`:
```typescript
// Before
export interface SiteSettings {
  id: number
  // ...
}

// After
export interface SiteSettings {
  id: string   // uuid
  // ...
}
```

**Affected files:** Only `src/types/settings.ts`. The `id` field is not referenced in any other
file — no code uses `settings.id` directly (confirmed by grep).

### Pitfall 4: The DEFAULT 1 column still has a DEFAULT after migration

**What goes wrong:** After renaming and dropping `id_legacy`, if the migration adds the new UUID
column without removing the old DEFAULT, some code paths might still try to use the old default.

**How to avoid:** After migration is applied, verify in Supabase dashboard or via `\d site_settings`
that:
- `id` is `uuid NOT NULL DEFAULT gen_random_uuid()`
- Old integer PK is gone
- `UNIQUE(tenant_id)` constraint exists

---

## Code Examples

### GAP-1: process-payment fix (exact edits)

**File:** `src/app/api/square/process-payment/route.ts`

```typescript
// EDIT 1: Line 171 — replace createClient() with createTenantClient(tenantId)
// Before:
const supabase = await createClient()

// After:
const supabase = await createClient()              // keep for auth only
const tenantSupabase = await createTenantClient(tenantId)
```

```typescript
// EDIT 2: Line 178-192 — add tenant_id to orders INSERT, use tenantSupabase
// Before:
const { data: orderData, error: orderError } = await supabase
  .from('orders')
  .insert([
    {
      user_id: user?.id || null,
      square_order_id: orderId,
      customer_email: customerInfo.email,
      customer_phone: customerInfo.phone || null,
      total_amount: Math.round(squareOrderTotal * 100),
      tax_amount: Math.round(squareOrderTax * 100),
      status: 'pending',
      payment_status: paymentResult.status.toLowerCase()
    }
  ])
  .select('id')
  .single()

// After:
const { data: orderData, error: orderError } = await tenantSupabase
  .from('orders')
  .insert([
    {
      tenant_id: tenantId,                          // <- ADD THIS
      user_id: user?.id || null,
      square_order_id: orderId,
      customer_email: customerInfo.email,
      customer_phone: customerInfo.phone || null,
      total_amount: Math.round(squareOrderTotal * 100),
      tax_amount: Math.round(squareOrderTax * 100),
      status: 'pending',
      payment_status: paymentResult.status.toLowerCase()
    }
  ])
  .select('id')
  .single()
```

```typescript
// EDIT 3: Line 208-217 — add tenant_id to order_items map, use tenantSupabase
// Before:
const orderItems = cartItems.map(item => ({
  order_id: orderData.id,
  square_item_id: item.id,
  item_name: item.name,
  quantity: item.quantity,
  unit_price: Math.round(item.price * 100),
  total_price: Math.round(item.price * item.quantity * 100),
  variations: item.variationId ? { variationId: item.variationId, variationName: item.variationName } : {},
  modifiers: {}
}))

const { error: itemsError } = await supabase
  .from('order_items')
  .insert(orderItems)

// After:
const orderItems = cartItems.map(item => ({
  tenant_id: tenantId,                              // <- ADD THIS
  order_id: orderData.id,
  square_item_id: item.id,
  item_name: item.name,
  quantity: item.quantity,
  unit_price: Math.round(item.price * 100),
  total_price: Math.round(item.price * item.quantity * 100),
  variations: item.variationId ? { variationId: item.variationId, variationName: item.variationName } : {},
  modifiers: {}
}))

const { error: itemsError } = await tenantSupabase  // <- CHANGE supabase TO tenantSupabase
  .from('order_items')
  .insert(orderItems)
```

**Import addition required** at top of file:
```typescript
import { createClient, createTenantClient } from '@/lib/supabase/server'
// (currently only imports createClient)
```

### GAP-3: site_settings migration SQL

```sql
-- Migration: Fix site_settings PK from integer DEFAULT 1 to UUID
-- Resolves GAP-3: second tenant can't insert site_settings (PK collision)

BEGIN;

-- Step 1: Add a temporary UUID column to hold new IDs
ALTER TABLE public.site_settings
  ADD COLUMN id_new uuid DEFAULT gen_random_uuid() NOT NULL;

-- Step 2: Drop old PK constraint
ALTER TABLE public.site_settings
  DROP CONSTRAINT site_settings_pkey;

-- Step 3: Drop old integer id column
ALTER TABLE public.site_settings
  DROP COLUMN id;

-- Step 4: Rename new column to id
ALTER TABLE public.site_settings
  RENAME COLUMN id_new TO id;

-- Step 5: Set new PK
ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);

-- Step 6: Add UNIQUE constraint on tenant_id (one row per tenant)
ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_tenant_id_unique UNIQUE (tenant_id);

COMMIT;
```

### GAP-3: TypeScript type update

```typescript
// src/types/settings.ts
export interface SiteSettings {
  id: string    // was: number — changed to string (uuid)
  tenant_id: string   // add this field (already exists in DB after Phase 20)
  is_customer_app_live: boolean
  maintenance_title: string | null
  maintenance_message: string | null
  maintenance_cta_label: string | null
  maintenance_cta_href: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `createClient()` for all DB ops | `createTenantClient(tenantId)` for data ops | Phase 10 | RLS policies apply; tenant isolation enforced |
| PK `id integer DEFAULT 1` | `id uuid DEFAULT gen_random_uuid()` | Phase 80 (this phase) | Allows one row per tenant |
| Single-row global settings | Per-tenant rows with `UNIQUE(tenant_id)` | Phase 80 (this phase) | True multi-tenant settings isolation |

**Deprecated/outdated:**
- `createClient()` for INSERT operations on tenant-scoped tables: use `createTenantClient()` instead
- `id integer PRIMARY KEY DEFAULT 1` pattern: not compatible with multi-tenant; use UUID PK everywhere

---

## Open Questions

1. **RLS policy behavior during anonymous checkout**
   - What we know: Process-payment runs as an authenticated user context if the customer is logged in, or
     as an anonymous user if not. `createTenantClient()` sets `app.tenant_id` via RPC. The orders table
     has an RLS policy `tenant_customer_insert_orders` (from the Phase 30 policy rewrite).
   - What's unclear: Whether anonymous users (no auth session) can still insert orders after switching
     to `createTenantClient()`, since that client uses the publishable key (same as `createClient()`).
   - Recommendation: The RPC `set_tenant_context` is available to anon role if it's `SECURITY DEFINER`.
     Verify the RLS INSERT policy for orders permits anon inserts with matching tenant context, or keep
     `createClient()` for anon INSERT and explicitly pass `tenant_id` in the payload (relying on the
     DEFAULT clause being overridden by the explicit value). The safest approach: explicit `tenant_id`
     in the payload is sufficient for data correctness regardless of which client is used; switching
     to `createTenantClient` also enforces RLS isolation.

2. **Existing site_settings row in the default tenant**
   - What we know: The initial migration seeded `id = 1` for the default tenant. The Phase 20
     migration added `tenant_id = '00000000-0000-0000-0000-000000000001'` to existing rows.
   - What's unclear: Whether the rename-drop-rename approach preserves that single existing row's data.
   - Recommendation: The migration steps operate on columns, not rows. All existing data is preserved.
     The existing row gets a new random UUID as its `id`, which is fine since no code queries by `id`.

---

## Files That Need Modification

### GAP-1 Changes

| File | Type | Change |
|------|------|--------|
| `src/app/api/square/process-payment/route.ts` | Code | Add `createTenantClient` import; create `tenantSupabase`; add `tenant_id` to orders/order_items inserts; use `tenantSupabase` for data writes |

### GAP-3 Changes

| File | Type | Change |
|------|------|--------|
| `supabase/migrations/YYYYMMDDHHMMSS_fix_site_settings_pk.sql` | New migration | Drop integer PK, add UUID PK, add UNIQUE(tenant_id) |
| `src/types/settings.ts` | Code | Change `id: number` to `id: string`; add `tenant_id: string` field |

### No Changes Needed

| File | Why Not |
|------|---------|
| `src/lib/services/siteSettings.ts` | Already queries/saves by `tenant_id`; update/insert logic works after migration |
| `src/app/api/admin/settings/site/route.ts` | Delegates to `siteSettings.ts`; no direct schema assumptions |
| `src/lib/services/siteSettings.edge.ts` | Cache keyed by `tenantId`; no schema dependency |
| `src/lib/services/siteSettings.shared.ts` | Pure function; no schema dependency |
| `src/components/admin/SiteAvailabilitySettings.tsx` | UI only; no schema dependency |

---

## Sources

### Primary (HIGH confidence)

- Direct code read: `src/app/api/square/process-payment/route.ts` — confirmed missing `tenant_id` in INSERT payloads at lines 178 and 208-217; confirmed `createClient()` usage at line 171
- Direct code read: `supabase/migrations/20250829090000_create_site_settings_table.sql` — confirmed `id integer PRIMARY KEY DEFAULT 1` at line 3
- Direct code read: `supabase/migrations/20260213200000_add_tenant_id_columns.sql` — confirmed `tenant_id uuid DEFAULT '00000000-...'` added to `site_settings` at line 14
- Direct code read: `supabase/migrations/20260213200001_add_tenant_id_constraints.sql` — confirmed `NOT NULL` and FK constraint on `site_settings.tenant_id`
- Direct code read: `supabase/migrations/20260213300000_rls_policy_rewrite.sql` — confirmed RLS policies require `tenant_id = current_setting('app.tenant_id')::uuid`
- Direct code read: `src/lib/supabase/server.ts` — confirmed `createTenantClient()` calls `set_tenant_context` RPC at line 89
- Direct code read: `src/lib/services/siteSettings.ts` — confirmed update/insert logic already uses `.eq('tenant_id', tenantId)` correctly
- Direct code read: `src/types/settings.ts` — confirmed `id: number` type that needs updating
- Direct read: `.planning/v1.0-MILESTONE-AUDIT.md` — audit findings confirmed and verified against actual code

### Secondary (MEDIUM confidence)

- None required — all findings are from direct code inspection

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**
- GAP-1 scope: HIGH — exact lines identified, fix is 3 targeted edits
- GAP-3 scope: HIGH — exact migration SQL designed, no foreign key dependencies to worry about
- RLS behavior with anon users after client switch: MEDIUM — needs verification during implementation
- No-code-change claim for siteSettings.ts: HIGH — confirmed the update/insert logic already handles the case correctly

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (stable codebase; migration files don't change)
