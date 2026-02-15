---
phase: 40-tenant-aware-square-integration
verified: 2026-02-14T19:35:00Z
status: passed
score: 10/10 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 8/10
  gaps_closed:
    - "All admin routes load credentials via getTenantSquareConfig()"
    - "TypeScript build passes with no new errors"
  gaps_remaining: []
  regressions: []
---

# Phase 40: Tenant-Aware Square Integration Verification Report

**Phase Goal:** Every Square API call uses the correct tenant's credentials loaded from Supabase Vault (with env var fallback for default tenant). Webhooks resolve tenant from merchant_id. Frontend config is server-rendered.

**Verified:** 2026-02-14T19:35:00Z
**Status:** passed
**Re-verification:** Yes — after Plan 40-11 gap closure

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Vault infrastructure exists for credential storage | ✓ VERIFIED | Migration 20260215000000_vault_square_credentials.sql exists with vault_id columns and SECURITY DEFINER functions |
| 2 | getTenantSquareConfig() loads credentials from Vault with env fallback | ✓ VERIFIED | src/lib/square/config.ts implements RPC call to get_tenant_square_credentials_internal with cache and fallback |
| 3 | All fetch-client.ts functions accept SquareConfig as first parameter | ✓ VERIFIED | All 14 functions parameterized (listCatalogObjects, searchCatalogItems, createOrder, createPayment, etc.) |
| 4 | Domain layer (catalog, orders, tax, customers) passes config through | ✓ VERIFIED | catalog.ts, orders.ts, tax-validation.ts, customers.ts all accept and forward SquareConfig |
| 5 | Customer-facing routes load config per-request | ✓ VERIFIED | menu, config, payment, order-preview routes call getTenantSquareConfig(tenantId) |
| 6 | Webhooks resolve tenant from merchant_id | ✓ VERIFIED | catalog and inventory webhooks use resolveTenantFromMerchantId() and load per-tenant config |
| 7 | Frontend config is server-rendered | ✓ VERIFIED | Site layout calls getTenantSquareConfig and passes to DynamicSquareProvider as props; CheckoutModal uses useSquareConfig() hook |
| 8 | Setup scripts support tenant flags | ✓ VERIFIED | sync-square-catalog.js, seed-inventory.js, setup-square-webhooks.js accept --tenant-id and --tenant-slug |
| 9 | All admin routes load credentials via getTenantSquareConfig() | ✓ VERIFIED | All 9 admin routes that interact with Square now load config (Plan 40-11 fixed categories and items routes) |
| 10 | TypeScript build passes with no new errors | ✓ VERIFIED | Build passes; only pre-existing test file errors remain (unrelated to Phase 40) |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260215000000_vault_square_credentials.sql` | Vault infrastructure migration | ✓ VERIFIED | Exists with vault_id columns, SECURITY DEFINER functions, audit table, merchant_id index |
| `src/lib/square/types.ts` | SquareConfig interface | ✓ VERIFIED | Clean 12-line interface with all required fields |
| `src/lib/square/config.ts` | getTenantSquareConfig() and resolveTenantFromMerchantId() | ✓ VERIFIED | 128 lines with RPC call, caching, env fallback, merchant resolution |
| `src/lib/square/fetch-client.ts` | Parameterized Square API client | ✓ VERIFIED | All 14 functions accept SquareConfig, zero env var reads |
| `src/lib/square/catalog.ts` | Parameterized domain layer | ✓ VERIFIED | Accepts and forwards SquareConfig |
| `src/lib/square/orders.ts` | Parameterized with tenant-scoped cache | ✓ VERIFIED | catalogCacheByTenant Map, tenantId parameter, generic source name |
| `src/app/api/menu/route.ts` | Tenant-aware menu API | ✓ VERIFIED | Resolves tenant, loads config, tenant-scoped cache |
| `src/app/api/square/process-payment/route.ts` | Tenant-aware payment | ✓ VERIFIED | Calls getTenantSquareConfig(tenantId) |
| `src/app/api/webhooks/square/catalog/route.ts` | Webhook merchant_id resolution | ✓ VERIFIED | Calls resolveTenantFromMerchantId on line 409 |
| `src/app/(site)/layout.tsx` | Server-rendered config | ✓ VERIFIED | Calls getTenantSquareConfig and passes to provider |
| `src/providers/SquareProvider.tsx` | Extended context with config fields | ✓ VERIFIED | useSquareConfig() hook, applicationId/locationId in context |
| `src/components/CheckoutModal.tsx` | Uses context instead of env vars | ✓ VERIFIED | Calls useSquareConfig() on line 176, zero env var reads |
| `src/lib/square/client.ts` | Should be deleted | ✓ VERIFIED | File not found (correctly deleted in Plan 09) |
| `src/lib/square/simple-client.ts` | Should be deleted | ✓ VERIFIED | File not found (correctly deleted in Plan 09) |
| `src/app/api/admin/menu/categories/route.ts` | Tenant-aware admin route | ✓ VERIFIED | Imports getTenantSquareConfig, resolves tenant in all 4 handlers, passes config to all Square functions |
| `src/app/api/admin/menu/items/route.ts` | Tenant-aware admin route | ✓ VERIFIED | Imports getTenantSquareConfig, resolves tenant in 2 handlers, passes config to all Square functions |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| API routes | getTenantSquareConfig | Direct call with tenantId | ✓ WIRED | Customer routes (menu, payment, order-preview) and all 9 admin routes call successfully |
| getTenantSquareConfig | Vault RPC | createServiceClient().rpc('get_tenant_square_credentials_internal') | ✓ WIRED | Line 53-58 in config.ts, handles RETURNS TABLE array |
| Vault RPC | Default tenant env vars | Fallback chain in config.ts | ✓ WIRED | Lines 40-49: checks DEFAULT_TENANT_ID and calls getEnvSquareConfig() |
| fetch-client functions | SquareConfig | First parameter | ✓ WIRED | All 14 functions (listCatalogObjects, searchCatalogItems, createOrder, etc.) |
| Domain layer | fetch-client | Pass-through config | ✓ WIRED | catalog.ts, orders.ts, tax-validation.ts forward config parameter |
| Webhooks | resolveTenantFromMerchantId | merchant_id from payload | ✓ WIRED | catalog webhook line 409, inventory webhook uses same pattern |
| Site layout | DynamicSquareProvider | Server-rendered props | ✓ WIRED | getTenantSquareConfig → publicSquareConfig → provider props |
| CheckoutModal | useSquareConfig hook | Context consumption | ✓ WIRED | Line 176: destructures applicationId, locationId from context |
| Scripts | Vault credentials | service_role RPC | ✓ WIRED | sync-square-catalog.js loads via get_tenant_square_credentials_internal |
| Admin routes (9/9) | getTenantSquareConfig | Direct call with tenantId | ✓ WIRED | sync-square, push-to-square, sales-sync, square-search, items/[itemId], availability, cogs/sync-square, categories, items all verified |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/lib/square/config.ts | 87-104 | process.env reads in getEnvSquareConfig | ℹ️ Info | Intentional fallback for default tenant, documented in plan |

### Human Verification Required

#### 1. Test Multi-Tenant Square Isolation

**Test:** Set up two tenants with different Square sandbox accounts. Add menu items to each tenant's Square catalog. Browse menu on each tenant's subdomain.

**Expected:** Tenant A shows only Tenant A's menu items. Tenant B shows only Tenant B's menu items. No cross-tenant data leakage.

**Why human:** Requires actual Square sandbox accounts and multi-tenant configuration which can't be simulated in code verification.

#### 2. Test Webhook Tenant Resolution

**Test:** Trigger catalog update webhook from Square sandbox for Tenant A. Check database to verify sync only updated Tenant A's inventory.

**Expected:** Webhook correctly resolves merchant_id to Tenant A, updates only Tenant A's records in inventory table.

**Why human:** Requires live Square webhook delivery and database inspection.

#### 3. Test Payment Flow with Tenant Credentials

**Test:** Complete checkout flow on Tenant A subdomain using Tenant A's Square location.

**Expected:** Payment processes successfully using Tenant A's Square access token and location ID. Order appears in Tenant A's Square dashboard.

**Why human:** Requires live payment processing and Square dashboard verification.

#### 4. Test Vault Credential Storage

**Test:** Create new tenant via platform admin (when Phase 60 ships). Set Square credentials via tenant settings UI. Verify credentials stored in Vault, not plain columns.

**Expected:** tenants.square_access_token_vault_id is populated, plain column remains null. getTenantSquareConfig successfully loads from Vault.

**Why human:** Requires Vault write operation via tenant management UI that doesn't exist in Phase 40 scope.

### Re-Verification Summary

**Previous verification (2026-02-14T21:30:00Z):** 8/10 truths verified, gaps_found

**Gaps closed by Plan 40-11:**

1. **Admin menu category management route** — src/app/api/admin/menu/categories/route.ts now resolves tenant and passes SquareConfig to all Square function calls (GET, POST, PUT, DELETE handlers)

2. **Admin menu item management route** — src/app/api/admin/menu/items/route.ts now resolves tenant and passes SquareConfig to all Square function calls (GET, POST handlers)

**TypeScript build:** Now passes with no Phase 40-related errors

**Regressions:** None — all 8 previously passing truths still verified

**New status:** All 10 truths verified, phase goal achieved

---

_Verified: 2026-02-14T19:35:00Z_
_Verifier: Claude Code (gsd-verifier)_
_Re-verification after Plan 40-11 gap closure_
