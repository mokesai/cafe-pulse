---
phase: 80-critical-checkout-settings-fixes
plan: 01
subsystem: checkout
tags: [supabase, rls, tenant-isolation, orders, payments]

# Dependency graph
requires:
  - 70-07  # admin route tenant isolation complete; all other tenant_id gaps closed
  - 40-05  # customer-facing API routes are tenant-aware (getCurrentTenantId in process-payment)
provides:
  - Tenant-scoped orders INSERT via createTenantClient
  - Tenant-scoped order_items INSERT via createTenantClient
  - tenant_id stamped on orders and order_items at checkout
affects:
  - 80-02  # next plan in phase (settings fixes)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - createTenantClient for data writes so RLS policies enforce tenant boundary at INSERT time

# File tracking
key-files:
  created: []
  modified:
    - src/app/api/square/process-payment/route.ts

# Decisions
decisions:
  - id: DEC-01
    choice: Preserve supabase (createClient) for auth.getUser() only; use tenantSupabase (createTenantClient) for all data writes
    rationale: getUser() requires a user-scoped cookie client; createTenantClient sets the app.tenant_id session variable so RLS policies apply at INSERT time

# Metrics
metrics:
  duration: ~10 minutes
  completed: 2026-02-16
---

# Phase 80 Plan 01: Checkout Tenant ID Summary

**One-liner:** Switched orders and order_items INSERTs from anonymous createClient() to createTenantClient(tenantId) and stamped tenant_id on both payloads so RLS policies enforce the tenant boundary at checkout.

## What Shipped

- Added `createTenantClient` to the import from `@/lib/supabase/server`
- Created `tenantSupabase = await createTenantClient(tenantId)` after `getUser()`, using the `tenantId` already in scope from `getCurrentTenantId()`
- Switched the `orders` INSERT to use `tenantSupabase` with `tenant_id: tenantId` as the first payload field
- Added `tenant_id: tenantId` as the first field in the `orderItems` map
- Switched the `order_items` INSERT to use `tenantSupabase`
- `supabase.auth.getUser()` call left unchanged — still uses the user-scoped cookie client
- Build passes cleanly (103/103 static pages, zero TypeScript errors)

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep createClient for getUser(), use createTenantClient for writes | getUser() needs the session cookie client; data writes need the tenant session variable set so RLS policies can filter by tenant_id | Two separate client instances in the same handler; auth boundary is clean |

## Deviations from Plan

None — plan executed as written. The `.next` directory had stale generated type files that caused a spurious TypeScript error on the first clean build attempt; deleting `.next` and rebuilding resolved this (pre-existing artifact, not introduced by this plan).

## Authentication Gates

None.

## Follow-ups

- None required for this plan. The tenant_id gap in checkout is now closed.

## Next Phase Readiness

- [x] orders INSERT stamps tenant_id via createTenantClient — 80-02 can proceed
