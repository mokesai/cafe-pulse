---
phase: 95-admin-auth-hardening-orders-isolation
plan: 03
subsystem: auth

tags: [requireAdminAuth, tenant_id, bulk-upload, hybrid-sync, inventory]

requires:
  - 95-02  # sync-square route migrated; pattern established for inventory admin routes

provides:
  - bulk-upload route using requireAdminAuth() with tenant_id on every INSERT
  - hybrid-sync route using requireAdminAuth() with inline Square catalog sync and fully tenant-scoped queries

affects:
  - 95-04+  # remaining admin route migrations can follow same pattern

tech-stack:
  added: []
  patterns:
    - requireAdminAuth() guard as first statement in POST handler
    - createServiceClient() + getCurrentTenantId() resolved at handler level, passed to helpers
    - Helper functions accept (supabase, tenantId) parameters — no internal client creation
    - Inline Square API call replaces internal HTTP self-call to avoid auth cookie requirement

key-files:
  created: []
  modified:
    - src/app/api/admin/inventory/bulk-upload/route.ts
    - src/app/api/admin/inventory/hybrid-sync/route.ts

decisions:
  - id: DEC-95-03-01
    choice: Inline Square catalog sync in hybrid-sync instead of extracting to shared lib
    rationale: Next.js route files cannot export non-HTTP-handler functions for cross-import; inlining avoids the constraint entirely and keeps the logic co-located with its only caller
  - id: DEC-95-03-02
    choice: clearExistingInventory adds .eq('tenant_id', tenantId) before .neq('id', uuid)
    rationale: DELETE without tenant scope would wipe all tenants' inventory in replace mode — data integrity bug requiring tenant guard

metrics:
  duration: ~25 minutes
  completed: 2026-02-19
---

# Phase 95 Plan 03: Bulk-Upload and Hybrid-Sync Auth Migration Summary

**One-liner:** Migrated bulk-upload and hybrid-sync from email-based admin auth to requireAdminAuth(), added tenant_id to all inventory INSERTs, tenant-scoped all data queries, and replaced hybrid-sync's internal HTTP self-call to sync-square with direct inline logic.

## What Shipped

- **bulk-upload auth**: `validateAdminAccess(adminEmail)` replaced with `requireAdminAuth(request)` + `isAdminAuthSuccess()` guard at top of POST handler
- **bulk-upload client**: Local `getSupabaseClient()` function deleted; `createServiceClient()` from `@/lib/supabase/server` used throughout
- **bulk-upload tenant_id**: Every `inventory_items` INSERT now includes `tenant_id: tenantId` in the payload map
- **bulk-upload tenant scope**: `validateInventoryItems` adds `.eq('tenant_id', tenantId)` to duplicate-check SELECT; `clearExistingInventory` adds `.eq('tenant_id', tenantId)` to DELETE to prevent cross-tenant data destruction in replace mode
- **bulk-upload helpers refactored**: All four helpers (`validateInventoryItems`, `clearExistingInventory`, `insertInventoryItems`, `createStockMovements`) now accept `supabase` and `tenantId` as parameters instead of creating their own clients
- **bulk-upload adminEmail removed**: `adminEmail` removed from POST body handling and GET documentation
- **hybrid-sync auth**: `validateAdminAccess(adminEmail)` replaced with `requireAdminAuth(request)` guard
- **hybrid-sync HTTP self-call eliminated**: `runSquareSync(adminEmail, dryRun)` no longer calls `fetch(${NEXT_PUBLIC_SITE_URL}/api/admin/inventory/sync-square, ...)`; replaced with inline Square catalog API call that uses `squareConfig` loaded from `getTenantSquareConfig(tenantId)`
- **hybrid-sync tenant scope — stats**: `getInventoryStats` now accepts `(supabase, tenantId)` and adds `.eq('tenant_id', tenantId)` to inventory_items SELECT
- **hybrid-sync tenant scope — enrichment**: `runEnrichmentSync` suppliers SELECT and inventory_items SELECT both scoped with `.eq('tenant_id', tenantId)`; UPDATE loop adds `.eq('tenant_id', tenantId)` to prevent cross-tenant writes
- **hybrid-sync tenant scope — Square sync**: Inline `runSquareSync` scopes existing inventory check with `.eq('tenant_id', tenantId)`; new items include `tenant_id: tenantId` in INSERT payload
- **hybrid-sync adminEmail removed**: `adminEmail` field removed from `HybridSyncRequest` interface and GET documentation

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Inline Square sync in hybrid-sync (not shared lib) | Next.js route.ts files cannot export non-handler functions for cross-import; inlining avoids the constraint and keeps logic co-located with its only caller | runSquareSync() calls Square API directly with squareConfig parameter |
| clearExistingInventory adds tenant scope before replace | Without tenant filter, replace mode would DELETE all tenants' inventory — cross-tenant data destruction bug | `.eq('tenant_id', tenantId)` added before `.neq('id', uuid)` guard |
| squareConfig null guard before runSquareSync | hybrid-sync is optional-Square (may be enrichment-only); guard prevents 503 blast from unconfigured tenants | `if (!body.skipSquareSync && squareConfig)` pattern |

## Deviations from Plan

None — plan executed exactly as written. The `clearExistingInventory` tenant scope was explicitly called out in the plan action and implemented as specified.

## Follow-ups

- Phase 95 continues: any remaining admin routes not yet covered by plans 95-01 through 95-03

## Next Phase Readiness

- [x] bulk-upload uses requireAdminAuth() — adminEmail pattern eliminated
- [x] hybrid-sync uses requireAdminAuth() — adminEmail pattern eliminated
- [x] hybrid-sync HTTP self-call eliminated — no internal cross-route auth dependency
- [x] All inventory_items INSERTs in both routes include tenant_id
- [x] All inventory_items and suppliers SELECTs are tenant-scoped
- [x] TypeScript build clean (src/ — pre-existing __tests__/ vitest errors unrelated to this plan)
