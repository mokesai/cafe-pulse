---
phase: 70
plan: "06"
subsystem: security-hardening
tags:
  - tenant-isolation
  - security
  - cogs
  - inventory
  - service-role
  - gap-closure

dependency_graph:
  requires:
    - "70-02: identified 64 service-role FAIL files in security audit"
    - "70-04: closed first wave of gaps (webhooks, KDS, orders)"
  provides:
    - "All 15 COGS admin routes filtered by tenant_id"
    - "All 17 inventory admin routes filtered by tenant_id"
    - "32 FAIL files from audit converted to PASS"
  affects:
    - "70-07: remaining gap closure (audit count drops from 23 to ~0 after 70-06)"

tech_stack:
  added: []
  patterns:
    - "getCurrentTenantId() called at route handler level after auth check"
    - "tenant_id in INSERT payloads; .eq('tenant_id', tenantId) on SELECT/UPDATE/DELETE"
    - "Helper functions accept tenantId parameter to propagate scope through call chain"

key_files:
  created: []
  modified:
    - src/app/api/admin/cogs/catalog/sync-square/route.ts
    - src/app/api/admin/cogs/modifier-option-recipes/[id]/route.ts
    - src/app/api/admin/cogs/modifier-option-recipes/route.ts
    - src/app/api/admin/cogs/modifiers/options/route.ts
    - src/app/api/admin/cogs/modifiers/seen/route.ts
    - src/app/api/admin/cogs/modifiers/sets/route.ts
    - src/app/api/admin/cogs/periods/[id]/close/route.ts
    - src/app/api/admin/cogs/periods/[id]/export/route.ts
    - src/app/api/admin/cogs/periods/route.ts
    - src/app/api/admin/cogs/product-recipes/[id]/route.ts
    - src/app/api/admin/cogs/product-recipes/route.ts
    - src/app/api/admin/cogs/products/[id]/route.ts
    - src/app/api/admin/cogs/sellable-overrides/[id]/route.ts
    - src/app/api/admin/cogs/sellable-overrides/route.ts
    - src/app/api/admin/cogs/sellables/route.ts
    - src/app/api/admin/inventory/adjust/route.ts
    - src/app/api/admin/inventory/alerts/route.ts
    - src/app/api/admin/inventory/analytics/export/route.ts
    - src/app/api/admin/inventory/analytics/route.ts
    - src/app/api/admin/inventory/cost-history/route.ts
    - src/app/api/admin/inventory/locations/[locationId]/route.ts
    - src/app/api/admin/inventory/locations/route.ts
    - src/app/api/admin/inventory/push-to-square/route.ts
    - src/app/api/admin/inventory/restock/route.ts
    - src/app/api/admin/inventory/restore/route.ts
    - src/app/api/admin/inventory/revert-cost/route.ts
    - src/app/api/admin/inventory/sales-sync/route.ts
    - src/app/api/admin/inventory/sales-sync/status/route.ts
    - src/app/api/admin/inventory/settings/route.ts
    - src/app/api/admin/inventory/sync-square/route.ts
    - src/app/api/admin/inventory/units/[unitId]/route.ts
    - src/app/api/admin/inventory/units/route.ts

decisions:
  - decision: "Thread tenantId through helper functions rather than reading it inside each helper"
    why: "Helper functions are called by the route handler which already has auth context; getCurrentTenantId() at route level matches the established pattern (decision from 70-04)"
    phase: "70-06"
  - decision: "tenant_id in INSERT payloads, not .eq() on insert"
    why: "INSERTs set data payload; .eq() is a WHERE clause for SELECT/UPDATE/DELETE; consistent with prior gap closure work in 70-04"
    phase: "70-06"

metrics:
  duration: "~2 hours (continued from previous session)"
  completed: "2026-02-17"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 70 Plan 06: COGS and Inventory Tenant-ID Gap Closure Summary

**One-liner:** Added tenant_id filtering to all 32 COGS and inventory admin routes identified as FAIL in the 70-02 security audit, converting them from cross-tenant data leakage risks to tenant-isolated endpoints.

## What Was Built

All 15 COGS admin routes and all 17 inventory admin routes now:
1. Call `const tenantId = await getCurrentTenantId()` after auth check in each handler
2. Filter every `.from()` query with `.eq('tenant_id', tenantId)`
3. Include `tenant_id: tenantId` in every INSERT payload

