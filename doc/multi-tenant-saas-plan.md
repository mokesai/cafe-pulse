# Plan: Multi-Tenant SaaS Architecture for Cafe Platform

## Context

The Cafe Pulse app (formerly cafe-web) is currently single-tenant, built for "Little Cafe" at Kaiser Permanente. The goal is to transform it into a SaaS platform where multiple cafe operators can sign up, each getting their own isolated instance accessible via subdomain (e.g., `littlecafe.platform.com`, `bobscafe.platform.com`). Customers are isolated per tenant — no shared accounts across cafes.

## Current State

- **Single Supabase project** (`etihvnzzmtxsnbifftfh`) with no tenant concept
- **27+ tables** with no `tenant_id` column
- **RLS policies** filter by `auth.uid()` only — no tenant scoping
- **Square credentials** are global env vars (single location)
- **Business identity** hardcoded in `src/lib/constants/app.ts` (`BUSINESS_INFO`, `APP_NAME = 'Little Cafe'`)
- **Email** hardcoded sender: `orders@jmcpastrycoffee.com`
- **Auth** checks `profiles.role === 'admin'` with no tenant membership concept

## Recommended Approach: Shared Database + Tenant Column

Use a single Supabase database with a `tenant_id` UUID column on every table, enforced via RLS policies using PostgreSQL session variables. This is the right fit because:

- **One database, one deployment, one migration pipeline** — operationally simple for SaaS
- **Cost-effective** — no extra Supabase projects ($25/mo each)
- **Incremental migration** — existing app continues working throughout via a "default tenant"
- **RLS + session variables** provide defense-in-depth isolation

### How It Works

```
Request → Middleware (extract subdomain → lookup tenant → set cookie)
       → Supabase Client (SET app.tenant_id = 'uuid' on connection)
       → RLS Policies (every policy includes: tenant_id = current_setting('app.tenant_id'))
       → Square Client (credentials loaded from tenants table per request)
```

---

## Implementation Phases

### Phase 0: Foundation — Tenants Table & Context Resolution

**New database tables:**

```sql
-- Tenant registry
CREATE TABLE public.tenants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,                -- subdomain: 'littlecafe'
  name text NOT NULL,
  -- Business identity
  business_name text NOT NULL,
  business_address text,
  business_phone text,
  business_email text,
  business_hours jsonb,
  -- Square credentials (encrypted via Supabase Vault)
  square_application_id text,
  square_access_token text,
  square_location_id text,
  square_environment text DEFAULT 'sandbox',
  square_merchant_id text,                  -- for webhook routing
  square_webhook_signature_key text,
  -- Email
  email_sender_name text,
  email_sender_address text,
  -- Status & features
  is_active boolean DEFAULT true,
  features jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tenant membership (replaces profiles.role for tenant-scoped access)
CREATE TABLE public.tenant_memberships (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('owner', 'admin', 'staff', 'customer')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- Helper function for RLS
CREATE OR REPLACE FUNCTION public.set_tenant_context(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**New files:**
- `src/lib/tenant/context.ts` — `resolveTenant(request)`, `getCurrentTenant()`, `getCurrentTenantId()`
- `src/lib/tenant/types.ts` — `Tenant`, `TenantMembership` interfaces
- `src/lib/tenant/cache.ts` — In-memory tenant config cache (avoid DB lookup per request)
- `src/providers/TenantProvider.tsx` — Client-side React context for tenant identity

**Modified files:**
- `middleware.ts` — Extract subdomain from `Host` header, lookup tenant, set `x-tenant-id` cookie
- `src/lib/supabase/server.ts` — Add `createTenantClient(tenantId)` that calls `set_tenant_context` RPC

### Phase 1: Add `tenant_id` to All Tables

Single migration adding `tenant_id uuid REFERENCES tenants(id)` + index to every table:
- profiles, orders, order_items, user_favorites, user_addresses
- suppliers, inventory_items, stock_movements, purchase_orders, purchase_order_items
- low_stock_alerts, recipe_ingredients, notifications, webhook_events
- site_settings, sales_transactions, sales_transaction_items, inventory_sales_sync_runs
- cogs_periods, cogs_reports, inventory_valuations, cogs_products, cogs_recipes
- kds_categories, kds_menu_items, kds_settings, kds_images

Then a backfill migration: create default tenant for "Little Cafe", update all rows, add NOT NULL.

### Phase 2: Rewrite RLS Policies

Every policy gets `AND tenant_id = current_setting('app.tenant_id', true)::uuid`. Pattern:

```sql
-- Example: orders table
CREATE POLICY "tenant_isolation_orders" ON public.orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Admin policies check `tenant_memberships` instead of `profiles.role`:

