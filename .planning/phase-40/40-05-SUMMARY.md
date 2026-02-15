---
phase: 40-tenant-square-integration
plan: 05
subsystem: api
tags: [square, api, tenant-awareness, cache]

# Dependency graph
requires: [40-04]
provides: [tenant-aware-customer-api]
affects: [40-09]

# Tech tracking
tech-stack:
  added: []
  patterns: [tenant-scoped-cache]

# File tracking
key-files:
  created: []
  modified:
    - src/app/api/menu/route.ts
    - src/app/api/square/config/route.ts
    - src/app/api/square/process-payment/route.ts
    - src/app/api/square/order-preview/route.ts

# Decisions
decisions:
  - id: DEC-40-05-01
    choice: Menu cache keyed by tenantId using Map
    rationale: Prevents cross-tenant data leakage; single-object cache would serve tenant A's menu to tenant B
  - id: DEC-40-05-02
    choice: Return 503 when Square not configured for tenant
    rationale: Distinguishes "service unavailable" from server errors; allows graceful degradation

# Metrics
metrics:
  duration: 2.4 minutes
  completed: 2026-02-15
---

# Phase 40 Plan 05: Customer-Facing API Routes Summary

**One-liner:** Customer-facing API routes (menu, config, payment, order-preview) resolve tenant context and load Square credentials per-request with tenant-scoped menu cache

## What Shipped

- Menu route resolves tenant and passes SquareConfig to fetch-client and domain layer calls
- Menu cache converted from single object to Map keyed by tenantId
- Config route loads credentials from getTenantSquareConfig instead of env vars
- Payment route resolves tenant and passes config through to createSquareOrder, getOrder, processPayment
- Order-preview route resolves tenant and passes config to previewSquareOrder
- All 4 routes return 503 when Square not configured for tenant
- Zero process.env.SQUARE_* reads remain in any customer-facing route

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Menu cache keyed by tenantId | Single-object cache would serve tenant A's menu to tenant B | Map<string, CacheEntry> prevents cross-tenant data leakage |
| Return 503 for unconfigured tenants | Distinguishes "service unavailable" from server errors | Allows graceful degradation; frontend can show appropriate message |
| Cache TTL remains 5 minutes | Existing TTL already prevents stale data issues | No change needed; tenant-scoping is the critical fix |

## Deviations from Plan

None — plan executed as written.

## Authentication Gates

None — all routes accessed existing Square credentials via getTenantSquareConfig.

## Follow-ups

None — all customer-facing routes complete. Dead code cleanup (40-09) will remove old Square client files.

## Next Phase Readiness

- [x] Customer-facing menu browsing tenant-aware
- [x] Order creation tenant-aware
- [x] Payment processing tenant-aware
- [x] Config endpoint tenant-aware
- [ ] Admin routes (40-06 already complete per STATE.md)
- [ ] Webhooks (40-07 already complete per STATE.md)
- [ ] Dead code cleanup (40-09 pending)
