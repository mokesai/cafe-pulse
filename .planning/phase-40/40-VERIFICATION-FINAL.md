---
phase: 40-tenant-aware-square-integration
verified: 2026-02-15T03:40:00Z
status: gaps_found
score: 9/10 must-haves verified
re_verification:
  previous_status: passed
  previous_score: 10/10
  gaps_closed: []
  gaps_remaining:
    - "TypeScript build passes with zero errors"
  regressions:
    - "TypeScript build now fails due to 4 test/debug routes missing tenant-aware updates"
gaps:
  - truth: "TypeScript build passes with zero errors"
    status: failed
    reason: "4 test/debug routes call fetch-client functions without SquareConfig parameter"
    artifacts:
      - path: "src/app/api/square/tax-config/route.ts"
        issue: "Calls listLocations() and listCatalogTaxes() without config parameter (line 9, 27)"
      - path: "src/app/api/square/test-catalog/route.ts"
        issue: "Calls fetch-client functions without config parameter"
      - path: "src/app/api/square/validate-catalog/route.ts"
        issue: "Calls fetch-client functions without config parameter"
      - path: "src/app/api/square/test-order/route.ts"
        issue: "Calls fetch-client functions without config parameter"
    missing:
      - "Add tenant resolution (getCurrentTenantId) to all 4 routes"
      - "Add config loading (getTenantSquareConfig) to all 4 routes"
      - "Pass squareConfig as first parameter to all fetch-client function calls"
      - "Return 503 if squareConfig is null"
---

# Phase 40: Tenant-Aware Square Integration Verification Report (Final)

**Phase Goal:** Every Square API call uses the correct tenant's credentials loaded from Supabase Vault (with env var fallback for default tenant). Webhooks resolve tenant from merchant_id. Frontend config is server-rendered.

**Verified:** 2026-02-15T03:40:00Z
**Status:** gaps_found
**Re-verification:** Yes — after Plan 40-12 completion, new gap discovered via TypeScript build

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Vault infrastructure exists for credential storage | ✓ VERIFIED | Migration 20260215000000_vault_square_credentials.sql with vault_id columns, SECURITY DEFINER functions, audit table, merchant_id index |
| 2 | getTenantSquareConfig() loads credentials from Vault with env fallback | ✓ VERIFIED | src/lib/square/config.ts implements RPC call with 60s cache and DEFAULT_TENANT_ID fallback |
| 3 | All fetch-client.ts functions accept SquareConfig as first parameter | ✓ VERIFIED | All 14 exported functions parameterized, zero process.env reads |
| 4 | Domain layer (catalog, orders, tax, customers) passes config through | ✓ VERIFIED | All 4 domain files accept SquareConfig; orders.ts has tenant-scoped catalog cache |
| 5 | Customer-facing routes load config per-request | ✓ VERIFIED | 4 customer routes (menu, config, payment, order-preview) + 3 customer management routes (cards, delete-card, save-card) all use getTenantSquareConfig |
| 6 | Webhooks resolve tenant from merchant_id | ✓ VERIFIED | Both webhooks (catalog, inventory) use resolveTenantFromMerchantId() and load per-tenant config |
| 7 | Frontend config is server-rendered | ✓ VERIFIED | Site layout server-renders via getTenantSquareConfig and passes publicSquareConfig to DynamicSquareProvider |
| 8 | Setup scripts support tenant flags | ✓ VERIFIED | All 3 scripts (sync-square-catalog, seed-inventory, setup-square-webhooks) accept --tenant-id and --tenant-slug, use service_role RPC |
| 9 | All admin routes load credentials via getTenantSquareConfig() | ✓ VERIFIED | All 9 admin routes (sync-square, push-to-square, sales-sync, square-search, items/[itemId], availability, cogs/sync, categories, items) verified |
| 10 | TypeScript build passes with zero errors | ✗ FAILED | Build fails with "Expected 1 arguments, but got 0" in 4 test/debug routes |

