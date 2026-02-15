---
phase: 50-tenant-auth-identity
plan: 03
subsystem: auth
tags: [admin, tenant-memberships, RLS, authentication, authorization]

# Dependency graph
requires: [50-01]
provides: [tenant-aware admin auth, RLS-enforced admin routes]
affects: [50-04, 50-05, 50-06, 50-07, 50-08]

# Tech tracking
tech-stack:
  added: []
  patterns: [tenant-scoped admin authentication, RLS-based authorization]

# File tracking
key-files:
  created: []
  modified:
    - src/lib/admin/auth.ts
    - src/lib/admin/middleware.ts
    - src/app/admin/(protected)/layout.tsx

# Decisions
decisions:
  - id: DEC-50-03-01
    choice: Check tenant_memberships table instead of profiles.role
    rationale: Multi-tenant authorization requires per-tenant role checks, not global admin role
  - id: DEC-50-03-02
    choice: Return createTenantClient() from requireAdmin()
    rationale: Admin routes need RLS tenant isolation; service role client bypasses RLS
  - id: DEC-50-03-03
    choice: Redirect with ?error=no-access when user lacks tenant access
    rationale: Differentiate between "not authenticated" vs "wrong tenant" for better UX

# Metrics
metrics:
  duration: 169s
  completed: 2026-02-15
---

# Phase 50 Plan 03: Admin Auth Tenant-Aware Summary

**One-liner:** Admin authentication now checks tenant_memberships table and uses tenant-scoped RLS clients instead of service role bypass.

## What Shipped

- requireAdmin() function refactored to check tenant_memberships table (not profiles.role)
- requireAdmin() returns createTenantClient() for RLS-enforced queries
- requireAdminAuth() middleware updated for API route tenant authorization
- AdminAuthSuccess interface includes membership and tenantId fields
- Admin layout destructures tenant-scoped client from requireAdmin()
- Removed obsolete checkAdminRole() and requireAdminAPI() functions
- All admin routes now enforce proper tenant isolation via RLS

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Check tenant_memberships not profiles.role | Multi-tenant systems need per-tenant roles | Admin access properly scoped to tenant membership |
| Return createTenantClient() | Service role bypasses RLS; need tenant isolation | All admin queries now tenant-scoped via RLS |
| Redirect with ?error=no-access | Differentiate auth vs authorization failures | Better UX for users with account but wrong tenant |
| Remove checkAdminRole() | Client-side check no longer needed | Simplified codebase |

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None.

## Follow-ups

- Admin pages and API routes now inherit tenant-scoped client
- Future admin features will automatically benefit from RLS tenant isolation
- No more service role workarounds for admin routes

## Next Phase Readiness

- [x] requireAdmin() checks tenant_memberships table
- [x] requireAdmin() returns createTenantClient()
- [x] requireAdminAuth() checks tenant_memberships for API routes
- [x] AdminAuthSuccess interface includes membership and tenantId
- [x] Admin layout uses updated requireAdmin() signature
- [x] TypeScript build passes
- [x] Ready for 50-04 (TenantProvider React Context)
