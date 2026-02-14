# Phase 30: RLS Policy Rewrite - Research

**Researched:** 2026-02-13
**Domain:** PostgreSQL Row Level Security, Supabase multi-tenant data isolation
**Confidence:** HIGH

## Summary

This research performs a comprehensive audit of all existing RLS policies, helper functions, storage policies, database functions, and UNIQUE constraints across the entire migration history. The codebase has 48 tenant-scoped tables (all now have `tenant_id` columns with NOT NULL + FK constraints from Phase 20), plus 3 exempt tables (`tenants`, `tenant_memberships`, `profiles`). Two database views use `security_invoker = true` and inherit RLS from underlying tables.

The existing RLS landscape is heterogeneous: some tables use `profiles.role = 'admin'` checks, others use `auth.uid() IS NOT NULL` (authenticated-only), some use `auth.role() = 'service_role'`, and a few use `is_admin()`. All 48 tables need their policies dropped and rewritten to include `tenant_id = current_setting('app.tenant_id', true)::uuid` plus the appropriate auth pattern from the four categories defined in CONTEXT.md.

**Primary recommendation:** Drop ALL existing policies on tenant-scoped tables and create new policies from scratch using the four patterns defined in CONTEXT.md. Rewrite `is_admin()` and `get_admin_user_id()` to check `tenant_memberships`. Use `(select current_setting('app.tenant_id', true))::uuid` (wrapped in SELECT for initPlan caching) for optimal performance.

## Standard Stack

No new libraries needed. This phase is pure SQL migration work.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| PostgreSQL RLS | 15+ (Supabase) | Row-level data isolation | Native PG feature, enforced at DB level |
| `current_setting()` | PG 9.6+ | Read session variable `app.tenant_id` | Standard PG config variable mechanism |
| `set_config()` | PG native | Set session variable from pre-request hook | Already in place from Phase 10 |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `security_invoker = true` | Views inherit caller's RLS | Already set on both views; no changes needed |

## Architecture Patterns

### Pattern 1: Tenant Scoping via Session Variable

**What:** Every RLS policy on a tenant-scoped table includes `tenant_id = (select current_setting('app.tenant_id', true))::uuid`

**Why the SELECT wrapper:** Supabase's performance guide recommends wrapping `current_setting()` and `auth.uid()` in `(select ...)` to trigger PostgreSQL's initPlan optimization, which caches the result instead of evaluating per-row.

**Critical detail on `missing_ok`:** `current_setting('app.tenant_id', true)` returns NULL when the variable is not set. Casting NULL to uuid produces NULL. The comparison `tenant_id = NULL` is always false in SQL (NULL != NULL). This means: if `app.tenant_id` is not set, ALL queries return zero rows. This is the correct fail-safe behavior for tenant isolation.

### Pattern 2: Four Policy Categories

From CONTEXT.md, all 48 tables fall into exactly one of these four categories:

#### Category A: Public Read (no auth required)
```sql
-- SELECT: anyone with tenant context can read
CREATE POLICY "tenant_select_{table}" ON public.{table}
  FOR SELECT
  USING (tenant_id = (select current_setting('app.tenant_id', true))::uuid);

-- INSERT/UPDATE/DELETE: admin/owner only
CREATE POLICY "tenant_admin_write_{table}" ON public.{table}
  FOR ALL
  USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (select current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );
```

#### Category B: Customer-Scoped (auth.uid() + tenant_id)
```sql
-- SELECT own data
CREATE POLICY "tenant_user_select_{table}" ON public.{table}
  FOR SELECT
  USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- INSERT own data
CREATE POLICY "tenant_user_insert_{table}" ON public.{table}
  FOR INSERT
  WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Admin read-all for the tenant
CREATE POLICY "tenant_admin_select_{table}" ON public.{table}
  FOR SELECT
  USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (select current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );
```

#### Category C: KDS (any tenant member for read)
```sql
-- SELECT: any authenticated tenant member
CREATE POLICY "tenant_member_select_{table}" ON public.{table}
  FOR SELECT
  USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (select current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin', 'staff')
    )
  );

-- Write: admin/owner only
CREATE POLICY "tenant_admin_write_{table}" ON public.{table}
  FOR ALL
  USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (select current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );
```

