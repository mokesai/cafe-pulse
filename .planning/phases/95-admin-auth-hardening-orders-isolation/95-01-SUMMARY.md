---
phase: 95-admin-auth-hardening-orders-isolation
plan: 01
subsystem: admin-api
tags: [auth, tenant-isolation, orders, requireAdminAuth, security]

dependency-graph:
  requires:
    - 50-03: requireAdmin() and tenant_memberships auth foundation
    - 70-07: admin route tenant isolation patterns established
  provides:
    - Tenant-scoped orders API with correct requireAdminAuth() pattern
    - Cross-tenant write gap on orders PATCH closed
    - GET count query tenant-scoped (pagination totals correct per tenant)
  affects:
    - 95-02 through 95-N: subsequent auth migration plans follow same pattern

tech-stack:
  added: []
  patterns:
    - requireAdminAuth() from src/lib/admin/middleware.ts for admin route auth
    - authResult.tenantId for tenant resolution in PATCH handlers (avoids redundant cookie read)
    - .eq('tenant_id', tenantId) on PATCH UPDATE to prevent cross-tenant writes
    - 404 response when update returns no row (order in different tenant)

key-files:
  created: []
  modified:
    - src/app/api/admin/orders/route.ts

decisions:
  - id: use-authresult-tenantid-in-patch
    choice: Use authResult.tenantId in PATCH handler
    rationale: requireAdminAuth() already resolves tenantId from the cookie via getCurrentTenantId(); reading it again from cookies() would be redundant. authResult.tenantId is guaranteed correct if auth passed.
    alternatives: Read tenantId from cookies() directly in PATCH handler (same as GET)

metrics:
  duration: "~10 minutes"
  completed: "2026-02-19"
---

# Phase 95 Plan 01: Orders Route — Auth Migration + Tenant Scoping Summary

**One-liner:** Migrated admin/orders route from `profiles.role` to `requireAdminAuth()` and added `tenant_id` scoping to the GET count query and PATCH UPDATE, closing the cross-tenant write gap.

## What Was Built

The `src/app/api/admin/orders/route.ts` route was updated to:

1. **GET handler auth**: Replaced 18-line inline auth block (getUser + profiles.role check) with the 2-line `requireAdminAuth()` pattern. Removed the now-unused `createClient` import.

2. **GET count query**: Added `.eq('tenant_id', tenantId)` immediately after the `.select('*', { count: 'exact', head: true })` call. Previously the count query had no tenant filter, so pagination totals were the sum of all tenants' orders — a data leakage issue and a UX bug (wrong page counts per tenant).

3. **PATCH handler auth**: Replaced the same 18-line inline auth block with `requireAdminAuth()`. The `tenantId` is now read from `authResult.tenantId` rather than re-reading the cookie.

4. **PATCH UPDATE query**: Added `.eq('tenant_id', tenantId)` after `.eq('id', orderId)`. Without this, a service-role client UPDATE against only `id` could modify any tenant's order if an admin passed an order UUID from another tenant.

5. **404 on missing order**: Moved the `if (!updatedOrder)` check before the profile fetch (reordered slightly from the plan spec — both `updateError` and `!updatedOrder` checks are now present and ordered correctly). Returns 404 instead of allowing the code to continue with null.

## Verification Results

All plan verification criteria passed:

| Check | Result |
|-------|--------|
| `grep "profiles\.role"` returns empty | PASS (0 matches) |
| `grep "requireAdminAuth"` shows 2 handler calls | PASS (line 14 GET, line 132 PATCH) |
| `grep "tenant_id"` shows 3+ occurrences | PASS (lines 39, 92, 161) |
| TypeScript build (`npx tsc --noEmit`) — src/ errors | PASS (0 src/ errors) |

Note: `__tests__/` directory has pre-existing TypeScript errors (missing `vitest`, `@testing-library/react` type declarations) that are unrelated to this plan.

## Must-Haves Status

| Must-Have | Status |
|-----------|--------|
| GET count query scoped to current tenant | PASS |
| PATCH UPDATE cannot modify cross-tenant order | PASS |
| Both handlers use requireAdminAuth() not profiles.role | PASS |
| TypeScript build passes (src/ files) | PASS |

## Commits

| Hash | Message |
|------|---------|
| eed57ce | fix(95-01): migrate orders route auth to requireAdminAuth + tenant scope PATCH/count |

## Deviations from Plan

None — plan executed exactly as written, with one minor sequence adjustment: the `if (!updatedOrder)` null check was placed after `if (updateError)` (plan showed them together; final code keeps both checks in the correct order before the profile fetch).

## Next Phase Readiness

Plan 95-02 and subsequent plans can follow the identical 2-task pattern established here:
1. Import `requireAdminAuth, isAdminAuthSuccess` from `@/lib/admin/middleware`
2. Replace the inline auth block with the 2-line guard
3. Use `authResult.tenantId` in PATCH/PUT/DELETE handlers
4. Add `.eq('tenant_id', tenantId)` to any UPDATE/DELETE queries using service role client
