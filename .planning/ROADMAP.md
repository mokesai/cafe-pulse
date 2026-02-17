# Roadmap: Milestone 1.0 — Multi-Tenant MVP

## Phase 10: Tenant Foundation ✓
Create the `tenants` and `tenant_memberships` tables. Build the tenant context resolution system (subdomain → tenant lookup → cookie). Add `createTenantClient()` to Supabase server module.

**Deliverables:**
- [x] `tenants` table with business config + Square credentials
- [x] `tenant_memberships` table (user-tenant-role mapping)
- [x] `set_tenant_context()` PostgreSQL function
- [x] `src/lib/tenant/` module (context, types, cache)
- [x] Middleware extracts subdomain and resolves tenant

**Verified:** 14/14 must-haves passed. Build and lint clean.

---

## Phase 20: Schema Migration — Add tenant_id ✓
Add `tenant_id uuid` column to all 48 tenant-scoped tables. Backfill all existing rows with default tenant UUID. Add NOT NULL constraints, FK constraints, and btree indexes.

**Goal:** All existing data has tenant_id set. Schema enforces referential integrity. App still works unchanged on the default tenant.

**Deliverables:**
- [x] Migration: add `tenant_id uuid DEFAULT '...-0001'` to all 48 tables
- [x] Migration: add NOT NULL + FK constraints to all 48 tables
- [x] Migration: add btree indexes on tenant_id for all 48 tables

**Verified:** 7/7 must-haves passed. Build clean. All 48 tables complete (column + NOT NULL + FK + index).

---

## Phase 30: RLS Policy Rewrite ✓
Rewrite all Row Level Security policies to include `tenant_id = current_setting('app.tenant_id')::uuid`. Update admin policies to check `tenant_memberships` instead of `profiles.role`.

**Goal:** Complete tenant isolation at the database level. Every query returns only data belonging to the current tenant. Admin access uses tenant_memberships instead of profiles.role.

**Deliverables:**
- [x] All RLS policies rewritten with tenant scoping
- [x] Admin policies use `tenant_memberships` table
- [x] SECURITY DEFINER functions updated with tenant_id filtering
- [x] Storage bucket policies rewritten with tenant_memberships

**Verified:** 4/4 must-haves passed. 202 tenant policies active, 0 old policies remaining. App works on default tenant.

---

## Phase 40: Tenant-Aware Square Integration ✓
Refactor Square client to parameterized pattern with Vault-encrypted credential storage. Load credentials per-tenant per-request. Eliminate all env var reads for Square credentials.

**Goal:** Every Square API call uses the correct tenant's credentials loaded from Supabase Vault (with env var fallback for default tenant). Webhooks resolve tenant from merchant_id. Frontend config is server-rendered.

**Plans:** 13 plans

Plans:
- [x] 40-01-PLAN.md — Vault infrastructure: migration, SECURITY DEFINER functions, audit table, merchant_id index
- [x] 40-02-PLAN.md — SquareConfig type and credential loading layer (getTenantSquareConfig)
- [x] 40-03-PLAN.md — Parameterize fetch-client.ts (all 15 functions accept SquareConfig)
- [x] 40-04-PLAN.md — Update domain layers (catalog.ts, orders.ts, tax-validation.ts, customers.ts)
- [x] 40-05-PLAN.md — Update customer-facing API routes (menu, config, payment, order-preview)
- [x] 40-06-PLAN.md — Update 7 admin API routes with inline Square env vars
- [x] 40-07-PLAN.md — Webhook tenant resolution via merchant_id
- [x] 40-08-PLAN.md — Frontend config delivery: server-rendered props replace client-side fetch
- [x] 40-09-PLAN.md — Dead code cleanup: remove client.ts, simple-client.ts, and consumer routes
- [x] 40-10-PLAN.md — Tenant-flag support for setup scripts (sync-square-catalog, seed-inventory, setup-square-webhooks)
- [x] 40-11-PLAN.md — Gap closure: fix menu categories and items admin routes (missed in 40-06)
- [x] 40-12-PLAN.md — Gap closure: fix customer cards routes (missed in 40-05 and 40-06)
- [x] 40-13-PLAN.md — Gap closure: fix test/debug routes (tax-config, test-catalog, validate-catalog, test-order)

**Testable:** Two tenants with different Square sandbox accounts show different catalogs.

**Verified:** 10/10 must-haves passed. All Square API routes tenant-aware. TypeScript build clean.

---

## Phase 50: Tenant-Aware Auth & Business Identity ✓
Overhaul admin auth to use `tenant_memberships`. Replace hardcoded business info with per-tenant config. Make email templates tenant-aware.

**Goal:** Admin authentication checks tenant membership instead of profiles.role. Business identity loaded from tenants table. Emails use tenant branding.

