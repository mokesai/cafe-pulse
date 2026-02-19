---
phase: 96-tenant-resolution-hardening-documentation
plan: 01
subsystem: security
tags: [tenant-isolation, soft-delete, defense-in-depth, middleware]

# Dependency graph
requires:
  - 60-01 # soft-delete infrastructure (deleted_at, is_active columns)
  - 60-07 # deleteTenant() action
  - 10-01 # tenant resolution in middleware
provides:
  - Hardened soft-delete tenant resolution
  - Defense-in-depth deleted tenant filtering
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Defense-in-depth soft-delete filtering (dual-check pattern)

# File tracking
key-files:
  created: []
  modified:
    - src/lib/tenant/context.ts
    - src/app/platform/tenants/actions.ts

# Decisions
decisions:
  - id: DEC-96-01
    choice: Use dual-filter pattern (deleted_at IS NULL AND is_active = true) in resolveTenantBySlug()
    rationale: Service role client bypasses RLS, so soft-delete must be enforced in application code. Two independent checks provide defense-in-depth — if one is missed, the other still blocks deleted tenants.
  - id: DEC-96-02
    choice: Set both deleted_at AND is_active=false in deleteTenant()
    rationale: Ensures both filters are applied atomically. If code only checks is_active, tenant is still blocked. If code only checks deleted_at, tenant is still blocked.

# Metrics
metrics:
  duration: 162s
  completed: 2026-02-18
---

# Phase 96 Plan 01: Soft-Delete Tenant Resolution Hardening Summary

**One-liner:** Defense-in-depth soft-delete filtering prevents deleted tenants from being resolved via subdomain by enforcing dual checks (deleted_at IS NULL AND is_active = true) in middleware resolution and deletion actions.

## What Shipped

- **resolveTenantBySlug() hardened**: Added `.is('deleted_at', null)` filter to tenant lookup query alongside existing `.eq('is_active', true)` filter (src/lib/tenant/context.ts line 30)
- **deleteTenant() hardened**: Added `is_active: false` to update payload alongside existing `deleted_at` timestamp and `status: 'deleted'` (src/app/platform/tenants/actions.ts line 343)
- **Finding 4 from v1.0 audit closed**: Soft-deleted tenants can no longer have their x-tenant-id cookie set or appear to "work" until RLS blocks data access
- **TypeScript build verified clean**: No compilation errors in modified files

## Technical Details

### Problem
resolveTenantBySlug() uses createServiceClient() which bypasses RLS. Without explicit deleted_at filtering in the query, a soft-deleted tenant with is_active=true would still resolve and have its tenant cookie set. The RLS policy on the tenants table filters `deleted_at IS NULL`, but that doesn't help when the service client bypasses RLS entirely.

### Solution
1. **Middleware resolution**: Query chain now enforces both `.eq('is_active', true)` and `.is('deleted_at', null)`
2. **Deletion action**: Update payload now sets both `is_active: false` and `deleted_at: now` atomically
3. **Defense-in-depth**: If a bug or oversight causes one filter to be missed, the other still blocks resolution

### Pattern Consistency
Follows existing defense-in-depth pattern used in resendInvite() (actions.ts lines 175-177) which chains `.eq('tenant_id', tenantId).is('deleted_at', null)`.

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dual-filter pattern in resolveTenantBySlug() | Service client bypasses RLS; soft-delete must be enforced in app code | Two independent checks (deleted_at IS NULL AND is_active = true) provide redundancy |
| Set both deleted_at AND is_active in deleteTenant() | Atomic dual-flag setting ensures both filters apply | If one check is missed in code, the other still blocks |

## Deviations from Plan

None — plan executed as written.

## Follow-ups

None. Gap closure complete.

## Next Phase Readiness

- [x] Soft-deleted tenants blocked from resolution
- [x] Defense-in-depth pattern established
- [x] TypeScript compilation clean
- [x] Ready for 96-02 (SQUARE_SECRET documentation)

## Verification Evidence

**resolveTenantBySlug() has both filters:**
```typescript
const { data, error } = await supabase
  .from('tenants')
  .select('*')
  .eq('slug', slug)
  .eq('is_active', true)
  .is('deleted_at', null)  // <-- Added in this plan
  .single()
```

**deleteTenant() sets both exclusion flags:**
```typescript
const { error: deleteError } = await supabase
  .from('tenants')
  .update({
    deleted_at: now,
    status: 'deleted',
    is_active: false,  // <-- Added in this plan
  })
  .eq('id', tenantId);
```

## Security Impact

**Before**: Soft-deleted tenant could resolve via subdomain, get x-tenant-id cookie set, appear to work until RLS blocked data access (confusing UX, potential info leak).

**After**: Soft-deleted tenant returns 404 at middleware level. No cookie set, no request processing, clean tenant-not-found experience.

**Audit compliance**: Closes Finding 4 from v1.0 security audit — "Soft-deleted tenants can still be resolved via subdomain lookup."
