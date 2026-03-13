---
phase: 85-multi-tenant-schema-constraints
plan: 04
subsystem: data
tags: [supabase, upsert, onConflict, multi-tenant, kds, cogs, scripts]

# Dependency graph
requires:
  - 85-01
  - 85-02
  - 85-03
provides:
  - App-layer ON CONFLICT clauses aligned with composite (tenant_id, field) DB constraints
  - Scripts include tenant_id in upsert payloads for composite constraints
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Composite onConflict strings (tenant_id,field) match DB composite unique indexes
    - DEFAULT_TENANT_ID constant in scripts for backward-compatible single-tenant operation

# File tracking
key-files:
  created: []
  modified:
    - src/lib/kds/queries.ts
    - src/app/api/admin/cogs/catalog/sync-square/route.ts
    - scripts/seed-cogs-recipes.ts
    - scripts/simulate-cogs-sales.ts
    - scripts/import-kds-menu-from-sheets.js

# Decisions
decisions:
  - id: DEC-01
    choice: Add DEFAULT_TENANT_ID constant to scripts rather than a CLI flag
    rationale: Scripts are single-tenant scripts for the default Little Cafe tenant; adding a full tenant resolution mechanism would be over-engineering for scripts that seed dev/test data
  - id: DEC-02
    choice: tenantId as a default-parameter on seedModifierRecipes and seedCogsCatalogForSimulator
    rationale: Preserves backward-compatible call sites (no callers need to be updated), but makes the tenant scope explicit and extensible if a multi-tenant script use case arises

# Metrics
metrics:
  duration: 25 minutes
  completed: 2026-02-16
---

# Phase 85 Plan 04: App-Layer ON CONFLICT Clause Updates Summary

**One-liner:** Five application files updated so Supabase upsert calls reference the new composite (tenant_id, field) unique indexes created in 85-01/02/03; three scripts also gain tenant_id in their upsert row payloads.

## What Shipped

- `src/lib/kds/queries.ts`: Three upsert onConflict strings updated — kds_menu_items (`tenant_id,square_variation_id`), kds_images (`tenant_id,filename`), kds_settings (`tenant_id,key`); kds_categories `slug` unchanged
- `src/app/api/admin/cogs/catalog/sync-square/route.ts`: Two upsert onConflict strings updated — cogs_products (`tenant_id,square_item_id`), cogs_sellables (`tenant_id,square_variation_id`); tenant_id was already in both payloads from Phase 70-06
- `scripts/seed-cogs-recipes.ts`: DEFAULT_TENANT_ID constant added; `seedModifierRecipes` signature extended with `tenantId` default param; cogs_modifier_sets and cogs_modifier_options upserts now include `tenant_id` in payload and composite onConflict strings
- `scripts/simulate-cogs-sales.ts`: DEFAULT_TENANT_ID constant added; `seedCogsCatalogForSimulator` signature extended with `tenantId` default param; cogs_products and cogs_sellables upserts now include `tenant_id` in payload and composite onConflict strings
- `scripts/import-kds-menu-from-sheets.js`: DEFAULT_TENANT_ID constant added; `transformImage` and `transformSetting` now return `tenant_id` in object; kds_images and kds_settings upserts use composite onConflict strings; kds_categories unchanged
- TypeScript build passes with zero errors in src/ and scripts/ directories

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| DEFAULT_TENANT_ID constant in scripts | Scripts target single default tenant; full CLI resolution unnecessary | Clean backward compatibility, no call-site changes needed |
| Default parameter on helper functions | Preserves existing call signatures while adding tenant scoping | Both scripts work without any changes at call site in main() |

## Deviations from Plan

None — plan executed as written.

## Authentication Gates

None.

## Follow-ups

- None — this completes Phase 85 GAP-2 remediation. All composite DB constraints (85-01/02/03) now have matching app-layer onConflict strings.

## Next Phase Readiness

- [x] All five files have composite onConflict strings matching 85-01/02/03 DB constraints
- [x] Scripts include tenant_id in upsert payloads — no more missing-column errors after DDL migrations
- [x] TypeScript build clean
- [x] Phase 85 complete — all four plans delivered
