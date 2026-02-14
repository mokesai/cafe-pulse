# Project State

## Current Status: Phase 30 In Progress
## Current Milestone: 1.0 - Multi-Tenant MVP
## Current Phase: 30 — RLS Policy Rewrite
## Last Updated: 2026-02-14
## Branch: features/multi-tenant-saas

## Progress

Phase: 30 of 70 (RLS Policy Rewrite)
Plan: 1 of 3 in Phase 30
Status: In progress

Progress: █████░░░░░ Phase 10 complete, Phase 20 complete, Phase 30 plan 1/3

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

### Decisions Made
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

### Known Issues
- 15+ tables have single-column UNIQUE constraints that will block multi-tenant data (deferred to Phase 30+)
- site_settings singleton pattern (`id = 1`) will conflict with second tenant (deferred to Phase 30+)
- Database views need tenant_id filtering (deferred to Phase 30)
- DEFAULT on tenant_id to be removed in Phase 40
- 5 SECURITY DEFINER functions need tenant_id filtering (Plan 30-02)
- Storage bucket policies need rewriting (Plan 30-02)

## Session Continuity

Last session: 2026-02-14
Stopped at: Completed 30-01-rls-policy-rewrite-PLAN.md
Resume file: None

## Next Action
Execute Phase 30 Plan 02 — SECURITY DEFINER functions + storage policies