#### Category D: Admin (owner/admin write, staff read)
```sql
-- SELECT: owner/admin/staff
CREATE POLICY "tenant_staff_select_{table}" ON public.{table}
  FOR SELECT
  USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (select current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin', 'staff')
    )
  );

-- INSERT/UPDATE/DELETE: owner/admin only
CREATE POLICY "tenant_admin_write_{table}" ON public.{table}
  FOR INSERT
  WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (select current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

-- (Same pattern for UPDATE and DELETE)
```

### Pattern 3: Performance Optimization with Security Definer Helper

**Recommendation:** Create a `public.is_tenant_member(p_role text[])` function to avoid repeating the `EXISTS` subquery:

```sql
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_roles text[] DEFAULT ARRAY['owner','admin','staff','customer'])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
    AND user_id = auth.uid()
    AND role = ANY(p_roles)
  );
END;
$$;
```

**IMPORTANT CAVEAT:** Per Supabase performance docs, DO NOT pass row data to security definer functions. Passing constant arrays like `ARRAY['owner','admin']` is fine because the result can be cached via initPlan. The function must NOT take the table's `tenant_id` as a parameter -- it reads the session variable internally.

**Usage in policies:**
```sql
-- Admin write
USING (
  tenant_id = (select current_setting('app.tenant_id', true))::uuid
  AND (select is_tenant_member(ARRAY['owner','admin']))
)
```

### Anti-Patterns to Avoid
- **DO NOT use `auth.role() = 'service_role'` in new policies**: Service role bypasses RLS entirely. Existing service_role policies on tenant-scoped tables should be DROPPED, not rewritten.
- **DO NOT pass row-level data to helper functions**: Breaks initPlan caching, causes per-row evaluation.
- **DO NOT use PERMISSIVE `FOR ALL` without tenant_id**: Every policy must include the tenant_id check.
- **DO NOT create separate service_role policies**: Service role bypasses RLS by design; adding explicit policies is redundant and confusing.

## Complete Audit: Existing RLS Policies

### Table: profiles (EXEMPT - no tenant_id)
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Users can view own profile | SELECT | `auth.uid() = id` |
| Users can update own profile | UPDATE | `auth.uid() = id` |
**Action:** Keep as-is. No tenant_id on profiles.

### Table: orders
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Users can view own orders | SELECT | `auth.uid() = user_id` |
| Users can create orders | INSERT | `auth.uid() = user_id` |
| Users can update own pending orders | UPDATE | `auth.uid() = user_id AND status = 'pending'` |
| Anonymous users can create orders | INSERT | `user_id IS NULL` |
| Staff can view all orders | SELECT | `profiles.email LIKE '%@littlecafe.com'` |
| Staff can update order status | UPDATE | `profiles.email LIKE '%@littlecafe.com'` |
**Action:** DROP all 6, rewrite as Category B (customer-scoped) + admin/anonymous policies.

### Table: order_items
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Users can view own order items | SELECT | EXISTS join to orders (auth.uid() or null) |
| Users can create order items | INSERT | EXISTS join to orders (auth.uid() or null) |
**Action:** DROP all 2, rewrite as Category B (inherits tenant from order).

### Table: user_favorites
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Users can view own favorites | SELECT | `auth.uid() = user_id` |
| Users can manage own favorites | ALL | `auth.uid() = user_id` |
**Action:** DROP all 2, rewrite as Category B (customer-scoped).

### Table: user_addresses
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Users can view own addresses | SELECT | `auth.uid() = user_id` |
| Users can manage own addresses | ALL | `auth.uid() = user_id` |
**Action:** DROP all 2, rewrite as Category B (customer-scoped).

### Table: inventory_items
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Authenticated users can manage inventory items | ALL | `auth.uid() IS NOT NULL` |
| Service role can manage inventory items | ALL | `auth.role() = 'service_role'` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: suppliers
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Authenticated users can manage suppliers | ALL | `auth.uid() IS NOT NULL` |
| Service role can manage suppliers | ALL | `auth.role() = 'service_role'` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: stock_movements
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Authenticated users can view stock movements | SELECT | `auth.uid() IS NOT NULL` |
| Authenticated users can insert stock movements | INSERT | `auth.uid() IS NOT NULL` |
| Service role can manage stock movements | ALL | `auth.role() = 'service_role'` |
**Action:** DROP all 3, rewrite as Category D (admin).

