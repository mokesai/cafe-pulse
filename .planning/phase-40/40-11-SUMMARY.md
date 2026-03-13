---
phase: 40-tenant-square-integration
plan: 11
subsystem: api-routes
tags: [square, admin, tenant-aware, credentials, gap-closure]

# Dependency graph
requires: [40-02, 40-03, 40-06]
provides: [complete-admin-tenant-coverage]
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [tenant-config-injection, per-request-credential-loading]

# File tracking
key-files:
  created: []
  modified:
    - src/app/api/admin/menu/categories/route.ts
    - src/app/api/admin/menu/items/route.ts
    - src/app/api/debug-categories/route.ts

# Decisions
decisions: []

# Metrics
metrics:
  duration: 3 minutes
  completed: 2026-02-14
---

# Phase 40 Plan 11: Admin Menu Routes Gap Closure Summary

**One-liner:** Two admin menu management routes (categories and items) refactored to load per-tenant Square credentials via getTenantSquareConfig(), closing 40-06 gap and eliminating type errors from 40-03 parameterization.

## What Shipped

- **Categories route (4 handlers)**: GET, POST, PUT, DELETE now resolve tenant and pass SquareConfig to all Square function calls
- **Items route (2 handlers)**: GET and POST now resolve tenant and pass SquareConfig to searchAllCatalogItems, upsertCatalogItem, listCatalogObjects, upsertCatalogCategory
- **503 error handling**: Both routes return 503 when Square credentials not configured for tenant
- **Type safety**: All Square function calls now receive config parameter, eliminating type errors
- **Debug route fix**: debug-categories route also updated to prevent TypeScript build failure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed debug-categories route type error**

- **Found during:** Task 2 (TypeScript compilation verification)
- **Issue:** debug-categories route called searchAllCatalogItems() without required config parameter, blocking TypeScript build
- **Fix:** Added tenant resolution and config loading to debug-categories route
- **Files:** src/app/api/debug-categories/route.ts
- **Commit:** cd80e57

## Commits

- `b7087f8`: Task 1 - Categories route tenant resolution and config injection (4 handlers updated)
- `cd80e57`: Task 2 - Items route tenant resolution and config injection, plus debug route fix

## Follow-ups

None — all admin routes now fully tenant-aware with credential loading.

## Next Phase Readiness

- [x] All admin routes load credentials via getTenantSquareConfig()
- [x] Zero env var reads for Square credentials in admin routes
- [x] TypeScript compilation passes for all modified routes
- [x] Plan 40-06 gap fully closed
- [x] Phase 40 verification must-have "All admin routes load credentials via getTenantSquareConfig()" now satisfied
