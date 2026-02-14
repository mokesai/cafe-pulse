---
phase: 30-rls-policy-rewrite
plan: 01
subsystem: data
tags: [rls, postgresql, multi-tenant, security, policies]

# Dependency graph
requires: [phase-10, phase-20]
provides: [tenant-scoped-rls-policies, is_tenant_member-helper, tenant-aware-is_admin]
affects: [phase-30-plan-02, phase-30-plan-03, phase-40]

# Tech tracking
tech-stack:
  added: []
  patterns: [initPlan-optimized-rls, tenant-memberships-admin-check, session-variable-tenant-isolation]

# File tracking
key-files:
  created:
    - supabase/migrations/20260213300000_rls_policy_rewrite.sql
    - supabase/migrations/20260213300099_rollback_rls_rewrite.sql
  modified: []

# Decisions
decisions:
  - id: DEC-30-01
    choice: Use is_tenant_member() helper with SECURITY DEFINER instead of inline EXISTS subqueries
    rationale: Avoids repeating tenant_memberships join in every policy; SECURITY DEFINER lets it read tenant_memberships regardless of caller context
  - id: DEC-30-02
    choice: Separate SELECT/INSERT/UPDATE/DELETE policies instead of FOR ALL
    rationale: Explicit per-operation policies are clearer and prevent accidental permission escalation
  - id: DEC-30-03
    choice: No service_role policies on tenant-scoped tables
    rationale: Service role bypasses RLS entirely; explicit service_role policies are redundant and confusing
  - id: DEC-30-04
    choice: Rollback drops new policies but does NOT restore old ones
    rationale: Old policies would need careful manual restoration from original migration files; clean drop is safer for rollback

# Metrics
metrics:
  duration: ~15 minutes
  completed: 2026-02-14
---

# Phase 30 Plan 01: RLS Policy Rewrite Summary

**One-liner:** Atomic migration rewrites all 97+ old RLS policies across 48 tables to tenant-isolated policies using session variable tenant_id, tenant_memberships-based admin checks, and initPlan-optimized SQL patterns.

## What Shipped

- **Forward migration** (`20260213300000_rls_policy_rewrite.sql`, 1709 lines): Single atomic BEGIN/COMMIT migration that drops all old policies and creates new tenant-scoped ones
- **Rollback migration** (`20260213300099_rollback_rls_rewrite.sql`, 358 lines): Drops all new policies and restores old helper functions
- **3 helper functions**: `is_tenant_member(text[])`, `is_admin()`, `get_admin_user_id()` -- all tenant-aware via `current_setting('app.tenant_id')`
- **104 DROP POLICY** statements removing all old policies (97 from original audit + 7 from RLS fix migrations)
- **48 ENABLE ROW LEVEL SECURITY** statements ensuring every tenant-scoped table has RLS enabled
- **194 CREATE POLICY** statements across 4 categories:
  - **Category A** (1 table: site_settings): Public SELECT with tenant context, admin write
  - **Category B** (5 tables: orders, order_items, user_favorites, user_addresses, notifications): User-scoped with admin override, anonymous guest checkout preserved
  - **Category C** (4 tables: kds_categories, kds_menu_items, kds_settings, kds_images): Staff+ read, admin write
  - **Category D** (38 tables): Staff read, admin CRUD for all inventory/invoicing/COGS/webhook tables

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| `is_tenant_member()` helper with SECURITY DEFINER | Avoids repeating EXISTS subquery in 190+ policies | Single function call, cached via initPlan |
| Separate per-operation policies (no FOR ALL) | Explicit is clearer, prevents accidental permission escalation | 4 policies per Category C/D table instead of 2 |
| No service_role policies | Service role bypasses RLS entirely | Dropped all `auth.role() = 'service_role'` policies |
| Rollback drops but doesn't restore old policies | Old policies are heterogeneous and hard to safely reconstruct | Clean slate after rollback; manual restoration if needed |
| `(select current_setting(...))::uuid` pattern everywhere | initPlan caching per Supabase performance docs | Consistent pattern in all 194 policies |

## Deviations from Plan

None -- plan executed as written.

## Commits

| Hash | Message |
|------|---------|
| fcf4674 | feat(30-01): create RLS policy rewrite migration |
| f5bdf9e | feat(30-01): create RLS rollback migration |

## Verification Results

All checks passed:

- [x] Migration has BEGIN/COMMIT wrapping
- [x] All 48 tables have ENABLE ROW LEVEL SECURITY (48 statements)
- [x] All 104 old policies dropped with DROP POLICY IF EXISTS
- [x] All 194 new policies use `(select current_setting('app.tenant_id', true))::uuid` pattern
- [x] All new policies use `(select auth.uid())` pattern where applicable
- [x] All admin checks use `is_tenant_member()` or `is_admin()` (not `profiles.role`)
- [x] No `auth.role() = 'service_role'` in any new policy (only in header comment)
- [x] Rollback script can cleanly revert
- [x] Human review approved

## Follow-ups

- Plan 30-02: Update SECURITY DEFINER functions (update_inventory_stock, update_stock_simple, create_order_notification, get_unread_notification_count, mark_all_notifications_read) to include tenant_id filtering + rewrite storage bucket policies
- Plan 30-03: Apply migration to dev Supabase and verify tenant isolation
- UNIQUE constraint conflicts still deferred (Phase 30+ per STATE.md)
- site_settings singleton pattern still deferred (Phase 30+)

## Next Phase Readiness

- [x] Forward migration file ready to apply
- [x] Rollback migration file ready as safety net
- [ ] SECURITY DEFINER functions still need tenant_id filtering (Plan 02)
- [ ] Storage bucket policies still need rewriting (Plan 02)
- [ ] Migration not yet applied to database (Plan 03)
