---
phase: 40-tenant-square-integration
plan: 04
subsystem: square-integration
tags: [square, tenant-aware, multi-tenant, domain-layer, catalog, orders, payments, typescript]

# Dependency graph
requires: [40-02, 40-03]
provides: [tenant-aware-domain-layer, tenant-scoped-catalog-cache, parameterized-catalog-orders-tax-customers]
affects: [40-05, 40-06, 40-07, 40-08, 40-09, 40-10]

# Tech tracking
tech-stack:
  added: []
  patterns: [tenant-scoped-cache, config-passthrough]

# File tracking
key-files:
  created: []
  modified:
    - src/lib/square/catalog.ts
    - src/lib/square/orders.ts
    - src/lib/square/tax-validation.ts
    - src/lib/square/customers.ts

# Decisions
decisions:
  - id: DEC-40-04-01
    choice: Replace module-level singleton cache with tenant-scoped Map
    rationale: Each tenant has their own catalog; single cache would serve wrong data to other tenants
  - id: DEC-40-04-02
    choice: Replace 'Little Cafe Website' with 'Online Ordering' as source name
    rationale: Tenant-neutral generic name works for all tenants; business-specific name hardcoded default tenant identity
  - id: DEC-40-04-03
    choice: Pass tenantId to order functions (preview/create) but not to processPayment
    rationale: Order functions use catalog cache (needs tenant scope); payment function doesn't touch catalog

# Metrics
metrics:
  duration: 242s
  completed: 2026-02-14
---

# Phase 40 Plan 04: Domain Layer Parameterization Summary

**One-liner:** All four Square domain layer files (catalog, orders, tax-validation, customers) accept SquareConfig and pass it through to fetch-client; orders.ts now uses tenant-scoped catalog cache instead of singleton.

## What Shipped

- **catalog.ts**: All three exported functions accept `config: SquareConfig` and pass it through to fetch-client calls (listCatalogObjects, searchCatalogItems)
- **tax-validation.ts**: Both functions accept `config: SquareConfig` and pass it through to listCatalogTaxes
- **orders.ts**: All exported functions accept `config: SquareConfig` (and `tenantId: string` for catalog-using functions) and pass config through to fetch-client and tax-validation calls
- **Tenant-scoped catalog cache**: Replaced module-level singleton `catalogItemsCache` with `catalogCacheByTenant` Map keyed by tenantId
- **Tenant-neutral source name**: Replaced hardcoded 'Little Cafe Website' with generic 'Online Ordering' in order creation
- **customers.ts**: All seven stub functions accept `_config: SquareConfig` parameter (voided since functions are disabled)

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tenant-scoped cache Map | Each tenant has different catalog; single cache would cross-contaminate | `catalogCacheByTenant` keyed by tenantId with per-tenant expiration |
| Generic 'Online Ordering' source name | Business-specific 'Little Cafe Website' hardcoded default tenant identity | All orders now use tenant-neutral name |
| tenantId parameter for order functions only | Only functions using catalog cache need tenant scope; payment doesn't touch catalog | previewSquareOrder and createSquareOrder accept tenantId; processPayment does not |
| config parameter even for disabled stubs | Maintains consistent API; functions will need it when enabled | All customer functions accept config (currently voided) |

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None.

## Follow-ups

- Next plan (40-05): Update API routes to load SquareConfig and pass it through to these domain layer functions
- All TypeScript errors are in downstream consumers (API routes) which will be fixed in 40-05
- Customer functions remain disabled stubs; will be implemented in future phase when needed

## Next Phase Readiness

- [x] Domain layer fully parameterized
- [x] No environment variable reads in domain layer
- [x] Catalog cache is tenant-scoped
- [x] No hardcoded business identity
- [ ] API routes updated to call with config (next plan: 40-05)
