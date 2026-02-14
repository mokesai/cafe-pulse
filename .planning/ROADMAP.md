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

## Phase 20: Schema Migration — Add tenant_id
Add `tenant_id uuid` column to all 48 tenant-scoped tables. Backfill all existing rows with default tenant UUID. Add NOT NULL constraints, FK constraints, and btree indexes.

**Goal:** All existing data has tenant_id set. Schema enforces referential integrity. App still works unchanged on the default tenant.

**Deliverables:**
- [ ] Migration: add `tenant_id uuid DEFAULT '...-0001'` to all 48 tables
- [ ] Migration: add NOT NULL + FK constraints to all 48 tables
- [ ] Migration: add btree indexes on tenant_id for all 48 tables

**Plans:** 3 plans

Plans:
- [ ] 20-01-add-tenant-columns-PLAN.md — Stage 1: add tenant_id columns with DEFAULT to all 48 tables + rollback script
- [ ] 20-02-add-constraints-PLAN.md — Stage 2: add NOT NULL and FK constraints to all 48 tables
- [ ] 20-03-add-indexes-verify-PLAN.md — Stage 3: add btree indexes + build verification + smoke test

**Testable:** All existing data has `tenant_id` set. App still works on default tenant.

---

## Phase 30: RLS Policy Rewrite
Rewrite all Row Level Security policies to include `tenant_id = current_setting('app.tenant_id')::uuid`. Update admin policies to check `tenant_memberships` instead of `profiles.role`.

**Deliverables:**
- [ ] All RLS policies rewritten with tenant scoping
- [ ] Admin policies use `tenant_memberships` table
- [ ] Service role queries explicitly filter by `tenant_id`

**Testable:** Create two test tenants. Query from tenant A returns zero rows from tenant B.

---

## Phase 40: Tenant-Aware Square Integration
Refactor Square client to factory pattern. Load credentials from `tenants` table per request. Update `/api/square/config` to return tenant-specific config.

**Deliverables:**
- [ ] `createTenantSquareClient(tenantConfig)` factory
- [ ] `fetch-client.ts` parameterized (no more env var reads)
- [ ] `/api/square/config` returns tenant-specific credentials
- [ ] Webhook handlers resolve tenant from `merchant_id`

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