**Plans:** 6 plans

Plans:
- [x] 50-01-PLAN.md — Tenant identity infrastructure: getTenantIdentity() function, TenantPublic type
- [x] 50-02-PLAN.md — React Email setup and template components
- [x] 50-03-PLAN.md — requireAdmin() overhaul with tenant membership check
- [x] 50-04-PLAN.md — TenantProvider React Context for client components
- [x] 50-05-PLAN.md — Email service integration with tenant branding
- [x] 50-06-PLAN.md — Gap closure: add missing branding columns to tenants table

**Testable:** Admin login on tenant A cannot access tenant B data. Emails show correct branding.

**Verified:** 22/22 must-haves passed (re-verified after gap closure). Admin auth uses tenant_memberships. Business identity with branding columns. Email templates tenant-branded. TypeScript build clean.

---

## Phase 50.1: Fix OrdersManagement Component Loading Bug ✓

**Goal:** Resolve server-side layout error that prevented OrdersManagement component from loading in admin panel. Restore admin order management functionality.

**Depends on:** Phase 50 (completed — Phase 50-06 fixed the root cause)

**Plans:** 1 plan

Plans:
- [x] 50.1-01-PLAN.md — Re-enable OrdersManagement component now that branding columns exist

**Root Cause:**
The error was NOT a webpack bundling issue as initially suspected. The `getTenantIdentity()` function in both site and admin layouts tried to SELECT `logo_url, primary_color, secondary_color` columns from the tenants table (added in Phase 50-01), but those columns didn't exist in the database until Phase 50-06 gap closure migration. This caused a server-side database error that crashed the layout before any page component could render, making it appear as a client-side component loading error.

**Additional Discovery:**
Recursive RLS policy on `tenant_memberships` table ("Admins can read tenant memberships") caused infinite recursion when `requireAdmin()` tried to verify user permissions. Fixed by dropping the recursive policy and relying on "Users can read own memberships" policy.

**Verified:** 3/3 automated checks + 6/6 human verification items passed. Admin orders page loads without errors. OrdersManagement component renders with full functionality (filtering, pagination, details modal). TypeScript build clean.

---

## Phase 60: Platform Control Plane ✓

Build the super-admin interface for managing tenants. Onboarding flow for new cafes. Tenant status monitoring.

**Goal:** Enable platform administrators to create, configure, and monitor multiple tenant instances through a dedicated `/platform` route group.

**Plans:** 7 plans in 4 waves

Plans:
- [x] 60-01-PLAN.md — Database foundation: tenant_status ENUM, platform_admins table, soft delete with pg_cron cleanup
- [x] 60-02-PLAN.md — Platform auth infrastructure: requirePlatformAdmin, MFA middleware, platform layout
- [x] 60-03-PLAN.md — Dashboard UI: landing page with stats, tenant list with search/sort, shadcn components
- [x] 60-04-PLAN.md — Square OAuth integration: authorize and callback routes, Vault credential storage
- [x] 60-05-PLAN.md — Onboarding wizard: multi-step form (basic info → Square OAuth), Server Actions with Zod validation
- [x] 60-06-PLAN.md — Tenant detail and edit: full config display, edit form, updateTenant Server Action
- [x] 60-07-PLAN.md — Lifecycle management: status transitions, soft delete/restore, pg_cron trial expiration

**Testable:** Onboard a new tenant via the platform admin wizard, verify Square OAuth stores credentials, manage tenant status lifecycle, soft delete and restore tenant.

**Verified:** 42/42 must-haves passed. All platform admin features functional. MFA enforcement active. Square OAuth integration complete. TypeScript build clean.

---

## Phase 70: Integration Testing & Hardening ✓
Comprehensive cross-tenant isolation tests. Performance testing with indexes. Security audit of all service-role queries.

**Goal:** Verify multi-tenant isolation through automated E2E tests, audit all service-role queries for explicit tenant filtering, fix localStorage cross-tenant pollution, and ensure module-level caches use tenant-scoped keys.

**Plans:** 7 plans in 1 wave (70-04 through 70-07 are gap closure plans)

Plans:
- [x] 70-01-PLAN.md — E2E testing setup: Playwright installation, multi-tenant isolation tests (menu, checkout, admin)
- [x] 70-02-PLAN.md — Security audits: service-role query audit script, cache audit script, AUDIT_RESULTS.md report
- [x] 70-03-PLAN.md — localStorage fix: tenant-aware localStorage utility, refactor cart hooks, verification documentation
- [x] 70-04-PLAN.md — Gap closure: tenant_id filtering for webhook routes and shared library modules (6 CRITICAL/HIGH files)
- [x] 70-05-PLAN.md — Gap closure: site status cache architecture — per-tenant Map<string, CacheEntry> implementation
- [x] 70-06-PLAN.md — Gap closure: tenant_id filtering for COGS admin routes (15 files) and inventory admin routes (17 files)
- [x] 70-07-PLAN.md — Gap closure: tenant_id filtering for invoice sub-routes (11), purchase order routes (8), supplier routes (3), customer routes (2), check-role (1)

