---
phase: 40-tenant-square-integration
plan: 02
subsystem: square
tags: [square, credentials, vault, cache, typescript]

# Dependency graph
requires: [40-01]
provides: [SquareConfig type, getTenantSquareConfig, resolveTenantFromMerchantId]
affects: [40-03, 40-04, 40-05, 40-06, 40-07, 40-08]

# Tech tracking
tech-stack:
  added: []
  patterns: [credential-loading-layer, globalThis-cache, vault-rpc]

# File tracking
key-files:
  created:
    - src/lib/square/types.ts
    - src/lib/square/config.ts
  modified: []

# Decisions
decisions:
  - id: DEC-40-02-01
    choice: RPC returns array, access via data[0]
    rationale: Supabase RPC for RETURNS TABLE functions returns an array, not a single object
  - id: DEC-40-02-02
    choice: Cache TTL of 60 seconds
    rationale: Matches existing tenant cache TTL for consistency
  - id: DEC-40-02-03
    choice: Environment defaults to 'sandbox' if not set
    rationale: Safer default for development; production must be explicit

# Metrics
metrics:
  duration: 97 seconds
  completed: 2026-02-14
---

# Phase 40 Plan 02: SquareConfig Type and Credential Loading Summary

**One-liner:** Tenant-aware Square credential loading layer with Vault RPC, env var fallback, and 60s in-memory cache

## What Shipped

- **SquareConfig interface** — Type-safe interface for all Square credentials (accessToken, applicationId, locationId, environment, merchantId, webhookSignatureKey)
- **getTenantSquareConfig()** — Central credential resolution function that loads from Vault via RPC with env var fallback for default tenant and globalThis Map caching
- **resolveTenantFromMerchantId()** — Shared utility for webhook handlers to resolve tenant ID from Square merchant_id
- **Credential caching** — 60-second TTL cache using globalThis pattern consistent with existing tenant cache

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| RPC returns array, access via `data[0]` | Supabase RPC for `RETURNS TABLE` functions returns an array | Handles empty arrays correctly, returns null when no credentials |
| 60-second cache TTL | Matches existing tenant cache for consistency | Credentials refresh every minute; balances freshness vs performance |
| Default environment to 'sandbox' | Safer default for development; production requires explicit config | Prevents accidental production API calls in dev |
| Optional merchantId and webhookSignatureKey | Not all Square operations require these fields | Allows partial configuration during initial tenant setup |

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None.

## Follow-ups

- **Phase 40-03**: Parameterize fetch-client.ts to accept SquareConfig
- **Phase 40-04**: Update domain layers (catalog.ts, orders.ts, etc.) to pass config through
- **Phase 40-05**: Update customer-facing API routes to use getTenantSquareConfig()
- **Phase 40-06**: Update admin API routes with inline Square env vars
- **Later phase**: Remove env var fallback after migrating default tenant to Vault

## Next Phase Readiness

- [x] SquareConfig type is available for import
- [x] getTenantSquareConfig() ready for consumption by all Square-related code
- [x] resolveTenantFromMerchantId() ready for webhook handlers
- [x] No circular dependencies introduced
- [x] TypeScript compiles cleanly (test errors are pre-existing)
