---
phase: 80-critical-checkout-settings-fixes
plan: 02
subsystem: data
tags: [postgresql, migration, typescript, uuid, primary-key, site-settings, multi-tenant]

# Dependency graph
requires:
  - 20-01  # tenant_id columns added to site_settings in Phase 20
  - 70-05  # per-tenant site status cache (siteSettings.edge.ts)
provides:
  - site_settings uuid PK (gen_random_uuid) replacing integer DEFAULT 1
  - UNIQUE(tenant_id) constraint preventing duplicate settings rows per tenant
  - SiteSettings TypeScript interface with id: string and tenant_id: string
affects:
  - 80-03  # any follow-on checkout or settings fixes

# Tech tracking
tech-stack:
  added: []
  patterns:
    - uuid primary keys for multi-tenant tables (replaces integer identity columns)
    - UNIQUE(tenant_id) constraint as single-row-per-tenant enforcement mechanism

# File tracking
key-files:
  created:
    - supabase/migrations/20260216400000_fix_site_settings_pk.sql
  modified:
    - src/types/settings.ts

# Decisions
decisions:
  - id: DEC-80-02-01
    choice: Add uuid column, drop PK, drop old column, rename — rather than ALTER COLUMN type
    rationale: PostgreSQL does not allow changing the type of a primary key column in-place when sequences are involved; the add/drop/rename pattern avoids casting and is fully transactional
  - id: DEC-80-02-02
    choice: UNIQUE(tenant_id) constraint instead of composite PK
    reason: Application code already queries by tenant_id; the uuid PK remains the row identifier; UNIQUE constraint prevents duplicate inserts without changing the PK structure

# Metrics
metrics:
  duration: 8 minutes
  completed: 2026-02-17
---

# Phase 80 Plan 02: Site Settings PK Fix Summary

**One-liner:** Replaced site_settings integer DEFAULT 1 primary key with a uuid (gen_random_uuid) PK and added UNIQUE(tenant_id) to prevent PK collision when a second tenant saves maintenance-mode settings.

## What Shipped

- Migration `20260216400000_fix_site_settings_pk.sql`: transactional DDL that adds a uuid column, drops the integer PK, drops the old id column, renames the uuid column to id, reinstates the PK constraint, and adds `UNIQUE(tenant_id)`
- Existing default tenant row preserved through migration (confirmed: `id` now `ec72073c-2bb1-4a2b-a6e2-7d0321d2b886`, all other columns intact)
- `SiteSettings` TypeScript interface updated: `id: number` -> `id: string`, `tenant_id: string` added as second field
- `SiteSettingsPayload` and `SiteStatus` interfaces left unchanged
- `npm run build` exits 0 — 103 pages compiled, zero TypeScript errors

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Add/drop/rename pattern for PK migration | PostgreSQL cannot ALTER a PK column type in-place with sequences; this approach is transactional and idempotent | Migration applies cleanly |
| UNIQUE(tenant_id) rather than composite PK | App queries by tenant_id; uuid remains the row ID; constraint prevents duplicate inserts | Each tenant limited to one settings row |

## Deviations from Plan

None — plan executed as written.

## Authentication Gates

None.

## Follow-ups

- None required. The service layer (`siteSettings.ts`) already queries and saves by `tenant_id`; no application logic changes were needed.

## Next Phase Readiness

- [x] site_settings table accepts inserts for multiple tenants without PK collision
- [x] TypeScript build clean — no type errors from the interface change
- [x] Existing data preserved — default tenant settings unchanged
