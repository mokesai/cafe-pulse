---
phase: 40-tenant-square-integration
plan: 07
subsystem: webhooks
tags: [square, webhooks, multi-tenant, merchant-id, vault, signature-verification]

# Dependency graph
requires: [40-02]
provides: [tenant-aware-webhook-handlers, merchant-id-resolution]
affects: [40-08, 40-09, 40-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Webhook tenant resolution via merchant_id lookup
    - Shared webhook endpoint for all tenants
    - Per-tenant signature verification

# File tracking
key-files:
  created: []
  modified:
    - src/app/api/webhooks/square/catalog/route.ts
    - src/app/api/webhooks/square/inventory/route.ts

# Decisions
decisions:
  - id: DEC-40-07-01
    choice: Return HTTP 200 for unknown merchant_id (not 4xx)
    rationale: Prevents Square from retrying on valid requests from unconfigured tenants
  - id: DEC-40-07-02
    choice: Import resolveTenantFromMerchantId from shared config.ts
    rationale: Avoids code duplication between catalog and inventory webhooks
  - id: DEC-40-07-03
    choice: Use createServiceClient() instead of custom getSupabaseClient()
    rationale: Standardizes on existing Supabase service client pattern

# Metrics
metrics:
  duration: 25s
  completed: 2026-02-14
---

# Phase 40 Plan 07: Webhook Tenant Resolution Summary

**One-liner:** Multi-tenant webhook handlers resolve tenant from Square's merchant_id payload field, verify signatures with tenant-specific keys, and use per-tenant credentials for API calls.

## What Shipped

- **Catalog webhook tenant resolution**: Refactored `/api/webhooks/square/catalog` to resolve tenant from `merchant_id` in webhook payload before processing
- **Inventory webhook tenant resolution**: Refactored `/api/webhooks/square/inventory` with same merchant_id-based tenant resolution pattern
- **Shared webhook utilities**: Both handlers import `resolveTenantFromMerchantId` from `@/lib/square/config` (created in Plan 02)
- **Per-tenant signature verification**: Each webhook verifies signatures using tenant's `webhookSignatureKey` from Vault
- **Per-tenant API calls**: Catalog webhook passes tenant's `SquareConfig` to `fetchCatalogChanges()`; inventory webhook passes tenant's `locationId` to `processInventoryUpdates()`
- **Graceful unknown merchant handling**: Both webhooks return HTTP 200 with warning message for unknown merchant_id to prevent Square retries
- **Zero env var dependencies**: Removed all `process.env.SQUARE_*` references from both webhook files

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Return 200 for unknown merchant | Prevents Square from retrying valid requests from unconfigured/unknown tenants | Cleaner logs, no retry storms |
| Shared resolveTenantFromMerchantId | Avoid duplicating merchant_id lookup logic across webhooks | Single source of truth in config.ts |
| Replace getSupabaseClient with createServiceClient | Use project's standard service client pattern | Consistency with other API routes |
| Pass config to fetchCatalogChanges | Enable per-tenant base URL derivation | Catalog fetch works for sandbox/production per-tenant |
| Pass locationId to processInventoryUpdates | Filter inventory updates by tenant's specific location | Multi-location support within single tenant |

## Deviations from Plan

None — plan executed as written.

## Authentication Gates

None occurred during execution.

## Follow-ups

None — this plan is complete and ready for next steps.

## Next Phase Readiness

- [x] Both webhooks resolve tenant from merchant_id
- [x] Unknown merchant_id returns 200 (prevents retries)
- [x] Per-tenant signature verification implemented
- [x] Per-tenant credentials used for Square API calls
- [x] Shared utility imported from config.ts
- [x] Zero process.env.SQUARE_* references remain
- [x] TypeScript compilation passes for webhook files

**Ready for Plan 40-08**: Frontend config delivery via server-rendered props.
