# Project State

## Current Status: Phase 40 In Progress
## Current Milestone: 1.0 - Multi-Tenant MVP
## Current Phase: 40 — Tenant-Aware Square Integration (IN PROGRESS)
## Last Updated: 2026-02-14
## Branch: features/multi-tenant-saas

## Progress

Phase: 40 of 70 (Tenant-Aware Square Integration)
Plan: 8 of 10 in Phase 40
Status: In progress

Progress: █████████░ Phase 10 complete, Phase 20 complete, Phase 30 complete, Phase 40 started (8/10 plans)

## Completed
- [x] PROJECT.md created
- [x] ROADMAP.md with 7 phases
- [x] Phase 10 researched (10-RESEARCH.md)
- [x] Phase 10 planned — 7 plans across 4 waves
- [x] Phase 10 executed — all 7 plans complete
- [x] Phase 10 verified — 14/14 must-haves passed
- [x] Phase 20 researched (20-RESEARCH.md)
- [x] Phase 20 planned — 3 plans across 3 waves
- [x] 20-01: Stage 1 migration — tenant_id columns added to all 48 tables
- [x] 20-02: Stage 2 migration — NOT NULL + FK constraints on all 48 tables
- [x] 20-03: Stage 3 migration — btree indexes on all 48 tables + full verification
- [x] Phase 30 researched (30-RESEARCH.md)
- [x] Phase 30 planned — 3 plans across 3 waves
- [x] 30-01: RLS policy rewrite migration — 104 old policies dropped, 194 new tenant-scoped policies created across 48 tables
- [x] 30-02: SECURITY DEFINER functions + storage policies — 5 functions updated with tenant_id filtering, 8 storage policies rewritten with tenant_memberships
- [x] 30-03: Apply & verify — all migrations applied to dev Supabase, 202 tenant policies verified, 13 additional old policies cleaned up, app works on default tenant
- [x] Phase 40 researched (40-RESEARCH.md)
- [x] Phase 40 planned — 10 plans across 4 waves
- [x] 40-01: Vault infrastructure — vault_secret_id columns, SECURITY DEFINER credential functions, audit table, merchant_id index
- [x] 40-02: SquareConfig type and credential loading layer — getTenantSquareConfig() with Vault RPC + env fallback, resolveTenantFromMerchantId() for webhooks
- [x] 40-03: Parameterize fetch-client.ts — all 14 functions accept SquareConfig as first parameter, zero env var reads remain
- [x] 40-08: Server-rendered Square config — site layout calls getTenantSquareConfig, DynamicSquareProvider accepts props, CheckoutModal uses context (no env vars)

### Decisions Made
- **Vault with fallback for Square credentials**: New tenants store credentials in Supabase Vault (vault.secrets), default tenant falls back to env vars (Phase 40-01)
- **Owner-only credential access**: Only tenant owners can read/write Square credentials via SECURITY DEFINER functions; API routes use service_role internal function (Phase 40-01)
- **Audit write operations only**: credential_audit_log tracks create/update/delete, not routine reads (Phase 40-01)
- **RPC returns array for RETURNS TABLE**: Supabase RPC for RETURNS TABLE functions returns an array; access via data[0] (Phase 40-02)
- **60-second credential cache TTL**: Matches existing tenant cache TTL for consistency (Phase 40-02)
- **Sandbox as default environment**: Safer default for development; production must be explicit (Phase 40-02)
- **Per-call base URL derivation**: Environment can vary per tenant; base URL must be derived from config at call time, not module level (Phase 40-03)
- **Server-render Square config**: Site layout server-renders config via getTenantSquareConfig and passes to DynamicSquareProvider as props (Phase 40-08)
- **Context-based config delivery**: SquareProvider context extended with applicationId/locationId; descendants use useSquareConfig() hook instead of env vars (Phase 40-08)
- **Graceful degradation for unconfigured tenants**: Null config renders children without SquareProvider wrapper; CheckoutModal shows config error (Phase 40-08)
- **Tenant context via custom header**: Pass `x-tenant-id` header to Supabase client; `db-pre-request` function reads it and calls `set_config('app.tenant_id', ...)`
- **Subdomain routing**: `slug.localhost:3000` for dev (no /etc/hosts needed)
- **Caching**: Follow existing `globalThis` + TTL pattern from `siteSettings.edge.ts`, 60s TTL
- **Credential storage**: Plain columns for now, Vault migration in later phase
- **Default tenant**: Little Cafe seeded with deterministic UUID `00000000-0000-0000-0000-000000000001`
- **Unknown subdomains**: Return 404 (not fallback to default tenant)
- **Feature branch**: All multi-tenant work on `features/multi-tenant-saas` (main reset to pre-Phase 10)
- **48 tenant-scoped tables**: Full FK tree walk identified 48 tables (not 46 from early estimate)
- **Idempotent migrations**: ADD COLUMN IF NOT EXISTS / DROP COLUMN IF EXISTS for safe re-runs
- **ON DELETE RESTRICT for tenant FK**: Prevents accidental tenant deletion; removal must be explicit multi-step
- **Transactional DDL for constraints**: Single BEGIN/COMMIT wraps all 96 ALTER statements for atomic application
- **Regular CREATE INDEX for dev**: Not CONCURRENTLY, since dev DB has no production traffic; CONCURRENTLY for production migration
- **Hand-crafted types preserved**: db:generate is informational; TypeScript types in src/types/ are manually maintained
- **is_tenant_member() helper with SECURITY DEFINER**: Avoids repeating EXISTS subquery in 190+ policies; cached via initPlan
- **Separate per-operation policies (no FOR ALL)**: Explicit SELECT/INSERT/UPDATE/DELETE for clarity and safety
- **No service_role policies on tenant tables**: Service role bypasses RLS entirely; explicit policies are redundant
- **initPlan-optimized patterns**: All policies use `(select current_setting(...))::uuid` and `(select auth.uid())` wrappers
- **Session variable for tenant_id in SECURITY DEFINER functions**: Functions read tenant_id from `current_setting('app.tenant_id')`, not from new parameters; preserves backward compatibility
- **PO attachments SELECT restricted to tenant members**: Previous public read removed; staff/admin/owner only
- **Rollback scripts in supabase/rollback/**: Not in migrations/ to prevent accidental application by `supabase db push`

### Known Issues
- 15+ tables have single-column UNIQUE constraints that will block multi-tenant data (deferred to Phase 40+)
- site_settings singleton pattern (`id = 1`) will conflict with second tenant (deferred to Phase 40+)
- Database views need tenant_id filtering (deferred to Phase 40)
- DEFAULT on tenant_id to be removed in Phase 40
- `db-pre-request` hook not yet configured for `x-tenant-id` header (Phase 40)

## Session Continuity

Last session: 2026-02-14
Stopped at: Completed 40-08-PLAN.md (Server-rendered Square config frontend integration)
Resume file: None

## Next Action
Continue Phase 40 — Plan 40-09: Update remaining components and API routes
