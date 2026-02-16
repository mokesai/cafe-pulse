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

## Phase 60: Platform Control Plane

Build the super-admin interface for managing tenants. Onboarding flow for new cafes. Tenant status monitoring.

**Goal:** Enable platform administrators to create, configure, and monitor multiple tenant instances through a dedicated `/platform` route group.

**Plans:** 7 plans in 4 waves

Plans:
- [ ] 60-01-PLAN.md — Database foundation: tenant_status ENUM, platform_admins table, soft delete with pg_cron cleanup
- [ ] 60-02-PLAN.md — Platform auth infrastructure: requirePlatformAdmin, MFA middleware, platform layout
- [ ] 60-03-PLAN.md — Dashboard UI: landing page with stats, tenant list with search/sort, shadcn components
- [ ] 60-04-PLAN.md — Square OAuth integration: authorize and callback routes, Vault credential storage
- [ ] 60-05-PLAN.md — Onboarding wizard: multi-step form (basic info → Square OAuth), Server Actions with Zod validation
- [ ] 60-06-PLAN.md — Tenant detail and edit: full config display, edit form, updateTenant Server Action
- [ ] 60-07-PLAN.md — Lifecycle management: status transitions, soft delete/restore, pg_cron trial expiration

**Testable:** Onboard a new tenant via the platform admin wizard, verify Square OAuth stores credentials, manage tenant status lifecycle, soft delete and restore tenant.

---

## Phase 70: Integration Testing & Hardening
Comprehensive cross-tenant isolation tests. Performance testing with indexes. Security audit of all service-role queries.

**Deliverables:**
- [ ] Cross-tenant isolation test suite
- [ ] Service-role query audit (all explicitly filter by tenant_id)
- [ ] localStorage key prefixing verified
- [ ] Module-level cache audit (no cross-tenant pollution)

**Testable:** Full E2E flow: two tenants, independent orders, payments, admin access.