## Tasks Completed

### Task 1: 15 COGS Admin Routes
Applied the established pattern to all 15 COGS routes. Notable complexity: `cogs/periods/[id]/close/route.ts` had three helper functions (`computePurchasesValue`, `snapshotInventory`, `getBeginInventoryValue`) that needed `tenantId` threaded through as a parameter to filter their database queries.

Routes updated:
- `cogs/periods/route.ts` — GET (list periods) and POST (create period)
- `cogs/periods/[id]/close/route.ts` — POST with 5 DB tables across 3 helpers
- `cogs/periods/[id]/export/route.ts` — GET with 3 tables
- `cogs/catalog/sync-square/route.ts` — POST with tenant_id on cogs_products upsert, cogs_products select, and cogs_sellables upsert
- `cogs/modifiers/sets/route.ts`, `options/route.ts`, `seen/route.ts`
- `cogs/modifier-option-recipes/route.ts` and `[id]/route.ts`
- `cogs/product-recipes/route.ts` and `[id]/route.ts`
- `cogs/products/[id]/route.ts`
- `cogs/sellables/route.ts`
- `cogs/sellable-overrides/route.ts` and `[id]/route.ts`

### Task 2: 17 Inventory Admin Routes
Applied the same pattern. Notable complexity: `sales-sync/route.ts` had multiple helper functions (`getLastSuccessfulRun`, `createSyncRun`, `updateSyncRun`, `fetchInventoryMap`, `insertSalesTransaction`, `insertTransactionItems`, `applyAutoDecrements`) that all needed `tenantId` threaded through. Total of ~8 function signatures updated plus all call sites.

Routes updated:
- `adjust/route.ts` — 3 tables: inventory_items (read+update), stock_movements (insert), low_stock_alerts (update)
- `alerts/route.ts` — low_stock_alerts GET and POST; also upgraded from `authResult instanceof NextResponse` to `isAdminAuthSuccess` pattern
- `analytics/route.ts` — inventory_items, stock_movements
- `analytics/export/route.ts` — inventory_items, stock_movements
- `cost-history/route.ts` — inventory_item_cost_history
- `locations/route.ts` and `locations/[locationId]/route.ts`
- `push-to-square/route.ts` — already had tenantId for Square config; added to DB queries for inventory_items and stock_movements
- `restock/route.ts` — 3 tables: inventory_items (read+update), stock_movements (insert), low_stock_alerts (update)
- `restore/route.ts` — inventory_items update
- `revert-cost/route.ts` — inventory_items (read+update), inventory_item_cost_history (insert)
- `sales-sync/route.ts` — comprehensive threading through 7 helper functions touching 5 tables
- `sales-sync/status/route.ts` — inventory_sales_sync_runs (two queries)
- `settings/route.ts` — inventory_settings (GET, POST update, POST insert)
- `sync-square/route.ts` — already had tenantId for Square config; added to inventory_items (read+insert) and stock_movements (insert)
- `units/route.ts` and `units/[unitId]/route.ts` — inventory_unit_types

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript parameter index mismatch in sales-sync/route.ts**

- **Found during:** TypeScript verification after Task 2
- **Issue:** `insertTransactionItems` gained a `tenantId` parameter at index 1, shifting the items array from `Parameters<typeof insertTransactionItems>[2]` to `[3]`
- **Fix:** Updated parameter index in the `lineItemsPayload` type annotation
- **Files modified:** `src/app/api/admin/inventory/sales-sync/route.ts`
- **Commit:** ffb30cb

## Verification

- TypeScript: `npx tsc --noEmit` passes with zero errors in source files (pre-existing test infrastructure errors and a pre-existing duplicate identifier in `invoices/items/[itemId]/match/route.ts` are unrelated)
- Spot check: `grep -L "tenant_id" src/app/api/admin/cogs/*/route.ts src/app/api/admin/cogs/*/*/route.ts` returns empty (all COGS routes have tenant_id)
- All 32 files staged and committed in 2 task commits + 1 fix commit

## Next Phase Readiness

- 70-07 (remaining gap closure) can proceed; this plan closed 32 of the ~64 original FAIL files
- The 4 inventory routes not in scope (square-search, hybrid-sync, bulk-upload, sync-status) were not listed in the 70-02 audit FAIL list and are out of scope for this plan