### Table: purchase_orders
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Authenticated users can manage purchase orders | ALL | `auth.uid() IS NOT NULL` |
| Service role can manage purchase orders | ALL | `auth.role() = 'service_role'` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: purchase_order_items
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Authenticated users can manage purchase order items | ALL | `auth.uid() IS NOT NULL` |
| Service role can manage purchase order items | ALL | `auth.role() = 'service_role'` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: low_stock_alerts
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Authenticated users can manage low stock alerts | ALL | `auth.uid() IS NOT NULL` |
| Service role can manage low stock alerts | ALL | `auth.role() = 'service_role'` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: recipe_ingredients
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Authenticated users can manage recipe ingredients | ALL | `auth.uid() IS NOT NULL` |
| Service role can manage recipe ingredients | ALL | `auth.role() = 'service_role'` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: inventory_settings
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Allow authenticated access to inventory_settings | ALL | `auth.uid() IS NOT NULL` |
**Action:** DROP 1, rewrite as Category D (admin).

### Table: inventory_locations
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Allow authenticated access to inventory_locations | ALL | `auth.uid() IS NOT NULL` |
**Action:** DROP 1, rewrite as Category D (admin).

### Table: inventory_unit_types
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Allow authenticated access to inventory_unit_types | ALL | `auth.uid() IS NOT NULL` |
**Action:** DROP 1, rewrite as Category D (admin).

### Table: invoices
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Admins can manage invoices | ALL | `profiles.role = 'admin'` |
**Action:** DROP 1, rewrite as Category D (admin).

### Table: invoice_items
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Admins can manage invoice items | ALL | `profiles.role = 'admin'` |
**Action:** DROP 1, rewrite as Category D (admin).

### Table: order_invoice_matches
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Admins can manage order invoice matches | ALL | `profiles.role = 'admin'` |
**Action:** DROP 1, rewrite as Category D (admin).

### Table: supplier_invoice_templates
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Admins can manage supplier invoice templates | ALL | `profiles.role = 'admin'` |
**Action:** DROP 1, rewrite as Category D (admin).

### Table: invoice_import_sessions
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Admins can manage their own import sessions | ALL | `profiles.role = 'admin' AND user_id = auth.uid()` |
| Admins can view all import sessions | SELECT | `profiles.role = 'admin'` |
**Action:** DROP 2, rewrite as Category D (admin).

### Table: notifications
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Users can view own notifications | SELECT | `auth.uid() = user_id` |
| Users can update own notifications | UPDATE | `auth.uid() = user_id` |
| Authenticated users can insert notifications | INSERT | `auth.uid() IS NOT NULL` |
| Service role can manage notifications | ALL | `auth.role() = 'service_role'` |
**Action:** DROP all 4, rewrite as Category B (customer-scoped) with system insert.

### Table: webhook_events
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Admin can manage webhook events | ALL | `profiles.role = 'admin'` |
**Action:** DROP 1, rewrite as Category D (admin).

### Table: site_settings
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Allow read access to site settings | SELECT | `true` (public) |
| Admins can insert site settings | INSERT | `is_admin()` |
| Admins can update site settings | UPDATE | `is_admin()` |
**Action:** DROP all 3, rewrite as Category A (public read) with admin write.

### Table: inventory_sales_sync_runs
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role can manage sales sync runs | ALL | `auth.role() = 'service_role'` |
| Authenticated read sales sync runs | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: sales_transactions
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role can manage sales transactions | ALL | `auth.role() = 'service_role'` |
| Authenticated read sales transactions | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: sales_transaction_items
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role can manage sales transaction items | ALL | `auth.role() = 'service_role'` |
| Authenticated read sales transaction items | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: purchase_order_status_history
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages purchase order history | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read purchase order history | SELECT | `auth.uid() IS NOT NULL` |
| Admins can insert purchase order history | INSERT | `is_admin()` |
**Action:** DROP all 3, rewrite as Category D (admin).

### Table: purchase_order_attachments
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages purchase order attachments | ALL | `auth.role() = 'service_role'` |
| Authenticated users can view purchase order attachments | SELECT | `auth.uid() IS NOT NULL` |
| Authenticated users can insert purchase order attachments | INSERT | `auth.uid() IS NOT NULL` |
| Authenticated users can update purchase order attachments | UPDATE | `auth.uid() IS NOT NULL` |
| Authenticated users can delete purchase order attachments | DELETE | `auth.uid() IS NOT NULL` |
**Action:** DROP all 5, rewrite as Category D (admin).

