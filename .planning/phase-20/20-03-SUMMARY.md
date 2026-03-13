---
phase: 20-schema-migration
plan: 03
subsystem: data
tags: [postgresql, migration, indexes, btree, multi-tenant, performance, verification]

# Dependency graph
requires: [20-01, 20-02]       # Columns and constraints must exist before indexing
provides: [tenant_id-indexes, phase-20-complete]
affects: [phase-30]            # RLS policies will use these indexes for performant tenant filtering

# Tech tracking
tech-stack:
  added: []
  patterns: [btree-index-per-tenant-column, if-not-exists-idempotency]

# File tracking
key-files:
  created:
    - supabase/migrations/20260213200002_add_tenant_id_indexes.sql
  modified: []

# Decisions
decisions:
  - id: DEC-20-07
    choice: "Regular CREATE INDEX instead of CREATE INDEX CONCURRENTLY"
    rationale: "CONCURRENTLY cannot run inside transaction blocks; dev database has no production traffic to block. CONCURRENTLY should be used for eventual production migration."
  - id: DEC-20-08
    choice: "IF NOT EXISTS for all index creation"
    rationale: "Idempotent; safe to re-run without error if indexes already exist"
  - id: DEC-20-09
    choice: "Hand-crafted types kept as-is (db:generate informational only)"
    rationale: "Project uses hand-crafted TypeScript types in src/types/, not auto-generated from schema. Adding columns does not affect existing type definitions."

# Metrics
metrics:
  duration: ~10 minutes
  completed: 2026-02-13
---

# Phase 20 Plan 03: Add Indexes and Verify Summary

**One-liner:** Added 48 btree indexes on tenant_id for RLS query performance, verified full Phase 20 migration (column + NOT NULL + FK + index) across all 48 tables, and confirmed clean build

## What Shipped

- Stage 3 migration: 48 btree indexes on tenant_id using `idx_{table}_tenant_id` naming convention
- All indexes created with IF NOT EXISTS for idempotent re-runs
- Migration applied to dev database (`ofppjltowsdvojixeflr`) and verified:
  - 48 indexes confirmed valid via `pg_index` query (all `indisvalid = true`)
  - Zero invalid indexes in the database
  - Comprehensive verification: all 48 tables show OK/OK/OK for NOT NULL, FK constraint, and index
- Build verification: `npm run build` compiles successfully with no TypeScript errors
- Lint verification: `npm run lint` passes with zero warnings or errors
- Type generation note: `npm run db:generate` requires Docker (local mode); types are hand-crafted and unaffected by schema changes

## Phase 20 Complete: Full Migration Summary

All three stages of the Phase 20 schema migration are now complete:

| Stage | Plan | What | Verified |
|-------|------|------|----------|
| Stage 1 | 20-01 | tenant_id columns with DEFAULT on 48 tables | Zero NULLs, all rows backfilled |
| Stage 2 | 20-02 | NOT NULL + FK constraints on 48 tables | Constraint enforcement tested |
| Stage 3 | 20-03 | btree indexes on 48 tables | All 48 valid, comprehensive OK/OK/OK |

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Regular CREATE INDEX (not CONCURRENTLY) | Dev DB has no production traffic; CONCURRENTLY cannot run in transaction blocks | Simpler execution, same result for dev |
| IF NOT EXISTS idempotency | Safe to re-run without error | Consistent with Stage 1 and Stage 2 patterns |
| Keep hand-crafted TypeScript types | db:generate outputs to stdout and requires Docker; types in src/types/ are manually maintained | No type file changes needed |

## Deviations from Plan

None -- plan executed as written.

## Known Limitations (for future phases)

- **15+ UNIQUE constraints** need conversion to composite `(tenant_id, col)` for multi-tenant isolation -- Phase 30+
- **site_settings singleton** (`id = 1` PK) conflicts with second tenant -- Phase 30+
- **Database views** `po_supplier_metrics_v` and `view_pending_manual_inventory_deductions` need tenant_id filtering -- Phase 30
- **DEFAULT on tenant_id** to be removed in Phase 40 (after all application code passes tenant_id explicitly)

## Follow-ups

- **Phase 30:** Add RLS policies using tenant_id indexes for performant row filtering
- **Unique constraint migration:** Convert single-column UNIQUE to composite `(tenant_id, col)` where needed
- **Production migration:** Use CREATE INDEX CONCURRENTLY (outside transactions) for zero-downtime index creation

## Next Phase Readiness

- [x] All 48 tables have tenant_id column with DEFAULT
- [x] All 48 tables have NOT NULL constraint on tenant_id
- [x] All 48 tables have FK to tenants(id) ON DELETE RESTRICT
- [x] All 48 tables have btree index on tenant_id
- [x] Build passes clean (no TypeScript errors)
- [x] Lint passes clean (no warnings)
- [x] Phase 20 schema migration complete -- ready for Phase 30 (RLS policies)
