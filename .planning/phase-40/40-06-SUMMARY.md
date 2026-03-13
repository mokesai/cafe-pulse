---
phase: 40-tenant-square-integration
plan: 06
subsystem: api-routes
tags: [square, admin, tenant-aware, credentials]

# Dependency graph
requires: [40-02, 40-03]
provides: [tenant-aware-admin-routes, admin-credential-loading]
affects: [40-07, 40-09]

# Tech tracking
tech-stack:
  added: []
  patterns: [tenant-config-injection, per-request-credential-loading]

# File tracking
key-files:
  created: []
  modified:
    - src/app/api/admin/inventory/sync-square/route.ts
    - src/app/api/admin/inventory/push-to-square/route.ts
    - src/app/api/admin/inventory/sales-sync/route.ts
    - src/app/api/admin/inventory/square-search/route.ts
    - src/app/api/admin/menu/items/[itemId]/route.ts
    - src/app/api/admin/menu/availability/route.ts
    - src/app/api/admin/cogs/catalog/sync-square/route.ts

# Decisions
decisions: []

# Metrics
metrics:
  duration: 5 minutes
  completed: 2026-02-14
---

# Phase 40 Plan 06: Admin Routes Tenant Config Summary

**One-liner:** Seven admin API routes refactored to load per-tenant Square credentials via getTenantSquareConfig() instead of reading env vars directly.

## What Shipped

- **Inventory admin routes (3)**: sync-square, push-to-square, square-search now resolve tenant and load config
- **Sales sync route**: Refactored to pass SquareConfig to fetchSquareOrders()
- **Menu management routes (2)**: items/[itemId] and availability now derive base URL from config per-request
- **COGS catalog sync**: Updated to pass config as first parameter to listCatalogObjects()
- **Module-level cleanup**: Removed all module-level Square env var reads and singletons
- **Per-request Supabase clients**: Replaced module-level supabase singleton in sync-square with createServiceClient()

## Deviations from Plan

None — plan executed exactly as written.

## Commits

- `98a535c`: Task 1 (sync-square, push-to-square, square-search)
- `7acc2a1`: Task 2 (sales-sync, menu routes, COGS sync)

## Follow-ups

None — all 7 admin routes successfully migrated to tenant-aware pattern.

## Next Phase Readiness

- [x] All admin routes load credentials via getTenantSquareConfig()
- [x] Zero env var reads for Square credentials in admin routes
- [x] TypeScript compilation passes for modified routes
- [x] Ready for webhook tenant resolution (Plan 40-07)
