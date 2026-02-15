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

## Phase 40: Tenant-Aware Square Integration
Refactor Square client to parameterized pattern with Vault-encrypted credential storage. Load credentials per-tenant per-request. Eliminate all env var reads for Square credentials.

**Goal:** Every Square API call uses the correct tenant's credentials loaded from Supabase Vault (with env var fallback for default tenant). Webhooks resolve tenant from merchant_id. Frontend config is server-rendered.

**Plans:** 11 plans

Plans:
- [ ] 40-01-PLAN.md — Vault infrastructure: migration, SECURITY DEFINER functions, audit table, merchant_id index
- [ ] 40-02-PLAN.md — SquareConfig type and credential loading layer (getTenantSquareConfig)
- [ ] 40-03-PLAN.md — Parameterize fetch-client.ts (all 15 functions accept SquareConfig)
- [ ] 40-04-PLAN.md — Update domain layers (catalog.ts, orders.ts, tax-validation.ts, customers.ts)
- [ ] 40-05-PLAN.md — Update customer-facing API routes (menu, config, payment, order-preview)
- [ ] 40-06-PLAN.md — Update 7 admin API routes with inline Square env vars
- [ ] 40-07-PLAN.md — Webhook tenant resolution via merchant_id
- [ ] 40-08-PLAN.md — Frontend config delivery: server-rendered props replace client-side fetch
- [ ] 40-09-PLAN.md — Dead code cleanup: remove client.ts, simple-client.ts, and consumer routes
- [ ] 40-10-PLAN.md — Tenant-flag support for setup scripts (sync-square-catalog, seed-inventory, setup-square-webhooks)
- [ ] 40-11-PLAN.md — Gap closure: fix menu categories and items admin routes (missed in 40-06)

**Testable:** Two tenants with different Square sandbox accounts show different catalogs.

---

## Phase 50: Tenant-Aware Auth & Business Identity
Overhaul admin auth to use `tenant_memberships`. Replace hardcoded business info with per-tenant config. Make email templates tenant-aware.

**Deliverables:**
- [ ] `requireAdmin()` checks tenant membership
- [ ] Business identity loaded from `tenants` table (not constants)
- [ ] Email sender/branding per tenant
- [ ] `TenantProvider` React context for client components

**Testable:** Admin login on tenant A cannot access tenant B data. Emails show correct branding.

---

## Phase 60: Platform Control Plane
Build the super-admin interface for managing tenants. Onboarding flow for new cafes. Tenant status monitoring.

**Deliverables:**
- [ ] `src/app/platform/` route group with platform auth
- [ ] Tenant list, create, edit pages
- [ ] New tenant onboarding wizard
- [ ] Tenant status dashboard

**Testable:** Onboard a new tenant via the platform admin and verify it works end-to-end.

---

## Phase 70: Integration Testing & Hardening
Comprehensive cross-tenant isolation tests. Performance testing with indexes. Security audit of all service-role queries.

**Deliverables:**
- [ ] Cross-tenant isolation test suite
- [ ] Service-role query audit (all explicitly filter by tenant_id)
- [ ] localStorage key prefixing verified
- [ ] Module-level cache audit (no cross-tenant pollution)

**Testable:** Full E2E flow: two tenants, independent orders, payments, admin access.
