---
phase: 40-tenant-square-integration
plan: 12
subsystem: square-integration
tags: [square, api-routes, tenant-isolation, gap-closure]

# Dependency graph
requires:
  - 40-02 # SquareConfig type and getTenantSquareConfig()
  - 40-03 # Parameterized fetch-client.ts
  - 40-04 # Domain layer parameterization (customers.ts)
provides:
  - Tenant-aware customer card management routes
  - Complete Square API route coverage (all 14 routes now tenant-scoped)
affects:
  - Future customer payment flows
  - Phase 40 UAT verification (blocker removed)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Tenant-aware credential loading in customer routes

# File tracking
key-files:
  created: []
  modified:
    - src/app/api/square/customers/cards/route.ts
    - src/app/api/square/customers/delete-card/route.ts
    - src/app/api/square/customers/save-card/route.ts

# Decisions
decisions: []

# Metrics
metrics:
  duration: 117 seconds
  completed: 2026-02-15
---

# Phase 40 Plan 12: Customer Routes Gap Closure Summary

**One-liner:** All three customer card management routes (cards, delete-card, save-card) now resolve tenant context and load Square credentials via getTenantSquareConfig(), completing the tenant-aware Square integration.

## What Shipped

- **cards route**: Added tenant resolution and config loading; passes squareConfig to searchSquareCustomerByEmail() and getCustomerCards()
- **delete-card route**: Added tenant resolution and config loading; passes squareConfig to searchSquareCustomerByEmail() and deleteCustomerCard()
- **save-card route**: Added tenant resolution and config loading; passes squareConfig to findOrCreateCustomer() and saveCustomerCard()
- **503 error handling**: All three routes return 503 when Square not configured for tenant (consistent with other customer-facing routes from Plan 40-05)
- **UAT blocker removed**: TypeScript build now passes for customer routes (zero type errors)

## Decisions Made

No new decisions — applied existing patterns from Plans 40-05 and 40-11.

## Deviations from Plan

None — plan executed as written.

## Authentication Gates

None.

## Follow-ups

None — all customer routes now tenant-aware.

## Next Phase Readiness

- [x] All 14 Square API routes use tenant credentials
- [x] TypeScript build passes for all Square routes
- [x] Phase 40 UAT can proceed (TypeScript blocker removed)
- [x] Phase 40 goal achieved: "Every Square API call uses the correct tenant's credentials"

## Implementation Notes

### Transformation Pattern Applied

All three routes followed the same pattern from Plans 40-05 and 40-11:

1. **Import statements**: Added getCurrentTenantId and getTenantSquareConfig
2. **Tenant resolution**: Called after auth check, before any Square operations
3. **Config validation**: Return 503 if getTenantSquareConfig() returns null
4. **Parameter passing**: Pass squareConfig as first parameter to all Square customer functions

### Routes Coverage

After this plan, all Square API customer routes are tenant-aware:

- `/api/square/customers/cards` — GET saved payment methods
- `/api/square/customers/delete-card` — DELETE payment method
- `/api/square/customers/save-card` — POST new payment method

Combined with the 11 routes from Plans 40-05, 40-06, and 40-11, all 14 Square API routes now use tenant credentials.

### TypeScript Type Safety

The customer functions in `src/lib/square/customers.ts` were already parameterized in Plan 40-04 with SquareConfig as the first parameter:

- `searchSquareCustomerByEmail(config, email)`
- `getCustomerCards(config, customerId)`
- `deleteCustomerCard(config, customerId, cardId)`
- `findOrCreateCustomer(config, email, name)`
- `saveCustomerCard(config, customerId, cardRequest)`

This plan simply updated the three route files to pass the config parameter, resolving the TypeScript build errors that were blocking UAT.

## Commits

- `74b07f9` — feat(40-12): add tenant-aware config loading to cards route
- `a0f8afc` — feat(40-12): add tenant-aware config loading to delete-card and save-card routes