```sql
CREATE POLICY "admin_access_orders" ON public.orders
  FOR ALL USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND EXISTS (
      SELECT 1 FROM tenant_memberships
      WHERE user_id = auth.uid()
      AND tenant_id = current_setting('app.tenant_id', true)::uuid
      AND role IN ('owner', 'admin')
    )
  );
```

### Phase 3: Tenant-Aware Square Integration

**Modified files:**
- `src/lib/square/client.ts` — Factory pattern: `createTenantSquareClient(tenantConfig)`
- `src/lib/square/fetch-client.ts` — Replace `getHeaders()`/`getLocationId()` env reads with tenant config params
- `src/lib/square/orders.ts` — Replace hardcoded `'Little Cafe Website'` with `tenant.business_name`
- `src/app/api/square/config/route.ts` — Return tenant-specific Square config
- `src/app/api/square/process-payment/route.ts` — Use tenant-scoped Square client
- `src/app/api/webhooks/square/catalog/route.ts` — Resolve tenant from `merchant_id` in webhook payload
- `src/app/api/webhooks/square/inventory/route.ts` — Same

### Phase 4: Tenant-Aware Business Identity & Email

**Modified files:**
- `src/lib/constants/app.ts` — Replace static `BUSINESS_INFO`/`APP_NAME` with `getBusinessInfo(tenantId)`
- `src/app/layout.tsx` — Dynamic metadata from tenant context
- `src/lib/email/service.ts` — Accept tenant config for sender name/address and email template branding

### Phase 5: Auth System Overhaul

**Modified files:**
- `src/lib/admin/auth.ts` — `requireAdmin()` checks `tenant_memberships` table, not `profiles.role`
- `src/lib/admin/middleware.ts` — `requireAdminAuth()` scoped to tenant
- `src/app/admin/login/page.tsx` — Login resolves tenant from subdomain, checks membership
- `src/lib/supabase/database.ts` — All insert/query operations include `tenant_id`

### Phase 6: Client-Side Tenant Context

**Modified files:**
- `src/app/layout.tsx` — Wrap app in `<TenantProvider>`
- `src/app/(site)/layout.tsx` — Pass tenant to providers
- `src/providers/CartProvider.tsx` — Prefix localStorage keys with tenant slug
- `src/lib/constants/app.ts` — `STORAGE_KEYS` become `getStorageKeys(tenantSlug)`

### Phase 7: Platform Control Plane (Super-Admin)

**New route group:** `src/app/platform/`
- `layout.tsx` — Platform admin auth (separate from tenant admin)
- `tenants/page.tsx` — List/manage all tenants
- `tenants/new/page.tsx` — Onboard new cafe operator
- `tenants/[id]/page.tsx` — Manage tenant config, Square credentials, status

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Missed `tenant_id` filter in service-role queries | Create `TenantSupabaseClient` wrapper that auto-injects; lint rule to flag raw `createServiceClient()` |
| RLS policy gap → cross-tenant leakage | Integration test suite: create 2 tenants, verify every table is isolated |
| Square credential exposure | Encrypt at rest via Supabase Vault; never expose `access_token` to frontend |
| Module-level Square cache pollution | Replace `catalogItemsCache` in `orders.ts` with tenant-keyed `Map<tenantId, cache>` |
| localStorage collisions | Prefix all storage keys with tenant slug |

## Verification

1. **Create two test tenants** (slugs: `cafe-a`, `cafe-b`) with different Square sandbox accounts
2. **Visit `cafe-a.localhost:3000`** — should see cafe-a branding, menu, Square config
3. **Visit `cafe-b.localhost:3000`** — completely different identity and data
4. **Create orders in each** — verify orders table rows have correct `tenant_id`
5. **Admin login on cafe-a** — should NOT see cafe-b orders, inventory, or settings
6. **RLS test**: Use Supabase SQL editor to attempt `SELECT * FROM orders` without `app.tenant_id` set — should return empty
7. **Platform admin** at `platform.localhost:3000` — should list both tenants