**Score:** 9/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260215000000_vault_square_credentials.sql` | Vault infrastructure | ✓ VERIFIED | 8074 bytes, has vault_id columns, 3 SECURITY DEFINER functions, audit table, merchant_id index |
| `src/lib/square/types.ts` | SquareConfig interface | ✓ VERIFIED | 12 lines, clean interface with 6 fields |
| `src/lib/square/config.ts` | getTenantSquareConfig() + resolveTenantFromMerchantId() | ✓ VERIFIED | 129 lines, RPC call, 60s cache, env fallback, merchant resolution |
| `src/lib/square/fetch-client.ts` | Parameterized Square API client | ✓ VERIFIED | 14 exported functions, all accept SquareConfig, zero env reads |
| `src/lib/square/catalog.ts` | Parameterized domain layer | ✓ VERIFIED | All 3 exports accept SquareConfig as first parameter |
| `src/lib/square/orders.ts` | Parameterized with tenant-scoped cache | ✓ VERIFIED | catalogCacheByTenant Map, all exports accept config + tenantId |
| `src/lib/square/customers.ts` | Parameterized domain layer | ✓ VERIFIED | All exports accept SquareConfig as first parameter |
| `src/app/api/menu/route.ts` | Tenant-aware menu API | ✓ VERIFIED | Resolves tenant, loads config, tenant-scoped menu cache |
| `src/app/api/square/process-payment/route.ts` | Tenant-aware payment | ✓ VERIFIED | Calls getTenantSquareConfig(tenantId) |
| `src/app/api/square/customers/cards/route.ts` | Tenant-aware customer cards | ✓ VERIFIED | Plan 40-12 added tenant resolution and config loading |
| `src/app/api/webhooks/square/catalog/route.ts` | Webhook tenant resolution | ✓ VERIFIED | Calls resolveTenantFromMerchantId on line 409 |
| `src/app/(site)/layout.tsx` | Server-rendered config | ✓ VERIFIED | Calls getTenantSquareConfig and passes to DynamicSquareProvider as props |
| `src/lib/square/client.ts` | Should be deleted | ✓ VERIFIED | File not found (deleted in Plan 40-09) |
| `src/lib/square/simple-client.ts` | Should be deleted | ✓ VERIFIED | File not found (deleted in Plan 40-09) |
| **Test/Debug Routes (NEW GAP)** | | | |
| `src/app/api/square/tax-config/route.ts` | Should use getTenantSquareConfig | ✗ MISSING | Calls listLocations() and listCatalogTaxes() without config parameter |
| `src/app/api/square/test-catalog/route.ts` | Should use getTenantSquareConfig | ✗ MISSING | Calls fetch-client functions without config parameter |
| `src/app/api/square/validate-catalog/route.ts` | Should use getTenantSquareConfig | ✗ MISSING | Calls fetch-client functions without config parameter |
| `src/app/api/square/test-order/route.ts` | Should use getTenantSquareConfig | ✗ MISSING | Calls fetch-client functions without config parameter |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| 19 API routes | getTenantSquareConfig | Direct call with tenantId | ✓ WIRED | All customer routes (7), admin routes (9), webhooks (2), debug-categories (1) |
| getTenantSquareConfig | Vault RPC | createServiceClient().rpc() | ✓ WIRED | Line 53-58 in config.ts, handles RETURNS TABLE array |
| Vault RPC | Default tenant env vars | Fallback chain | ✓ WIRED | Lines 40-49: DEFAULT_TENANT_ID check + getEnvSquareConfig() |
| fetch-client (14 functions) | SquareConfig | First parameter | ✓ WIRED | All parameterized: listCatalogObjects, searchCatalogItems, createOrder, etc. |
| Domain layer (4 files) | fetch-client | Pass-through config | ✓ WIRED | catalog.ts, orders.ts, customers.ts, tax-validation.ts |
| Webhooks (2 routes) | resolveTenantFromMerchantId | merchant_id from payload | ✓ WIRED | catalog webhook line 409, inventory webhook uses same pattern |
| Site layout | DynamicSquareProvider | Server-rendered publicSquareConfig | ✓ WIRED | getTenantSquareConfig → filter to public fields → provider props |
| Scripts (3 files) | Vault RPC | service_role client | ✓ WIRED | sync-square-catalog, seed-inventory, setup-square-webhooks |
| **4 test/debug routes** | fetch-client | Direct calls | ✗ NOT_WIRED | Missing tenant resolution and config parameter passing |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/lib/square/config.ts | 87-104 | process.env reads in getEnvSquareConfig | ℹ️ Info | Intentional fallback for default tenant |
| src/app/api/square/tax-config/route.ts | 9, 27 | fetch-client calls without config | 🛑 Blocker | Breaks TypeScript build |
| src/app/api/square/test-catalog/route.ts | Multiple | fetch-client calls without config | 🛑 Blocker | Breaks TypeScript build |
| src/app/api/square/validate-catalog/route.ts | Multiple | fetch-client calls without config | 🛑 Blocker | Breaks TypeScript build |
| src/app/api/square/test-order/route.ts | Multiple | fetch-client calls without config | 🛑 Blocker | Breaks TypeScript build |

### Gaps Summary

**Regression identified:** Plan 40-12 successfully closed the customer routes gap (cards, delete-card, save-card), BUT the TypeScript build now fails due to 4 test/debug routes that were missed in all previous plans.

**Root cause:** These routes are in `/api/square/` but are test/debug utilities, not customer-facing or admin features. They were not covered by:
- Plan 40-05 (customer-facing routes) — focused on production routes only
- Plan 40-06 (admin routes) — focused on `/api/admin/*` only
- Plan 40-11 (admin menu gap closure) — focused on `/api/admin/menu/*` only
- Plan 40-12 (customer routes gap closure) — focused on `/api/square/customers/*` only

**Impact:** TypeScript build fails with "Expected 1 arguments, but got 0" error in tax-config/route.ts line 9. This blocks all development and deployment.

**Affected routes:**
1. `/api/square/tax-config` — Debug route for inspecting Square tax configuration
2. `/api/square/test-catalog` — Test route for Square catalog operations
3. `/api/square/validate-catalog` — Validation route for Square catalog integrity
4. `/api/square/test-order` — Test route for Square order creation

**Fix required:** Apply the same tenant-aware transformation from Plans 40-05/40-11/40-12:
1. Import getCurrentTenantId and getTenantSquareConfig
2. Add tenant resolution after any auth checks
3. Pass squareConfig as first parameter to all fetch-client calls
4. Return 503 if squareConfig is null

### Human Verification Required

#### 1. Test Multi-Tenant Square Isolation
**Test:** Set up two tenants with different Square sandbox accounts. Add menu items to each. Browse menu on each subdomain.
**Expected:** Tenant A shows only Tenant A's menu. Tenant B shows only Tenant B's menu. No cross-tenant leakage.
**Why human:** Requires actual Square sandbox accounts and multi-tenant configuration.

#### 2. Test Webhook Tenant Resolution
**Test:** Trigger catalog update webhook from Square sandbox for Tenant A. Check database.
**Expected:** Webhook resolves merchant_id to Tenant A, updates only Tenant A's inventory records.
**Why human:** Requires live Square webhook delivery and database inspection.

#### 3. Test Payment Flow with Tenant Credentials
**Test:** Complete checkout flow on Tenant A subdomain using Tenant A's Square location.
**Expected:** Payment processes successfully. Order appears in Tenant A's Square dashboard only.
**Why human:** Requires live payment processing and Square dashboard verification.

### Re-Verification Summary

**Previous verification (2026-02-14T19:35:00Z):** 10/10 truths verified, status: passed

**Changes since last verification:**
- Plan 40-12 executed successfully (customer routes gap closed)
- TypeScript build now fails (regression discovered)

**New gaps found:**
1. **4 test/debug routes missing tenant-aware updates** — Blocks TypeScript build, prevents deployment

**Regressions:**
- TypeScript build status: PASSED → FAILED

**Root cause of regression:**
- Plans 40-01 through 40-12 systematically covered production routes (customer-facing, admin, webhooks, scripts)
- Test/debug routes in `/api/square/` were overlooked because they don't fit into customer/admin/webhook categories
- These routes are not used in production flows but still need to pass TypeScript type checking

**Recommendation:**
Create Plan 40-13 to fix the 4 test/debug routes. Low risk change (same pattern as 40-05/40-11/40-12). After 40-13, TypeScript build should pass and Phase 40 will be complete.

---

_Verified: 2026-02-15T03:40:00Z_
_Verifier: Claude Code (gsd-verifier)_
_Re-verification after Plan 40-12 — TypeScript build regression discovered_
