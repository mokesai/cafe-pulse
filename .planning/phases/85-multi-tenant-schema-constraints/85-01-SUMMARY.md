---
phase: 85-multi-tenant-schema-constraints
plan: 01
subsystem: database
tags: [postgresql, unique-constraints, multi-tenant, kds, migration]

# Dependency graph
requires:
  - 20-multi-tenant-columns       # tenant_id columns added to all tables
  - 30-rls-policies               # RLS using tenant_id
affects:
  - 85-02                         # COGS domain composite constraints (next plan)
  - 85-03                         # Operational domain composite constraints
  - 85-04                         # ON CONFLICT clause updates in app/scripts

provides:
  - Composite UNIQUE(tenant_id, key) on kds_settings
  - Composite UNIQUE(tenant_id, filename) on kds_images
  - Composite partial index (tenant_id, square_variation_id) on kds_menu_items

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite (tenant_id, field) UNIQUE constraints replacing single-column constraints for multi-tenant isolation"
    - "DROP INDEX + CREATE UNIQUE INDEX pattern for partial index replacement"

# File tracking
key-files:
  created:
    - supabase/migrations/20260217000000_composite_kds_unique_constraints.sql
  modified: []

# Decisions
decisions:
  - id: DEC-85-01-01
    choice: "Use ALTER TABLE DROP CONSTRAINT for inline UNIQUE constraints and DROP INDEX for index-based UNIQUE constraints"
    rationale: "kds_settings.key was defined as inline UNIQUE (generates kds_settings_key_key), kds_images.filename was a named CONSTRAINT, kds_menu_items.square_variation_id was a CREATE UNIQUE INDEX partial index — each requires a different drop command"
  - id: DEC-85-01-02
    choice: "Preserve partial index (WHERE square_variation_id IS NOT NULL) on kds_menu_items composite replacement"
    rationale: "NULL variation IDs are valid for menu items not linked to Square; partial index avoids false uniqueness conflicts on null values"

# Metrics
metrics:
  duration: "2 minutes"
  completed: 2026-02-17
---

# Phase 85 Plan 01: KDS Domain Composite Unique Constraints Summary

**One-liner:** Replaced three KDS single-column UNIQUE constraints with composite (tenant_id, field) constraints so two tenants can independently manage KDS settings, images, and menu items with the same keys/filenames/variation IDs.

## What Shipped

- Migration `20260217000000_composite_kds_unique_constraints.sql` written and applied to dev Supabase
- `kds_settings`: dropped `kds_settings_key_key`, added `kds_settings_tenant_key_unique UNIQUE(tenant_id, key)`
- `kds_images`: dropped `kds_images_filename_unique`, added `kds_images_tenant_filename_unique UNIQUE(tenant_id, filename)`
- `kds_menu_items`: dropped `idx_kds_menu_items_square_variation_id_unique`, created `idx_kds_menu_items_tenant_variation_unique ON (tenant_id, square_variation_id) WHERE square_variation_id IS NOT NULL`
- Migration wrapped in single BEGIN/COMMIT transaction
- `npm run db:migrate` completed without errors

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use `ALTER TABLE DROP CONSTRAINT` for inline/named constraints, `DROP INDEX` for index-based unique | kds_settings used inline UNIQUE (auto-named `_key_key`), kds_images had named CONSTRAINT, kds_menu_items used CREATE UNIQUE INDEX | Correct SQL syntax for each constraint type |
| Preserve `WHERE square_variation_id IS NOT NULL` partial condition on kds_menu_items replacement | NULL variation IDs are valid for items not linked to Square; partial index avoids false uniqueness conflicts | Index only enforces uniqueness when variation ID is present |

## Deviations from Plan

### Pre-existing migration files applied incidentally

During `npm run db:migrate`, two additional migration files (`20260217100000_composite_cogs_unique_constraints.sql` and `20260217200000_composite_operational_unique_constraints.sql`) were present in the migrations directory from a prior planning session. Both were applied to the database as part of this push.

- These files belong to plans 85-02 and 85-03 respectively
- Both files contain correct DDL consistent with the research findings
- Applied without errors
- No action required; plans 85-02 and 85-03 will verify their respective migrations were applied correctly
- Tracked here as context, not as a problem

## Authentication Gates

None.

## Next Phase Readiness

- Plan 85-02 (COGS domain composite constraints) migration `20260217100000` was already applied to the database incidentally — plan 85-02 should verify constraints exist and proceed to any remaining steps (ON CONFLICT clause updates)
- Plan 85-03 (Operational domain composite constraints) migration `20260217200000` was similarly applied
- Plan 85-04 (ON CONFLICT clause updates in app code and scripts) remains the critical next step to prevent runtime failures when upsert operations run

## Follow-ups

- `src/lib/kds/queries.ts` upsert ON CONFLICT clauses need updating to `tenant_id,key`, `tenant_id,filename`, and `tenant_id,square_variation_id` (addressed in plan 85-04)
- `scripts/import-kds-menu-from-sheets.js` upsert ON CONFLICT clauses need updating (addressed in plan 85-04)