### Table: purchase_order_receipts
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages purchase order receipts | ALL | `auth.role() = 'service_role'` |
| Authenticated users can view purchase order receipts | SELECT | `auth.uid() IS NOT NULL` |
| Authenticated users can insert purchase order receipts | INSERT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 3, rewrite as Category D (admin).

### Table: supplier_email_templates
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages supplier email templates | ALL | `auth.role() = 'service_role'` |
| Authenticated users can view supplier email templates | SELECT | `auth.uid() IS NOT NULL` |
| Authenticated users can manage supplier email templates | ALL | `auth.uid() IS NOT NULL` |
**Action:** DROP all 3, rewrite as Category D (admin).

### Table: inventory_item_cost_history
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| inventory_cost_history_read | SELECT | `true` (public) |
| inventory_cost_history_insert | INSERT | `profiles.role = 'admin'` (TO authenticated) |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_periods
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages cogs periods | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read cogs periods | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: inventory_valuations
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages inventory valuations | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read inventory valuations | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_reports
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages cogs reports | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read cogs reports | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_products
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages cogs products | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read cogs products | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_sellables
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages cogs sellables | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read cogs sellables | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_sellable_aliases
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages cogs sellable aliases | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read cogs sellable aliases | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_product_recipes
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages product recipes | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read product recipes | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_product_recipe_lines
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages product recipe lines | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read product recipe lines | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_sellable_recipe_overrides
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages sellable overrides | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read sellable overrides | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_sellable_recipe_override_ops
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages sellable override ops | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read sellable override ops | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_modifier_sets
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages cogs modifier sets | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read cogs modifier sets | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_modifier_options
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages cogs modifier options | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read cogs modifier options | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_modifier_option_recipes
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages modifier option recipes | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read modifier option recipes | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: cogs_modifier_option_recipe_lines
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages modifier option recipe lines | ALL | `auth.role() = 'service_role'` |
| Authenticated users can read modifier option recipe lines | SELECT | `auth.uid() IS NOT NULL` |
**Action:** DROP all 2, rewrite as Category D (admin).

### Table: kds_categories
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages kds_categories | ALL | `auth.role() = 'service_role'` |
| Anyone can read kds_categories | SELECT | `true` (public) |
**Action:** DROP all 2, rewrite as Category C (KDS: authenticated member read, admin write).

### Table: kds_menu_items
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages kds_menu_items | ALL | `auth.role() = 'service_role'` |
| Anyone can read kds_menu_items | SELECT | `true` (public) |
**Action:** DROP all 2, rewrite as Category C (KDS).

### Table: kds_settings
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages kds_settings | ALL | `auth.role() = 'service_role'` |
| Anyone can read kds_settings | SELECT | `true` (public) |
**Action:** DROP all 2, rewrite as Category C (KDS).

### Table: kds_images
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Service role manages kds_images | ALL | `auth.role() = 'service_role'` |
| Anyone can read kds_images | SELECT | `true` (public) |
**Action:** DROP all 2, rewrite as Category C (KDS).

### Tables: tenants, tenant_memberships (EXEMPT)
Already have proper policies from Phase 10. No changes needed.

## Complete Table Classification (48 tenant-scoped tables)

### Category A: Public Read (2 tables)
Tenant-scoped, anonymous SELECT allowed, admin write.

| Table | Rationale |
|-------|-----------|
| `site_settings` | Maintenance mode check needed by anonymous visitors |
| (none additional) | All menu data comes from Square API, not from DB tables |

**Note:** There are no "menu" or "categories" tables for public customer browsing. The customer-facing menu is fetched from Square API directly. `site_settings` is the only table that truly needs anonymous public read.

### Category B: Customer-Scoped (5 tables)
Auth.uid() + tenant_id for user's own data; admin/owner can see all tenant data.

| Table | Rationale |
|-------|-----------|
| `orders` | Users view/create their own orders; admins view all; anonymous guest checkout (user_id IS NULL) |
| `order_items` | Inherits access from parent order |
| `user_favorites` | User's own favorites per tenant |
| `user_addresses` | User's own addresses per tenant |
| `notifications` | User's own notifications; system can insert |

### Category C: KDS (4 tables)
Any tenant member (owner/admin/staff) can read; admin/owner can write. Requires authentication.

| Table | Rationale |
|-------|-----------|
| `kds_categories` | KDS display screens require auth (staff/admin) per CONTEXT.md |
| `kds_menu_items` | KDS display screens require auth |
| `kds_settings` | KDS configuration |
| `kds_images` | KDS footer images |