**Testable:** Full E2E flow: two tenants, independent orders, payments, admin access. Service-role queries verified. localStorage isolation confirmed. Security audit shows 0 FAIL findings for non-platform routes.

**Verified:** 12/12 must-haves passed. Service-role audit 79 PASS / 3 false-positive FAILs (documented). localStorage isolation active. Site status cache per-tenant. All 64 original FAIL findings remediated.

---

## Phase 80: Critical Checkout & Settings Fixes ✓
Gap closure from v1.0 audit — 2 of 4 SC1 blockers.

**Goal:** Fix the two data-correctness bugs that silently break multi-tenant operation: orders inserted without `tenant_id` (checkout attribution bug) and `site_settings` PK collision that prevents second-tenant maintenance-mode saves.

**Gap Closure:**
- GAP-1: `process-payment/route.ts` — add `tenant_id: tenantId` to orders and order_items INSERT payloads; switch to `createTenantClient` so RLS applies
- GAP-3: `site_settings` — change PK from `integer DEFAULT 1` to `uuid DEFAULT gen_random_uuid()`; add `UNIQUE(tenant_id)` constraint; change INSERT to upsert on `tenant_id`

**Plans:** 2 plans

Plans:
- [x] 80-01-PLAN.md — GAP-1: add tenant_id to orders/order_items INSERTs and switch to createTenantClient in process-payment route
- [x] 80-02-PLAN.md — GAP-3: migration to replace site_settings integer PK with uuid PK + UNIQUE(tenant_id); update SiteSettings TypeScript type

**Verified:** 9/9 must-haves passed. Checkout orders stamped with tenant_id. site_settings uses uuid PK with UNIQUE(tenant_id). TypeScript build clean.

---

## Phase 85: Multi-Tenant Schema Constraint Migration
Gap closure from v1.0 audit — final SC1 blocker.

**Goal:** Replace single-column UNIQUE constraints with composite `(tenant_id, field)` constraints across 12 tables (plus cogs_sellable_aliases) so two tenants can simultaneously store data with the same names/codes without conflicts. Update all ON CONFLICT upsert clauses in app code and scripts to reference the new composite constraints.

**Gap Closure:**
- GAP-2: Tables affected — `kds_settings` (key), `kds_images` (filename), `kds_menu_items` (square_variation_id), `cogs_products` (square_item_id, product_code), `cogs_sellables` (square_variation_id), `cogs_sellable_aliases` (square_variation_id), `cogs_modifier_sets` (square_modifier_list_id), `cogs_modifier_options` (square_modifier_id), `inventory_items` (square_item_id + pack_size composite), `suppliers` (name), `inventory_unit_types` (name, symbol), `purchase_orders` (order_number)

**Plans:** 4 plans

Plans:
- [ ] 85-01-PLAN.md — KDS domain DDL: composite constraints for kds_settings, kds_images, kds_menu_items
- [ ] 85-02-PLAN.md — COGS/Square domain DDL: composite constraints for cogs_products, cogs_sellables, cogs_sellable_aliases, cogs_modifier_sets, cogs_modifier_options
- [ ] 85-03-PLAN.md — Operational domain DDL: composite constraints for inventory_items, suppliers, inventory_unit_types, purchase_orders
- [ ] 85-04-PLAN.md — App code: update ON CONFLICT strings in src/ routes, src/lib/kds/queries.ts, and scripts/; add tenant_id to script upsert payloads

---

## Phase 90: Platform Completion & Security Hardening
Gap closure from v1.0 audit — SC4 blocker + 2 security gaps + CSRF tech debt.

**Goal:** Complete the tenant onboarding flow (new tenant admins can actually log in), lock down the platform control plane (OAuth callback and Server Actions require authentication), and verify CSRF protection on the Square OAuth flow.

**Gap Closure:**
- GAP-4: Implement admin user creation in `createTenant()` — call Supabase Admin API `inviteUserByEmail()`, insert `tenant_memberships` row with `role = 'owner'`
- SEC-1: Add `requirePlatformAdmin()` to OAuth callback route; implement CSRF state token server-side verification
- SEC-2: Add `requirePlatformAdmin()` to all 5 Platform Server Actions (`createTenant`, `updateTenant`, `changeStatus`, `deleteTenant`, `restoreTenant`)

**Plans:** TBD
