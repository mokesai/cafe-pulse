---
phase: 70-integration-testing-hardening
plan: 05
subsystem: maintenance
tags: [site-settings, cache, multi-tenant, middleware, tenant-isolation]

# Dependency graph
requires:
  - 70-02  # security audit that identified the singleton cache gap
  - 20-01  # site_settings table gained tenant_id column
provides:
  - per-tenant site status cache using Map<string, CacheEntry> keyed by tenantId
  - getCachedSiteStatus(request, tenantId) signature in middleware and edge cache
  - all siteSettings.ts queries filtered by .eq('tenant_id', tenantId)
affects:
  - 70-06  # admin API route audit - site route already fixed here
  - 70-07  # shared library audit - siteSettings.ts fully tenant-scoped now

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Per-tenant globalThis Map cache: Map<string, CacheEntry> keyed by tenantId with getCache() helper
    - Cookie-first tenant resolution in middleware: sessionResponse.cookies → request.cookies → DEFAULT_TENANT_ID fallback

# File tracking
key-files:
  created: []
  modified:
    - src/lib/services/siteSettings.edge.ts
    - src/lib/services/siteSettings.ts
    - middleware.ts
    - src/app/(site)/layout.tsx
    - src/app/admin/(protected)/settings/page.tsx
    - src/app/api/admin/settings/site/route.ts
    - src/app/under-construction/page.tsx
    - src/app/api/public/site-status/route.ts

# Decisions
decisions:
  - id: DEC-70-05-01
    choice: Per-tenant maintenance mode (option-a) — each tenant independently controls their storefront availability
    rationale: Multi-tenant SaaS model requires independent control; site_settings table already has tenant_id from Phase 20; singleton cache would bleed one tenant's maintenance state to all tenants
  - id: DEC-70-05-02
    choice: authResult.tenantId reused in admin API route instead of calling getCurrentTenantId() again
    rationale: requireAdminAuth() already resolves tenantId from cookie and includes it in the result; calling getCurrentTenantId() a second time would be redundant

# Metrics
metrics:
  duration: ~25 minutes
  completed: 2026-02-16
---

# Phase 70 Plan 05: Per-Tenant Site Status Cache Summary

**One-liner:** Refactored site status cache from a shared singleton to a per-tenant Map<string, CacheEntry>, making each cafe's maintenance mode independent across the multi-tenant SaaS platform.

## What Shipped

- `siteSettings.edge.ts`: `__siteStatusCacheEdge` changed from `CacheEntry | undefined` to `Map<string, CacheEntry> | undefined`; `getCache()` helper initializes and returns the Map; `fetchSiteStatus()` and `getCachedSiteStatus()` accept `tenantId: string` as second parameter; `fetchSiteStatus()` appends `?tenantId=` to the API URL; `invalidateSiteStatusCache()` accepts optional `tenantId` to delete one entry or clear the entire Map
- `siteSettings.ts`: All four exported functions (`getSiteSettings`, `getSiteStatus`, `saveSiteSettings`, `getSiteStatusUsingServiceClient`) now accept `tenantId: string`; all Supabase queries use `.eq('tenant_id', tenantId)` replacing `.eq('id', 1)`; `saveSiteSettings` insert uses `tenant_id: tenantId` instead of `id: 1`; `invalidateEdgeCache` passes `tenantId` through to the edge module
- `middleware.ts`: Reads tenant ID from `sessionResponse.cookies.get('x-tenant-id')` (just set by tenant resolution), falls back to `request.cookies.get('x-tenant-id')` (prior request), then `DEFAULT_TENANT_ID`; passes `tenantId` to `getCachedSiteStatus(request, tenantId)`
- `(site)/layout.tsx`: Moved `getCurrentTenantId()` call before `getSiteStatusUsingServiceClient(tenantId)` so tenant context is available for the maintenance check
- `admin/(protected)/settings/page.tsx`: Added `getCurrentTenantId()` import and call; passes `tenantId` to `getSiteStatusUsingServiceClient` and `getSiteSettings`
- `api/admin/settings/site/route.ts`: Uses `authResult.tenantId` (from `requireAdminAuth`); passes to `getSiteSettings`, `getSiteStatusUsingServiceClient`, and `saveSiteSettings`
- `under-construction/page.tsx`: Added `getCurrentTenantId()` import and call; passes `tenantId` to `getSiteStatusUsingServiceClient`
- `api/public/site-status/route.ts`: Changed signature to `GET(request: NextRequest)`; reads `tenantId` from `searchParams.get('tenantId')` with `DEFAULT_TENANT_ID` fallback; passes to `getSiteStatusUsingServiceClient(tenantId)`

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Per-tenant maintenance mode (option-a) | SaaS model requires independent control per cafe; site_settings.tenant_id already exists from Phase 20 migrations | Map<string, CacheEntry> cache; each tenant's maintenance mode is isolated |
| Reuse authResult.tenantId in admin route | requireAdminAuth() already resolves tenant from cookie — no need to call getCurrentTenantId() again | Cleaner code, one fewer async call |
| Cookie-first tenant resolution in middleware | middleware cannot use next/headers cookies(); sessionResponse has the just-set cookie | Correct tenant resolved even on first request to a subdomain |

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None.

## Follow-ups

- The 70-02 audit gap "All globalThis caches use tenant-scoped keys" can now be re-verified as PASS for the siteSettings cache
- The `site_settings` table still has an `id` column — a future migration could drop it or keep it as a secondary identifier; the queries no longer depend on it

## Next Phase Readiness

- [x] siteSettings.edge.ts cache is per-tenant (Map<string, CacheEntry>)
- [x] siteSettings.ts queries all use .eq('tenant_id', tenantId)
- [x] middleware passes tenantId to getCachedSiteStatus
- [x] All 5 caller files updated with tenantId
- [x] TypeScript type check passes (zero errors in src/)
- [x] 70-06 and 70-07 gap closure plans can proceed — siteSettings is no longer a concern for the service-role audit