### Category D: Admin (37 tables)
Owner/admin full CRUD; staff SELECT only; all tenant-scoped.

| Table | Rationale |
|-------|-----------|
| `suppliers` | Admin inventory management |
| `inventory_items` | Admin inventory management |
| `stock_movements` | Admin inventory audit trail |
| `purchase_orders` | Admin procurement |
| `purchase_order_items` | Admin procurement |
| `purchase_order_status_history` | Admin procurement history |
| `purchase_order_attachments` | Admin procurement files |
| `purchase_order_receipts` | Admin procurement receiving |
| `low_stock_alerts` | Admin alerts |
| `recipe_ingredients` | Admin recipe management |
| `inventory_settings` | Admin inventory config |
| `inventory_locations` | Admin inventory config |
| `inventory_unit_types` | Admin inventory config |
| `invoices` | Admin invoice processing |
| `invoice_items` | Admin invoice processing |
| `order_invoice_matches` | Admin invoice matching |
| `supplier_invoice_templates` | Admin invoice templates |
| `invoice_import_sessions` | Admin invoice import |
| `supplier_email_templates` | Admin email config |
| `webhook_events` | Admin audit/debug |
| `inventory_sales_sync_runs` | Admin sales sync |
| `sales_transactions` | Admin sales data |
| `sales_transaction_items` | Admin sales data |
| `inventory_item_cost_history` | Admin cost tracking |
| `inventory_valuations` | Admin COGS |
| `cogs_periods` | Admin COGS |
| `cogs_reports` | Admin COGS |
| `cogs_products` | Admin COGS |
| `cogs_sellables` | Admin COGS |
| `cogs_sellable_aliases` | Admin COGS |
| `cogs_product_recipes` | Admin COGS |
| `cogs_product_recipe_lines` | Admin COGS |
| `cogs_sellable_recipe_overrides` | Admin COGS |
| `cogs_sellable_recipe_override_ops` | Admin COGS |
| `cogs_modifier_sets` | Admin COGS |
| `cogs_modifier_options` | Admin COGS |
| `cogs_modifier_option_recipes` | Admin COGS |
| `cogs_modifier_option_recipe_lines` | Admin COGS |

**Total: 2 + 5 + 4 + 37 = 48 tables**

## Helper Functions Requiring Rewrite

### 1. `is_admin()` -- MUST REWRITE
**Current:** Checks `profiles.role = 'admin'`
**New:** Check `tenant_memberships` for current tenant with role IN ('owner', 'admin')

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
    AND user_id = auth.uid()
    AND role IN ('owner', 'admin')
  );
