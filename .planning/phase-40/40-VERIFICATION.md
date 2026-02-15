---
phase: 40-tenant-aware-square-integration
verified: 2026-02-15T09:00:00Z
status: passed
score: 10/10 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 9/10
  gaps_closed:
    - "TypeScript build passes with zero errors"
  gaps_remaining: []
  regressions: []
---

# Phase 40: Tenant-Aware Square Integration Verification Report

**Phase Goal:** Every Square API call uses the correct tenant's credentials loaded from Supabase Vault (with env var fallback for default tenant). Webhooks resolve tenant from merchant_id. Frontend config is server-rendered.

**Verified:** 2026-02-15T09:00:00Z
**Status:** passed
**Re-verification:** Yes — after Plan 40-13 completion (test/debug routes gap closure)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Vault infrastructure exists for credential storage | ✓ VERIFIED | Migration `20260215000000_vault_square_credentials.sql` (228 lines, 8074 bytes) with vault_id columns, SECURITY DEFINER functions, audit table, merchant_id index |
| 2 | getTenantSquareConfig() loads credentials from Vault with env fallback | ✓ VERIFIED | `src/lib/square/config.ts` implements RPC call with 60s cache and DEFAULT_TENANT_ID fallback to env vars |
| 3 | All fetch-client.ts functions accept SquareConfig as first parameter | ✓ VERIFIED | All 14 exported functions parameterized: `listLocations(squareConfig)`, `createOrder(squareConfig, orderData)`, etc. Zero `process.env` reads in fetch-client.ts |
| 4 | Domain layer (catalog, orders, tax, customers) passes config through | ✓ VERIFIED | All 4 domain files accept SquareConfig; orders.ts has tenant-scoped catalog cache (`catalogCacheByTenant`) |
| 5 | Customer-facing routes load config per-request | ✓ VERIFIED | All 7 customer routes (menu, config, payment, order-preview, cards, delete-card, save-card) use `getTenantSquareConfig(tenantId)` |
| 6 | Webhooks resolve tenant from merchant_id | ✓ VERIFIED | Both webhooks (catalog, inventory) use `resolveTenantFromMerchantId()` from merchant_id in payload |
| 7 | Frontend config is server-rendered | ✓ VERIFIED | Site layout server-renders via `getTenantSquareConfig()` and passes `publicSquareConfig` to `DynamicSquareProvider` |
| 8 | Setup scripts support tenant flags | ✓ VERIFIED | All 3 scripts (sync-square-catalog, seed-inventory, setup-square-webhooks) accept `--tenant-id` and `--tenant-slug`, use service_role RPC |
| 9 | All admin routes load credentials via getTenantSquareConfig() | ✓ VERIFIED | All 9 admin routes verified (sync-square, push-to-square, sales-sync, square-search, items/[itemId], availability, cogs/sync, categories, items) |
| 10 | TypeScript build passes with zero errors | ✓ VERIFIED | `npm run build` succeeds with no TypeScript errors; all Square API routes type-check correctly |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260215000000_vault_square_credentials.sql` | Vault infrastructure | ✓ VERIFIED | 228 lines, has `square_access_token_vault_id`, `square_webhook_signature_key_vault_id`, 3 SECURITY DEFINER functions, `credential_audit_log` table, `idx_tenants_square_merchant_id` index |
| `src/lib/square/types.ts` | SquareConfig interface | ✓ VERIFIED | Clean interface with 6 fields: accessToken, applicationId, locationId, environment, merchantId, webhookSignatureKey |
| `src/lib/square/config.ts` | getTenantSquareConfig() + resolveTenantFromMerchantId() | ✓ VERIFIED | 129 lines, RPC call to `get_tenant_square_credentials_internal`, 60s cache, env fallback for DEFAULT_TENANT_ID, merchant resolution function |
| `src/lib/square/fetch-client.ts` | Parameterized Square API client | ✓ VERIFIED | All 14 functions accept SquareConfig as first parameter, zero `process.env` reads |
| `src/lib/square/catalog.ts` | Parameterized domain layer | ✓ VERIFIED | All 3 exports (`getMenuCategories`, `getMenuItems`, `fetchMenuCategories`) accept SquareConfig |
| `src/lib/square/orders.ts` | Parameterized with tenant-scoped cache | ✓ VERIFIED | `catalogCacheByTenant` Map keyed by tenantId, all exports accept config + tenantId |
| `src/lib/square/customers.ts` | Parameterized domain layer | ✓ VERIFIED | All customer functions accept SquareConfig as first parameter |
| `src/app/api/menu/route.ts` | Tenant-aware menu API | ✓ VERIFIED | Resolves tenant via `getCurrentTenantId()`, loads config, uses tenant-scoped menu cache |
| `src/app/api/square/process-payment/route.ts` | Tenant-aware payment | ✓ VERIFIED | Calls `getTenantSquareConfig(tenantId)` on line 27 |
| `src/app/api/square/customers/cards/route.ts` | Tenant-aware customer cards | ✓ VERIFIED | Plan 40-12 added tenant resolution and config loading |
| `src/app/api/webhooks/square/catalog/route.ts` | Webhook tenant resolution | ✓ VERIFIED | Calls `resolveTenantFromMerchantId()` from merchant_id in payload |
| `src/app/(site)/layout.tsx` | Server-rendered config | ✓ VERIFIED | Calls `getTenantSquareConfig(tenantId)` and passes `publicSquareConfig` to DynamicSquareProvider |
| `src/lib/square/client.ts` | Should be deleted | ✓ VERIFIED | File not found (deleted in Plan 40-09) |
| `src/lib/square/simple-client.ts` | Should be deleted | ✓ VERIFIED | File not found (deleted in Plan 40-09) |
| **Test/Debug Routes (Plan 40-13)** | | | |
| `src/app/api/square/tax-config/route.ts` | Tenant-aware tax config | ✓ VERIFIED | Uses `getTenantSquareConfig()`, passes config to `listLocations(squareConfig)` and `listCatalogTaxes(squareConfig)` |
| `src/app/api/square/test-catalog/route.ts` | Tenant-aware test catalog | ✓ VERIFIED | Uses `getTenantSquareConfig()`, passes config to `listCatalogObjects(squareConfig, ...)` |
| `src/app/api/square/validate-catalog/route.ts` | Tenant-aware validate catalog | ✓ VERIFIED | Uses `getTenantSquareConfig()`, passes config to `listCatalogObjects(squareConfig, ...)` |
| `src/app/api/square/test-order/route.ts` | Tenant-aware test order | ✓ VERIFIED | Uses `getTenantSquareConfig()`, passes config to `createOrder(squareConfig, orderData)` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| 11 API routes using fetch-client | getTenantSquareConfig | Direct call with tenantId | ✓ WIRED | All 11 routes that import from fetch-client also import and call getTenantSquareConfig |
| getTenantSquareConfig | Vault RPC | createServiceClient().rpc() | ✓ WIRED | Line 53-58 in config.ts calls `get_tenant_square_credentials_internal` |
| Vault RPC | Default tenant env vars | Fallback chain | ✓ WIRED | Lines 40-49 in config.ts: DEFAULT_TENANT_ID check → getEnvSquareConfig() |
| fetch-client (14 functions) | SquareConfig | First parameter | ✓ WIRED | All parameterized: `listCatalogObjects(config, types)`, `createOrder(config, orderData)`, etc. |
| Domain layer (4 files) | fetch-client | Pass-through config | ✓ WIRED | catalog.ts, orders.ts, customers.ts, tax-validation.ts all accept and pass SquareConfig |
| Webhooks (2 routes) | resolveTenantFromMerchantId | merchant_id from payload | ✓ WIRED | catalog webhook and inventory webhook both use merchant_id resolution |
| Site layout | DynamicSquareProvider | Server-rendered publicSquareConfig | ✓ WIRED | getTenantSquareConfig → filter to public fields → provider props |
| Scripts (3 files) | Vault RPC | service_role client | ✓ WIRED | sync-square-catalog, seed-inventory, setup-square-webhooks all use tenant flags |

### Requirements Coverage

All Phase 40 requirements from ROADMAP.md satisfied:

- ✓ Every Square API call uses correct tenant's credentials
- ✓ Credentials loaded from Supabase Vault with env var fallback for default tenant
- ✓ Webhooks resolve tenant from merchant_id in payload
- ✓ Frontend config is server-rendered (no client-side env vars)
- ✓ Zero direct env var reads in Square routes (only in getEnvSquareConfig fallback)
- ✓ All 23 Square API routes are tenant-aware (19 production + 4 test/debug)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/lib/square/config.ts | 87-104 | process.env reads in getEnvSquareConfig | ℹ️ Info | Intentional fallback for default tenant, documented decision |
| None | - | - | - | All test/debug routes now tenant-aware after Plan 40-13 |

**Zero blocker anti-patterns.** All intentional patterns documented.

### Gaps Summary

**All gaps closed.** Plan 40-13 fixed the final TypeScript build blocker by updating 4 test/debug routes (tax-config, test-catalog, validate-catalog, test-order) to use tenant-aware credential loading.

**Summary of 40-13:**
- ✓ All 4 planned routes updated with getTenantSquareConfig()
- ✓ 2 additional test routes discovered and fixed (test-catalog at /api/test-catalog, test-square at /api/test-square)
- ✓ All fetch-client function calls receive SquareConfig as first parameter
- ✓ TypeScript build passes with zero errors
- ✓ Phase 40 complete: Every Square API call in entire codebase uses correct tenant's credentials

### Re-Verification Summary

**Previous verification (2026-02-15T03:40:00Z):** 9/10 truths verified, status: gaps_found

**Changes since last verification:**
- Plan 40-13 executed: 4 test/debug routes updated with tenant-aware credential loading
- 2 additional test routes discovered and fixed during verification
- TypeScript build now passes with zero errors

**Gaps closed:**
1. **TypeScript build passes with zero errors** — All 6 test/debug routes now call fetch-client functions with SquareConfig parameter

**Regressions:** None

**Current status:** All 10 must-haves verified, all gaps closed, Phase 40 complete

---

## Human Verification (Optional)

While all automated checks pass, these items can be manually tested for completeness:

### 1. Test Multi-Tenant Square Isolation
**Test:** Set up two tenants with different Square sandbox accounts via platform admin. Add different menu items to each. Browse menu on each subdomain.
**Expected:** Tenant A shows only Tenant A's menu. Tenant B shows only Tenant B's menu. No cross-tenant leakage in menu cache.
**Why human:** Requires actual Square sandbox accounts and multi-tenant configuration via platform admin (Phase 60).

### 2. Test Webhook Tenant Resolution
**Test:** Trigger catalog update webhook from Square sandbox for Tenant A. Check `webhook_events` and inventory tables.
**Expected:** Webhook resolves merchant_id to Tenant A, updates only Tenant A's inventory records. Logs show correct tenant_id.
**Why human:** Requires live Square webhook delivery and database inspection.

### 3. Test Payment Flow with Tenant Credentials
**Test:** Complete checkout flow on Tenant A subdomain using Tenant A's Square location.
**Expected:** Payment processes successfully. Order appears in Tenant A's Square dashboard only, not in Tenant B or default tenant.
**Why human:** Requires live payment processing and Square dashboard verification.

### 4. Test Vault Credential Rotation
**Test:** Use platform admin (Phase 60) to rotate Square credentials for Tenant A. Verify old credentials stop working and new credentials work.
**Expected:** After rotation, all Tenant A API calls use new credentials from Vault. Old credentials return 401 from Square.
**Why human:** Requires platform admin UI and multiple Square credential sets.

---

## Summary

**Phase 40 is COMPLETE and VERIFIED.**

All 10 must-haves verified:
1. ✓ Vault infrastructure (migration, functions, audit, index)
2. ✓ getTenantSquareConfig() with Vault RPC + env fallback
3. ✓ fetch-client.ts fully parameterized (14 functions)
4. ✓ Domain layer accepts and passes SquareConfig
5. ✓ Customer routes load config per-request (7 routes)
6. ✓ Webhooks resolve tenant from merchant_id (2 webhooks)
7. ✓ Frontend config server-rendered
8. ✓ Setup scripts support tenant flags (3 scripts)
9. ✓ Admin routes load credentials (9 routes)
10. ✓ TypeScript build passes with zero errors

**Total Square API routes tenant-aware:** 23
- Customer-facing: 7 (menu, config, payment, order-preview, cards, delete-card, save-card)
- Admin: 9 (sync-square, push-to-square, sales-sync, square-search, items/[itemId], availability, cogs/sync, categories, items)
- Webhooks: 2 (catalog, inventory)
- Test/Debug: 6 (tax-config, test-catalog, validate-catalog, test-order, test-catalog [/api], test-square)
- Other: 1 (debug-categories)

**Dead code removed:**
- `src/lib/square/client.ts` ✓ deleted
- `src/lib/square/simple-client.ts` ✓ deleted
- 5 test routes deleted (test-connection, test-square-simple, etc.)

**Next phase ready:** Phase 50 (Tenant-Aware Auth & Business Identity)

---

_Verified: 2026-02-15T09:00:00Z_
_Verifier: Claude Code (gsd-verifier)_
_Final verification after Plan 40-13 — All gaps closed, phase complete_
