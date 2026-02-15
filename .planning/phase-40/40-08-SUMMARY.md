---
phase: 40-tenant-square-integration
plan: 08
subsystem: frontend
tags: [react, square-payments, server-components, context]

# Dependency graph
requires: [40-02]  # SquareConfig type and getTenantSquareConfig
provides: [server-rendered-config, context-based-payments]
affects: []  # Terminal change for frontend Square config delivery

# Tech tracking
tech-stack:
  added: []  # No new libraries
  patterns: [server-render-props, react-context-config]

# File tracking
key-files:
  created: []
  modified:
    - src/providers/SquareProvider.tsx
    - src/components/providers/DynamicSquareProvider.tsx
    - src/app/(site)/layout.tsx
    - src/components/CheckoutModal.tsx

# Decisions
decisions:
  - id: DEC-40-08
    choice: Server-render Square config via getTenantSquareConfig and pass as props
    rationale: Eliminates client-side fetch race condition and extra API round-trip; server already has tenant context
  - id: DEC-40-09
    choice: Extend SquareProvider context to include applicationId and locationId
    rationale: Allows descendants like CheckoutModal to access config without prop threading
  - id: DEC-40-10
    choice: Null config graceful degradation (render children without SquareProvider wrapper)
    rationale: Unconfigured tenants can still access site features that don't require payments

# Metrics
metrics:
  duration: 2m 10s
  completed: 2026-02-14
---

# Phase 40 Plan 08: Server-Rendered Square Config Frontend Integration Summary

**One-liner:** Server-rendered Square config injection via getTenantSquareConfig with React context delivery, eliminating client-side config fetch and env var reads

## What Shipped

- **Extended SquareProvider context**: Added `applicationId` and `locationId` to context alongside `payments`, `isLoading`, and `error`
- **useSquareConfig() hook**: New hook for config-only access without requiring full SquarePayments context
- **Props-based DynamicSquareProvider**: Refactored from client-side fetch to accept `config: SquarePublicConfig | null` as props
- **Server-rendered config in site layout**: Layout calls `getTenantSquareConfig(tenantId)` and passes public-safe fields to DynamicSquareProvider
- **Context-based CheckoutModal**: Replaced `process.env.NEXT_PUBLIC_SQUARE_*` reads with `useSquareConfig()` hook
- **Graceful degradation**: Null config renders children without Square SDK (supports unconfigured tenants)
- **Zero prop threading**: CartContainer and CartModal unchanged (no applicationId/locationId props needed)

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Server-render config via getTenantSquareConfig | Server already has tenant context; avoids extra API call | Faster initial render, no race condition |
| Extend context with applicationId/locationId | Descendants need config without prop threading | Cleaner component tree |
| Null config = render children without provider | Unconfigured tenants need graceful UX | Site remains accessible, checkout shows config error |
| Remove client-side /api/square/config fetch | Server-rendered props supersede client fetch | One less API route dependency |

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None encountered.

## Follow-ups

- Phase 40-09: Update remaining components that might read Square config (if any)
- Future phase: Potentially deprecate /api/square/config endpoint (now unused by frontend)
- Future phase: "Setup in progress" page for unconfigured tenants (deferred from this plan per plan notes)

## Next Phase Readiness

- [x] SquareProvider context includes applicationId and locationId
- [x] DynamicSquareProvider accepts server-rendered config props
- [x] Site layout server-renders config via getTenantSquareConfig
- [x] CheckoutModal uses context instead of env vars
- [x] Graceful degradation for unconfigured tenants
- [x] Zero client-side Square config fetches
- [x] No sensitive credentials leaked to client (only public-safe fields)

## Technical Notes

### Server-Rendered Config Flow

1. **Site layout (server component)**: Calls `getCurrentTenantId()` and `getTenantSquareConfig(tenantId)`
2. **Public-safe extraction**: Filters to `{ applicationId, locationId, environment }` (no accessToken)
3. **Props to client**: Passes `publicSquareConfig` to DynamicSquareProvider
4. **Provider initialization**: DynamicSquareProvider wraps children in SquareProvider (or renders bare children if null)
5. **Context consumption**: CheckoutModal reads config via `useSquareConfig()` hook

### Graceful Degradation Pattern

For unconfigured tenants (null config):
- DynamicSquareProvider renders `<>{children}</>` without SquareProvider wrapper
- `useSquareConfig()` returns `{ applicationId: '', locationId: '' }` (from default context)
- CheckoutModal's null check (`!applicationId || !locationId`) triggers "Payment Configuration Error" message
- Rest of site remains accessible (menu browsing, cart management, profile, etc.)

### Before vs After

**Before (40-07 state):**
- DynamicSquareProvider fetches `/api/square/config` on mount (client-side)
- CheckoutModal reads `process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID`
- Race condition between SDK init and config fetch
- Extra API round-trip
- Env vars not tenant-aware

**After (40-08 state):**
- Site layout server-renders config via `getTenantSquareConfig(tenantId)`
- DynamicSquareProvider receives config as props (no fetch)
- CheckoutModal reads from SquareProvider context via `useSquareConfig()`
- No race condition, no extra API call
- Fully tenant-aware via server context

## Code Changes Summary

### src/providers/SquareProvider.tsx
- Added `applicationId` and `locationId` to `SquareContextType` interface
- Updated default context to include empty strings for new fields
- Extended provider value to include `applicationId` and `locationId`
- Added `useSquareConfig()` hook for config-only access

### src/components/providers/DynamicSquareProvider.tsx
- Removed `useState`, `useEffect`, and `fetch('/api/square/config')` call
- Added `SquarePublicConfig` interface export
- Changed props from `{ children }` to `{ children, config }`
- Null config returns bare `<>{children}</>`

### src/app/(site)/layout.tsx
- Imported `getCurrentTenantId` and `getTenantSquareConfig`
- Server-renders Square config before component tree
- Extracts public-safe fields to `publicSquareConfig`
- Passes config to `<DynamicSquareProvider config={publicSquareConfig}>`

### src/components/CheckoutModal.tsx
- Imported `useSquareConfig` from `@/providers/SquareProvider`
- Replaced `process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID || process.env.SQUARE_APPLICATION_ID` with `useSquareConfig()` hook
- Removed `process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID || process.env.SQUARE_LOCATION_ID` read
- Null check still works (context returns empty strings when provider not mounted)

## Commits

1. **52bfc21**: refactor(40-08): props-based Square provider and extended context
   - Extended SquareProvider context with applicationId/locationId
   - Added useSquareConfig() hook
   - Refactored DynamicSquareProvider to accept config props
   - Removed client-side fetch logic

2. **30f86b5**: feat(40-08): server-render Square config and use context in CheckoutModal
   - Site layout server-renders config via getTenantSquareConfig
   - Pass public-safe config to DynamicSquareProvider
   - CheckoutModal uses useSquareConfig() instead of process.env reads
   - Graceful degradation for unconfigured tenants