END;
$$;
```

### 2. `get_admin_user_id()` -- MUST REWRITE
**Current:** Calls `is_admin()` then returns `auth.uid()`
**New:** Same logic but now `is_admin()` is tenant-aware, so this just works after #1 is updated.

```sql
CREATE OR REPLACE FUNCTION public.get_admin_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN auth.uid();
  ELSE
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
END;
$$;
```

### 3. NEW: `is_tenant_member(p_roles text[])` -- CREATE NEW
Performance helper to avoid repeating EXISTS subquery in every policy.

## Database Functions/RPCs Needing Tenant Awareness

These functions operate on tenant-scoped tables but do NOT filter by tenant_id. If called by service role, they bypass RLS anyway. If called by authenticated users, they need tenant scoping OR the RLS on underlying tables will handle it.

| Function | Security | Tables Touched | Needs Update? |
|----------|----------|----------------|---------------|
| `increment_inventory_stock` | INVOKER | inventory_items | NO - RLS on table handles it |
| `decrement_inventory_stock` | INVOKER | inventory_items | NO - RLS on table handles it |
| `update_inventory_stock` | SECURITY DEFINER | inventory_items, inventory_movements | YES - bypasses RLS, needs WHERE tenant_id filter |
| `update_stock_simple` | SECURITY DEFINER | inventory_items | YES - bypasses RLS, needs WHERE tenant_id filter |
| `shift_inventory_between_items` | INVOKER | inventory_items | NO - RLS on table handles it |
| `calculate_invoice_total` | INVOKER | invoice_items | NO - RLS on table handles it |
| `update_invoice_status` | INVOKER (trigger) | invoices | NO - trigger context |
| `create_order_notification` | SECURITY DEFINER | notifications | YES - bypasses RLS, needs tenant_id parameter |
| `get_unread_notification_count` | SECURITY DEFINER | notifications | YES - bypasses RLS, needs tenant_id filter |
| `mark_all_notifications_read` | SECURITY DEFINER | notifications | YES - bypasses RLS, needs tenant_id filter |
| `log_purchase_order_receipt` | INVOKER | purchase_order_items, purchase_orders, purchase_order_receipts, purchase_order_status_history, stock_movements, inventory_items | NO - but called via service role typically |
| `rpc_po_supplier_metrics` | INVOKER (SQL, STABLE) | po_supplier_metrics_v (view) | NO - view inherits RLS from caller |
| `handle_new_user` | SECURITY DEFINER (trigger) | profiles | NO - profiles is exempt |
| `set_tenant_from_request` | SECURITY DEFINER | none (sets config) | NO - already tenant-aware |
| `set_tenant_context` | SECURITY DEFINER | none (sets config) | NO - already tenant-aware |

**Functions that MUST be updated (SECURITY DEFINER that touch tenant-scoped tables):**
1. `update_inventory_stock` - Add `AND tenant_id = current_setting('app.tenant_id', true)::uuid` to WHERE clauses
2. `update_stock_simple` - Same
3. `create_order_notification` - Add tenant_id parameter, include in INSERT
4. `get_unread_notification_count` - Add tenant_id filter to WHERE
5. `mark_all_notifications_read` - Add tenant_id filter to WHERE

## Storage Bucket Policies

### Bucket: `invoices` (private)
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Admins can upload invoice files | INSERT | `bucket_id = 'invoices' AND profiles.role = 'admin'` |
| Admins can access invoice files | SELECT | `bucket_id = 'invoices' AND profiles.role = 'admin'` |
| Admins can update invoice files | UPDATE | `bucket_id = 'invoices' AND profiles.role = 'admin'` |
| Admins can delete invoice files | DELETE | `bucket_id = 'invoices' AND profiles.role = 'admin'` |

**Action:** DROP all 4, rewrite to use `tenant_memberships` check.

**Note:** Storage objects do NOT have a `tenant_id` column. Tenant scoping in storage must be done via path convention (e.g., `{tenant_id}/invoices/...`) and checked in the policy using `storage.foldername(name)` or similar path extraction.

### Bucket: `purchase-order-attachments` (public)
| Policy Name | Operation | Logic |
|-------------|-----------|-------|
| Authenticated users can upload purchase order attachments | INSERT | `bucket_id AND (authenticated OR service_role)` |
| Authenticated users can update purchase order attachments | UPDATE | Same |
| Authenticated users can delete purchase order attachments | DELETE | Same |
| Purchase order attachments public read | SELECT | `bucket_id` (public) |

**Action:** DROP all 4, rewrite with `tenant_memberships` check for write ops. Consider whether public read is appropriate or should require tenant member auth.

## UNIQUE Constraints That Will Block Multi-Tenant Data

These single-column UNIQUE constraints will prevent a second tenant from having the same values. They must be converted to composite UNIQUE constraints including `tenant_id`. This is **deferred to Phase 30+** per STATE.md but documented here for awareness.

| Table | Current Constraint | Needs to Become |
|-------|-------------------|-----------------|
| `suppliers` | `name UNIQUE` | `UNIQUE(tenant_id, name)` |
| `inventory_items` | `square_item_id, pack_size` (composite unique index) | `UNIQUE(tenant_id, square_item_id, pack_size)` |
| `inventory_locations` | `name UNIQUE` | `UNIQUE(tenant_id, name)` |
| `inventory_unit_types` | `symbol UNIQUE` | `UNIQUE(tenant_id, symbol)` |
| `purchase_orders` | `order_number UNIQUE` | `UNIQUE(tenant_id, order_number)` |
| `webhook_events` | `event_id UNIQUE` | Possibly `UNIQUE(tenant_id, event_id)` |
| `kds_categories` | `slug UNIQUE` | `UNIQUE(tenant_id, slug)` |
| `kds_settings` | `key UNIQUE` | `UNIQUE(tenant_id, key)` |
| `kds_images` | `filename UNIQUE` | `UNIQUE(tenant_id, filename)` |
| `kds_menu_items` | `square_variation_id` (partial unique index) | `UNIQUE(tenant_id, square_variation_id)` |
| `sales_transactions` | `square_order_id UNIQUE` | `UNIQUE(tenant_id, square_order_id)` |
| `cogs_products` | `square_item_id UNIQUE` | `UNIQUE(tenant_id, square_item_id)` |
| `cogs_products` | `product_code` (partial unique index) | `UNIQUE(tenant_id, product_code)` |
| `cogs_sellables` | `square_variation_id UNIQUE` | `UNIQUE(tenant_id, square_variation_id)` |
| `cogs_sellable_aliases` | `square_variation_id UNIQUE` | `UNIQUE(tenant_id, square_variation_id)` |
| `cogs_modifier_sets` | `square_modifier_list_id UNIQUE` | `UNIQUE(tenant_id, square_modifier_list_id)` |
| `cogs_modifier_options` | `square_modifier_id UNIQUE` | `UNIQUE(tenant_id, square_modifier_id)` |
| `cogs_periods` | `(start_at, end_at)` unique index | `UNIQUE(tenant_id, start_at, end_at)` |
| `invoices` | `UNIQUE(supplier_id, invoice_number)` | Already includes FK; need to verify supplier is tenant-scoped |
| `site_settings` | `id = 1` singleton pattern | Need `UNIQUE(tenant_id)` or `UNIQUE(tenant_id, id)` |
| `user_favorites` | `UNIQUE(user_id, square_item_id)` | `UNIQUE(tenant_id, user_id, square_item_id)` |

**Decision (per CONTEXT.md):** Deferred -- not part of Phase 30 scope. However, Phase 30 RLS policies will still prevent cross-tenant reads even without fixing these constraints. The UNIQUE constraint issue only manifests when inserting data for a second tenant.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant scoping | Custom middleware per-query | RLS policies with `current_setting` | RLS is enforced at DB level, impossible to bypass from app code |
| Admin check | App-level role checks only | `is_admin()` function + RLS | Defense in depth; app code can have bugs |
| Service role bypass | Custom service_role policies | Supabase's built-in bypass | Service role already bypasses RLS entirely |
| View tenant filtering | Manually filtering in views | `security_invoker = true` | Already in place; views inherit caller's RLS |

## Common Pitfalls

### Pitfall 1: Forgetting the SELECT Wrapper
**What goes wrong:** Writing `tenant_id = current_setting('app.tenant_id', true)::uuid` without wrapping in `(select ...)`
**Why it happens:** Looks correct syntactically
**How to avoid:** Always use `(select current_setting('app.tenant_id', true))::uuid` and `(select auth.uid())`
**Warning signs:** Slow queries on tenant-scoped tables

### Pitfall 2: Service Role Policies on Tenant Tables
**What goes wrong:** Creating explicit `auth.role() = 'service_role'` policies alongside tenant policies
**Why it happens:** Existing migration pattern had these
**How to avoid:** Service role bypasses RLS entirely. DROP all service_role policies on tenant-scoped tables; they are unnecessary.
**Warning signs:** Duplicate or confusing policy sets

### Pitfall 3: PERMISSIVE Policy Accumulation
**What goes wrong:** Multiple PERMISSIVE policies on same table combine with OR, so a loose policy can override a strict one
**Why it happens:** PostgreSQL's default policy mode is PERMISSIVE
**How to avoid:** Design policies knowing they OR together. If a table has both "public SELECT" and "admin SELECT" policies, public wins for SELECT. This is usually correct but must be intentional.
**Warning signs:** Unexpected access grants

### Pitfall 4: Anonymous Guest Checkout
**What goes wrong:** Guest checkout (user_id IS NULL) breaks if policy requires `auth.uid() = user_id`
**Why it happens:** Anonymous users have no auth.uid()
**How to avoid:** Orders table needs a separate INSERT policy for anonymous users: `user_id IS NULL AND tenant_id = ...`
**Warning signs:** Guest checkout 403 errors

### Pitfall 5: SECURITY DEFINER Functions Bypassing RLS
**What goes wrong:** Functions declared SECURITY DEFINER run as the function owner (usually postgres), which bypasses RLS
**Why it happens:** Developer expects RLS to apply inside the function
**How to avoid:** For SECURITY DEFINER functions that touch tenant-scoped tables, add explicit `WHERE tenant_id = current_setting('app.tenant_id', true)::uuid` in the function body. Cannot rely on RLS.
**Warning signs:** Cross-tenant data leakage via RPC calls

### Pitfall 6: Missing Rollback Migration
**What goes wrong:** If migration fails mid-way, partially-applied policy changes leave tables in inconsistent state
**Why it happens:** Large migration touching 48 tables
**How to avoid:** Wrap in BEGIN/COMMIT. Also create a rollback migration file.

### Pitfall 7: Storage Policies Lack tenant_id Column
**What goes wrong:** `storage.objects` has no `tenant_id` column, so you cannot use the same pattern
**Why it happens:** Storage is a separate Supabase system
**How to avoid:** Use path-based convention (`{tenant_id}/bucket-name/...`) and check `(storage.foldername(name))[1]` in policies. OR check `tenant_memberships` without tenant_id on the storage object itself.

## Recommended Migration Ordering

### Stage 1: Helper Functions (prerequisite for all policies)
1. Rewrite `is_admin()` to be tenant-aware
2. Rewrite `get_admin_user_id()` to be tenant-aware
3. Create new `is_tenant_member(text[])` helper

### Stage 2: Drop ALL Existing Policies on 48 Tables
Single migration that drops every policy on every tenant-scoped table. Clean slate.

### Stage 3: Create New Policies for All 48 Tables
Organized by category (A, B, C, D). Could be one large migration or split by category.

### Stage 4: Update SECURITY DEFINER Functions
Update the 5 functions identified above to include tenant_id filtering.

### Stage 5: Rewrite Storage Policies
Update `invoices` and `purchase-order-attachments` bucket policies.

### Stage 6: Verification
Create two test tenants, verify isolation across all tables.

**Dependency chain:** Stage 1 must come first (helpers used by policies). Stages 2-3 must be together or Stage 2 before 3. Stages 4-5 can be parallel. Stage 6 is last.

**Recommended:** Combine Stages 1-3 into a single migration for atomicity. A single BEGIN/COMMIT wrapping the DROP of all old policies and CREATE of all new policies ensures no window where tables have no policies. Stage 4 and 5 can be separate migrations.

## Open Questions

1. **Storage path convention for tenant scoping:** The exact path structure for tenant-scoped storage buckets needs to be decided. Options: `{tenant_id}/filename`, `{tenant_slug}/filename`. Since storage paths are currently just filenames, existing files would need path migration.

2. **Guest order viewing:** Currently anonymous users who create orders cannot view them (no auth.uid()). The existing system likely uses the order ID in the URL. After RLS rewrite, even the URL-based lookup needs tenant_id in the session. This should work if middleware always sets app.tenant_id from subdomain even for anonymous requests.

3. **Notification INSERT from system:** The `create_order_notification` function is SECURITY DEFINER and inserts into notifications. It needs a `tenant_id` parameter added to its signature or needs to read it from the session variable.

## Sources

### Primary (HIGH confidence)
- All 60 migration files in `supabase/migrations/` -- direct source code audit
- `src/lib/admin/auth.ts`, `middleware.ts`, `setup.ts` -- application admin auth code
- `.planning/phase-30/30-CONTEXT.md` -- locked decisions
- `.planning/STATE.md` -- known issues and prior decisions

### Secondary (MEDIUM confidence)
- [Supabase RLS Performance and Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) -- initPlan optimization, SELECT wrapper pattern
- [Supabase Row Level Security Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) -- USING vs WITH CHECK, policy types
- [PostgreSQL current_setting documentation](https://www.postgresql.org/docs/current/functions-admin.html) -- missing_ok parameter behavior

### Tertiary (LOW confidence)
- [Multi-Tenant Applications with RLS on Supabase](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/) -- community patterns
- [Supabase RLS Best Practices (MakerKit)](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) -- security definer recommendations

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Pure PostgreSQL RLS, no external dependencies
- Architecture patterns: HIGH - Based on locked CONTEXT.md decisions + official Supabase docs
- Table classification: HIGH - Direct audit of all 60 migration files
- Policy audit: HIGH - Every policy extracted from source migrations
- Pitfalls: HIGH - Mix of direct code analysis + official Supabase performance docs
- Function audit: HIGH - All functions from migrations inspected
- Storage policies: MEDIUM - Storage tenant scoping pattern needs design decision

**Policy counts:**
- Total existing policies to DROP: ~97 across 48 tables
- Total new policies to CREATE: ~96-144 across 48 tables (2-3 per table)
- Helper functions to rewrite: 2 (is_admin, get_admin_user_id)
- Helper functions to create: 1 (is_tenant_member)
- SECURITY DEFINER functions to update: 5
- Storage policy sets to rewrite: 2 buckets (8 policies total)

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable domain, no fast-moving dependencies)
