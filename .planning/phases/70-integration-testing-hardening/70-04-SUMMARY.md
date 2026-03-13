---
phase: 70-integration-testing-hardening
plan: 04
subsystem: security
tags: [tenant-isolation, service-role, webhooks, kds, orders]

# Dependency graph
requires:
  - 70-02  # security audit that identified these gaps
  - 40-07  # webhook tenant resolution via merchant_id
  - 20-01  # tenant_id columns on all 48 tables

provides:
  - Tenant-scoped Square webhook DB operations (catalog + inventory)
  - Tenant-scoped KDS query layer (all 15 exported functions)
  - Tenant-tagged order creation (orders + order_items)
  - Deprecated admin/setup.ts with tenant scoping

affects:
  - 70-05  # site status cache gap closure
  - 70-06  # remaining COGS/admin route gaps

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tenantId first parameter convention for data access functions"
    - "getCurrentTenantId() called at route/page level, threaded into query functions"

# File tracking
key-files:
  created: []
  modified:
    - src/app/api/webhooks/square/catalog/route.ts
    - src/app/api/webhooks/square/inventory/route.ts
    - src/lib/kds/queries.ts
    - src/lib/supabase/database.ts
    - src/lib/admin/setup.ts
    - src/app/api/orders/route.ts
    - src/app/api/admin/kds/settings/route.ts
    - src/app/admin/(kds)/layout.tsx
    - src/app/kds/layout.tsx
    - src/app/admin/(kds)/kds/food/page.tsx
    - src/app/admin/(kds)/kds/drinks/page.tsx
    - src/app/admin/(protected)/settings/page.tsx

# Decisions
decisions:
  - id: DEC-70-04-01
    choice: "tenantId as first parameter on all KDS query functions"
    rationale: "Consistent convention makes it impossible to call a function without tenant scope; callers get a compile error if they forget tenantId"
  - id: DEC-70-04-02
    choice: "getCurrentTenantId() called at route/page handler level, not inside library functions"
    rationale: "Library functions remain pure and testable; context resolution stays at the edge of the system"
  - id: DEC-70-04-03
    choice: "Mark admin/setup.ts functions as @deprecated rather than deleting them"
    rationale: "Functions may still be called by scripts or tools; soft deprecation with pointer to requireAdmin() is safer than hard delete"
  - id: DEC-70-04-04
    choice: "Include tenant_id in INSERT payloads rather than chaining .eq() on INSERTs"
    rationale: "INSERTs set data; tenant_id belongs in the data payload. .eq() is for WHERE clauses on SELECT/UPDATE/DELETE."

# Metrics
duration: 8m
completed: 2026-02-17
---

# Phase 70 Plan 04: Service-Role Gap Closure (Webhooks, KDS, Orders) Summary

**One-liner:** Closed CRITICAL service-role cross-tenant leakage gaps in both Square webhooks, all KDS query functions, order creation, and legacy admin profile utilities — audit FAIL count dropped from 64 to 23.

## What Shipped

- **Catalog webhook** (`catalog/route.ts`): All 5 helper functions now accept `tenantId` parameter. Every `.from()` query filters by `tenant_id`. INSERTs include `tenant_id` in payload. Dedup check, getLastCatalogSync, syncCatalogChanges (inventory_items SELECT/UPDATE/INSERT, suppliers SELECT), and logWebhookEvent all scoped to resolved tenant.

- **Inventory webhook** (`inventory/route.ts`): All 4 helper functions accept `tenantId`. getInventoryItemBySquareId, updateInventoryStock (inventory_items UPDATE + stock_movements INSERT), checkLowStockAlert (low_stock_alerts SELECT + INSERT), logWebhookEvent, and dedup check all scoped to resolved tenant.

- **KDS queries** (`kds/queries.ts`): All 15 exported functions now accept `tenantId` as first parameter. Every `.from()` query has `.eq('tenant_id', tenantId)`. INSERT/upsert payloads include `tenant_id`. Internal callers (getCategoriesWithItems, getScreenData, upsertMenuItem) thread tenantId through correctly.

- **Order creation** (`database.ts`): `createOrder()` accepts `tenantId` in orderData. Orders and order_items inserts both include `tenant_id: tenantId`.

- **Orders route** (`api/orders/route.ts`): POST handler calls `getCurrentTenantId()` and spreads `tenantId` into `createOrder()` call.

- **Admin setup** (`admin/setup.ts`): `setUserAsAdmin`, `isUserAdmin`, and `getUserRole` accept `tenantId` parameter and filter profiles by `tenant_id`. All three marked `@deprecated` with pointer to `requireAdmin()` in `src/lib/auth/admin.ts`.

- **KDS caller files (6 total)**: `api/admin/kds/settings/route.ts`, `admin/(kds)/layout.tsx`, `kds/layout.tsx`, `admin/(kds)/kds/food/page.tsx`, `admin/(kds)/kds/drinks/page.tsx`, `admin/(protected)/settings/page.tsx` all import `getCurrentTenantId()` and pass `tenantId` to every kds/queries function call.

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| tenantId as first parameter on KDS functions | Compile-time enforcement; impossible to call without scope | All 6 callers updated, TypeScript catches regressions |
| getCurrentTenantId() at route/page level | Library functions stay pure and testable | Clean separation of concerns |
| @deprecated on admin/setup.ts functions | Scripts may still call them; soft deprecation safer than deletion | Legacy callers won't break; new code directed to requireAdmin() |
| tenant_id in INSERT payloads vs .eq() | INSERTs set data; .eq() is for WHERE clauses | Correct Supabase pattern used throughout |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed duplicate import in invoices/[id]/parse/route.ts**
- Found during: Task 4 verification (TypeScript check)
- Issue: `getCurrentTenantId` was imported twice, causing TS2300 duplicate identifier error
- Fix: Removed the duplicate import line (linter also auto-fixed this)
- Files modified: `src/app/api/admin/invoices/[id]/parse/route.ts`
- Note: This was a pre-existing unstaged change unrelated to this plan

### Better Than Expected

The success criteria estimated 5 FAIL files removed from the audit. Actual result:
- Audit FAIL count went from 64 to 23 (41 files now PASS vs estimated 5)
- This is because many of the admin route files in the unstaged changes had already been fixed before this plan execution, and our fixes to kds/queries.ts triggered the pass for admin/setup.ts as well

### Audit Script Note

`src/lib/supabase/database.ts` still shows FAIL in audit script. The script detects `.from()` queries and `.select()` in functions that use `createClient()` (user-scoped RLS, not service role). The audit script's grep-based pattern cannot distinguish between service-role and RLS-scoped queries. The `createOrder()` function which uses `createServiceClient()` now has `tenant_id` in both inserts.

## Follow-ups

- `src/lib/tenant/identity.ts` still shows FAIL in audit (false positive — queries tenants table by id which is already scoped to a specific tenant)
- 23 remaining FAIL files to be addressed in 70-05, 70-06, 70-07 plans
- `database.ts` audit false positive: audit script incorrectly flags user-scoped (createClient) functions; script improvement deferred to 70-07
