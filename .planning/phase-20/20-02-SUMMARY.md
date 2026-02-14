---
phase: 20-schema-migration
plan: 02
subsystem: data
tags: [postgresql, migration, constraints, foreign-key, not-null, multi-tenant]

# Dependency graph
requires: [20-01]           # Stage 1 columns must exist with DEFAULT-backfilled data
provides: [tenant_id-constraints, referential-integrity]
affects: [20-03]            # Stage 3 indexes build on constrained columns

# Tech tracking
tech-stack:
  added: []
  patterns: [transactional-ddl, fk-on-delete-restrict, tiered-constraint-ordering]

# File tracking
key-files:
  created:
    - supabase/migrations/20260213200001_add_tenant_id_constraints.sql
  modified: []

# Decisions
decisions:
  - id: DEC-20-04
    choice: "Single transaction wraps all 96 ALTER statements"
    rationale: "No CONCURRENTLY operations involved, so BEGIN/COMMIT ensures all-or-nothing application"
  - id: DEC-20-05
    choice: "ON DELETE RESTRICT for all FK constraints"
    rationale: "Prevents accidental tenant deletion; tenant removal must be an explicit multi-step process"
  - id: DEC-20-06
    choice: "FK naming convention: fk_{table_name}_tenant"
    rationale: "Consistent, predictable names for querying and future migrations"

# Metrics
metrics:
  duration: ~8 minutes
  completed: 2026-02-13
---

# Phase 20 Plan 02: Add Constraints Summary

**One-liner:** Added NOT NULL and FOREIGN KEY constraints to tenant_id on all 48 tenant-scoped tables, enforcing referential integrity to the tenants table with ON DELETE RESTRICT

## What Shipped

- Stage 2 migration: 48 NOT NULL constraints ensuring no row can have empty tenant_id
- Stage 2 migration: 48 FK constraints referencing `tenants(id)` with ON DELETE RESTRICT
- All 96 ALTER statements wrapped in a single transaction for atomic application
- Migration applied to dev database (`ofppjltowsdvojixeflr`) via Supabase MCP tools and verified:
  - All 48 tables show `is_nullable = 'NO'` for tenant_id in information_schema
  - All 48 FK constraints confirmed via information_schema (all reference `tenants` table)
  - NULL insert rejected by NOT NULL constraint
  - Invalid tenant_id insert rejected by FK constraint

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single transaction for all DDL | No CONCURRENTLY ops, so transaction is safe and provides all-or-nothing | BEGIN/COMMIT wraps all 96 statements |
| ON DELETE RESTRICT | Tenant deletion must be explicit multi-step process | FK prevents accidental cascade |
| fk_{table}_tenant naming | Consistent, queryable constraint names | All 48 constraints follow pattern |

## Deviations from Plan

None -- plan executed as written.

## Follow-ups

- **Stage 3 (20-03):** Add btree indexes on tenant_id for query performance
- **Unique constraint migration:** 15+ tables have single-column UNIQUE constraints that will need tenant_id added for multi-tenant isolation (deferred to later phase)
- **site_settings singleton:** `id = 1` PK pattern conflicts with multi-tenant; deferred to Phase 30+

## Next Phase Readiness

- [x] All 48 tables have NOT NULL on tenant_id
- [x] All 48 tables have FK to tenants(id) ON DELETE RESTRICT
- [x] Constraint enforcement verified with test inserts
- [ ] Stage 3 migration (20-03) ready to plan/execute -- indexes
