---
phase: 20-schema-migration
plan: 01
subsystem: data
tags: [postgresql, migration, tenant-id, multi-tenant, schema]

# Dependency graph
requires: [phase-10]         # tenants table and default tenant seed
provides: [tenant_id-columns, rollback-script]
affects: [20-02, 20-03]     # Stage 2 constraints and Stage 3 indexes depend on columns existing

# Tech tracking
tech-stack:
  added: []
  patterns: [metadata-only-alter, idempotent-migration, tiered-fk-ordering]

# File tracking
key-files:
  created:
    - supabase/migrations/20260213200000_add_tenant_id_columns.sql
    - supabase/migrations/20260213200099_rollback_tenant_id.sql
  modified: []

# Decisions
decisions:
  - id: DEC-20-01
    choice: "48 tables get tenant_id (not 46)"
    rationale: "Research found 48 tenant-scoped tables when walking full FK dependency tree; CONTEXT listed 46 as early estimate"
  - id: DEC-20-02
    choice: "ADD COLUMN IF NOT EXISTS for idempotency"
    rationale: "Safe to re-run if migration is applied twice; no error on duplicate column"
  - id: DEC-20-03
    choice: "Rollback file stored as migration 20260213200099 but NOT applied"
    rationale: "Keeps rollback co-located with forward migration for easy discovery; high timestamp suffix prevents accidental application"

# Metrics
metrics:
  duration: ~5 minutes
  completed: 2026-02-13
---

# Phase 20 Plan 01: Add Tenant ID Columns Summary

**One-liner:** Added tenant_id uuid column with DEFAULT to all 48 tenant-scoped tables using PostgreSQL metadata-only ALTER, plus a full rollback script

## What Shipped

- Stage 1 forward migration: `tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'` added to all 48 tenant-scoped tables
- Rollback script: `DROP COLUMN IF EXISTS tenant_id` for all 48 tables, stored for manual use only
- Tables organized by FK dependency tier (Tier 0-3) for documentation clarity
- Migration applied to dev database (`ofppjltowsdvojixeflr`) and verified:
  - All 48 tables have `tenant_id` column
  - Zero NULL values across all tables
  - Row counts unchanged after migration
  - All existing rows read default tenant UUID on access

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 48 tables (not 46 from CONTEXT) | Full FK tree walk in research found 48 tenant-scoped tables | Plan's explicit 48-table list used as authoritative source |
| IF NOT EXISTS / IF EXISTS guards | Idempotent migrations safe to re-run without error | Both files use conditional DDL |
| Rollback as migration file (high timestamp) | Co-located with forward migration for discoverability | `20260213200099` suffix clearly separates it from the sequence |

## Deviations from Plan

None -- plan executed as written.

## Follow-ups

- **Stage 2 (20-02):** Add NOT NULL and FK constraints to all 48 tenant_id columns
- **Stage 3 (20-03):** Add btree indexes on tenant_id, verify build, smoke test
- **Unique constraint migration:** 15+ tables have single-column UNIQUE constraints that will block multi-tenant data (documented in research as Pitfall 3); must be addressed in a later phase
- **site_settings singleton pattern:** `id = 1` PK will conflict when a second tenant needs its own row; deferred to Phase 30+

## Next Phase Readiness

- [x] All 48 tables have tenant_id column with DEFAULT
- [x] Zero NULLs -- safe for Stage 2 NOT NULL constraint
- [x] Default tenant UUID matches `tenants.id` -- safe for Stage 2 FK constraint
- [ ] Stage 2 migration (20-02) ready to plan/execute
