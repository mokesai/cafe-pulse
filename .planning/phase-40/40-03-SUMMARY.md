---
phase: 40-tenant-square-integration
plan: 03
subsystem: square-api
tags: [square, api-client, parameterization, multi-tenant]

# Dependency graph
requires: [40-02]
provides: [parameterized-fetch-client]
affects: [40-04, 40-05, 40-06, 40-07]

# Tech tracking
tech-stack:
  added: []
  patterns: [parameterized-api-client]

# File tracking
key-files:
  created: []
  modified: [src/lib/square/fetch-client.ts]

# Decisions
decisions:
  - id: DEC-40-03-01
    choice: Per-call getBaseUrl(config) instead of module-level constant
    rationale: Environment can vary per tenant; base URL must be derived from config parameter

# Metrics
metrics:
  duration: 2m 26s
  completed: 2026-02-14
---

# Phase 40 Plan 03: Parameterize fetch-client.ts Summary

**One-liner:** Refactored all 14 fetch-client.ts functions to accept SquareConfig as first parameter, eliminating all module-level environment variable reads.

## What Shipped

- Replaced module-level `SQUARE_BASE_URL` constant with per-call `getBaseUrl(config)` function
- Replaced module-level `getHeaders()` with parameterized `getHeaders(config)`
- Replaced all `getLocationId()` calls with `config.locationId`
- Added `config: SquareConfig` as first parameter to all 14 exported functions:
  - `listCatalogObjects`, `searchCatalogItems`, `searchLocationCatalogItems`, `searchAllCatalogItems`
  - `getOrder`, `createOrder`, `createPayment`
  - `listLocations`, `listCatalogTaxes`, `createCatalogTax`
  - `upsertCatalogItem`, `upsertCatalogCategory`, `deleteCatalogObject`, `batchUpsertCatalogObjects`
- Removed `squareConfig` export object entirely
- Removed all `process.env.SQUARE_*` references (verified zero matches)

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Per-call `getBaseUrl(config)` instead of module-level constant | Environment (sandbox/production) can vary per tenant; must be derived from config at call time | Base URL now determined from `config.environment` for each request |
| Keep all function implementations identical | This is a pure signature refactoring; minimize risk by only changing parameter sources | Error handling, response parsing, and logging unchanged |

## Deviations from Plan

None — plan executed as written.

## Follow-ups

- Plan 40-04 will update domain layers (catalog.ts, orders.ts, tax-validation.ts, customers.ts) to pass SquareConfig to these functions
- Expected TypeScript errors in consuming files will be resolved in 40-04

## Next Phase Readiness

- [x] fetch-client.ts is fully parameterized and ready for multi-tenant use
- [x] Zero environment variable reads remain in fetch-client.ts
- [x] All function signatures accept SquareConfig as first parameter
- [ ] Domain layers need updating (40-04)
- [ ] API routes need updating (40-05, 40-06)
