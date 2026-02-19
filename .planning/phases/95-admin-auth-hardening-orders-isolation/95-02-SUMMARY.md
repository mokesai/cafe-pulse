---
phase: 95
plan: 02
subsystem: admin-auth
tags: [auth, admin, api, security, requireAdminAuth]

dependency_graph:
  requires:
    - 95-01  # Orders auth migration established the pattern
    - 50-03  # requireAdmin() / tenant_memberships auth foundation
  provides:
    - dashboard/stats route with requireAdminAuth()
    - push-to-square route with requireAdminAuth()
    - sync-square route with requireAdminAuth()
  affects:
    - 95-03+  # Remaining auth migration plans follow same pattern

tech_stack:
  patterns:
    - requireAdminAuth() for all admin API routes
    - isAdminAuthSuccess() type guard for early return

key_files:
  modified:
    - src/app/api/admin/dashboard/stats/route.ts
    - src/app/api/admin/inventory/push-to-square/route.ts
    - src/app/api/admin/inventory/sync-square/route.ts

decisions:
  - "GET handler now accepts NextRequest (was parameterless) to pass to requireAdminAuth()"
  - "adminEmail removed from request interfaces entirely — session cookie is the auth identity"
  - "validateAdminAccess() local function removed from both inventory routes — pattern was email-in-body auth, weakest in codebase"
  - "requiredFields in GET doc responses updated from ['adminEmail'] to [] to reflect new interface"

metrics:
  duration: "~10 minutes"
  completed: "2026-02-19"
---

# Phase 95 Plan 02: Dashboard/Stats, Push-to-Square, Sync-Square Auth Migration Summary

Migrated three admin API routes from legacy auth patterns to `requireAdminAuth()`, eliminating the weakest auth pattern in the codebase — accepting an admin email address in the POST body as proof of admin identity.

## What Was Done

### Task 1: dashboard/stats route

**Before:** 18-line inline auth block — `createClient()` → `auth.getUser()` → `profiles.role` check.

**After:**
```typescript
export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult
  // ... data queries unchanged
}
```

Changes:
- Removed `createClient` import (no longer needed for auth)
- Added `NextRequest` parameter to GET handler
- Replaced 18-line auth block with 2-line `requireAdminAuth()` call
- All tenant-scoped data queries preserved as-is

### Task 2: push-to-square and sync-square routes

**Before:** Both had a local `validateAdminAccess(supabase, adminEmail)` function that queried `profiles.role` by email, plus `adminEmail: string` in the request interface and a `!body.adminEmail` guard.

**After:** Both routes:
- Import `requireAdminAuth, isAdminAuthSuccess` from `@/lib/admin/middleware`
- `validateAdminAccess` function removed entirely
- `adminEmail` field removed from `PushToSquareRequest` / `SquareSyncRequest` interfaces
- POST handler starts with `requireAdminAuth(request)` before any body parsing or tenantId resolution
- All data queries, tenantId resolution, and Square API calls unchanged

## Security Improvement

The `validateAdminAccess(supabase, adminEmail)` pattern checked `profiles.role` by email from the request body. This means:
- Anyone who knew an admin's email address could call these endpoints
- No session/cookie validation — purely email-based trust
- No CSRF protection, no rate limiting

`requireAdminAuth()` gives:
- Session cookie validation (Supabase JWT)
- `tenant_memberships` role check (owner or admin in current tenant)
- Rate limiting (admin-specific limiter)
- CSRF origin/referer validation
- Security headers on all error responses

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `grep "profiles.role" src/app/api/admin/dashboard/stats/route.ts` → no results
- `grep "validateAdminAccess" src/app/api/admin/inventory/push-to-square/route.ts` → no results
- `grep "validateAdminAccess" src/app/api/admin/inventory/sync-square/route.ts` → no results
- `grep "adminEmail" src/app/api/admin/inventory/push-to-square/route.ts` → no results
- `grep "adminEmail" src/app/api/admin/inventory/sync-square/route.ts` → no results
- TypeScript: zero errors in `src/` (pre-existing `__tests__/` errors unrelated to this work)

## Commits

- `4b4844d` fix(95-02): migrate dashboard/stats auth to requireAdminAuth()
- `cf12e1e` fix(95-02): migrate push-to-square and sync-square auth to requireAdminAuth()
