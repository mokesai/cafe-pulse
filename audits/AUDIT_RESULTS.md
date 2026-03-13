# Multi-Tenant Security Audit Results

**Date:** 2026-02-16
**Phase:** 70-02 Integration Testing & Hardening
**Auditor:** Automated scripts (service-role-audit.sh, cache-audit.sh)

## Executive Summary

Comprehensive security audit of all service-role queries and module-level caches to identify potential cross-tenant data leakage risks.

### Service-Role Query Analysis

- **Total usages analyzed:** 82 files
- **✓ PASS:** 18 files (22%)
- **⚠️  WARNING:** 0 files
- **✗ FAIL:** 64 files (78%)

### Cache Analysis

- **Total caches analyzed:** 3 caches
- **✓ PASS:** 2 caches (tenant cache, Square config cache)
- **⚠️  WARNING:** 1 cache (site status cache)
- **✗ FAIL:** 0 caches

### Risk Assessment

**OVERALL RISK LEVEL: HIGH**

The audit identified 64 files with service-role queries that lack explicit tenant_id filtering, creating a CRITICAL risk of cross-tenant data leakage. These files use `createServiceClient()` to bypass RLS policies but do not add `.eq('tenant_id', tenantId)` filters to their queries.

**Impact:** Without explicit filtering, these queries can return data from ALL tenants, potentially exposing:
- Customer orders and personal information
- Inventory and COGS data
- Purchase orders and supplier information
- Admin configurations
- KDS menu items and settings

**Mitigating factors:**
- Most affected routes are in `/api/admin/*` which require admin authentication
- Admin middleware may provide some tenant isolation
- No platform admin routes affected (they correctly use service-role without filtering)

**Critical gaps:**
- Service-role queries in lib/ modules (siteSettings.ts, kds/queries.ts, supabase/database.ts, tenant/identity.ts, admin/setup.ts) are callable from multiple contexts
- Webhook routes (src/app/api/webhooks/square/*) lack tenant_id filtering

---

## Section 1: Service-Role Query Findings

### 1.1 PASS - Correctly Implemented (18 files)

These files correctly use service-role queries with explicit tenant_id filtering OR are platform admin routes that legitimately need to see all tenants.

#### Platform Admin Routes (6 files) ✓

Platform admin routes **should** use service-role without tenant filtering because they need to manage all tenants.

1. `src/app/api/platform/square-oauth/callback/route.ts` - OAuth callback for all tenants
2. `src/app/platform/page.tsx` - Platform dashboard
3. `src/app/platform/tenants/[tenantId]/edit/page.tsx` - Tenant edit page
4. `src/app/platform/tenants/[tenantId]/page.tsx` - Tenant detail page
5. `src/app/platform/tenants/actions.ts` - Tenant management actions
6. `src/app/platform/tenants/page.tsx` - Tenant list page

#### Tenant-Scoped Service Queries (5 files) ✓

These admin routes correctly use service-role with explicit `.eq('tenant_id', tenantId)` filters:

1. `src/app/api/admin/cogs/products/route.ts`
   - Lines with filtering: `.eq('tenant_id', tenantId)`

2. `src/app/api/admin/cogs/report/route.ts`
   - Lines with filtering: 194, 210, 220 - all have `.eq('tenant_id', tenantId)`

3. `src/app/api/admin/dashboard/stats/route.ts`
   - Uses tenant_id filtering

4. `src/app/api/admin/inventory/route.ts`
   - Uses tenant_id filtering

5. `src/app/api/admin/invoices/route.ts`
   - Uses tenant_id filtering

6. `src/app/api/admin/orders/route.ts`
   - Uses tenant_id filtering

7. `src/app/api/admin/purchase-orders/route.ts`
   - Uses tenant_id filtering

8. `src/app/api/admin/suppliers/route.ts`
   - Uses tenant_id filtering

#### Specialized Use Cases (7 files) ✓

1. `src/lib/square/config.ts` - Uses RPC `get_tenant_square_credentials_internal` with `p_tenant_id` parameter
2. `src/lib/tenant/context.ts` - Queries `tenants` table for tenant resolution (legitimately needs to search across tenants)
3. `src/lib/supabase/server.ts` - No queries (only client creation)
4. `src/app/api/admin/purchase-orders/[orderId]/pdf/route.ts` - No .from() queries

### 1.2 FAIL - Missing Tenant Filtering (64 files)

These files use `createServiceClient()` with `.from()` queries but lack explicit `.eq('tenant_id', tenantId)` filtering.

**Risk Level:** CRITICAL - Can leak cross-tenant data

#### Category: COGS (Cost of Goods Sold) Routes (17 files)

1. **src/app/api/admin/cogs/catalog/sync-square/route.ts**
   - Queries: `cogs_products` (lines 204, 214), `cogs_sellables` (line 243)
   - Fix: Add `.eq('tenant_id', tenantId)` to all queries

2. **src/app/api/admin/cogs/modifier-option-recipes/[id]/route.ts**
   - Queries: `cogs_modifier_option_recipes` (lines 47, 119, 129), `cogs_modifier_option_recipe_lines` (lines 57, 144)
   - Fix: Add `.eq('tenant_id', tenantId)` to all queries

3. **src/app/api/admin/cogs/modifier-option-recipes/route.ts**
   - Queries: `cogs_modifier_option_recipes` (lines 41, 103), `cogs_modifier_option_recipe_lines` (line 119)
   - Fix: Add `.eq('tenant_id', tenantId)` to all queries

4. **src/app/api/admin/cogs/modifiers/options/route.ts**
   - Queries: `cogs_modifier_options` (lines 19, 58)
   - Fix: Add `.eq('tenant_id', tenantId)` to all queries

5. **src/app/api/admin/cogs/modifiers/seen/route.ts**
   - Queries: `sales_transaction_items` (line 30)
   - Fix: Add `.eq('tenant_id', tenantId)` to all queries

6. **src/app/api/admin/cogs/modifiers/sets/route.ts**
   - Queries: `cogs_modifier_sets` (lines 18, 52)
   - Fix: Add `.eq('tenant_id', tenantId)` to all queries

7. **src/app/api/admin/cogs/periods/[id]/close/route.ts**
   - Queries: `invoices` (line 27), `inventory_items` (line 56), `inventory_valuations` (line 82), `cogs_periods` (line 97), `cogs_reports` (line 109)
   - Fix: Add `.eq('tenant_id', tenantId)` to all queries

8. **src/app/api/admin/cogs/periods/[id]/export/route.ts**
   - Queries: `cogs_periods` (line 34), `cogs_reports` (line 44), `inventory_valuations` (line 54)
   - Fix: Add `.eq('tenant_id', tenantId)` to all queries

9. **src/app/api/admin/cogs/periods/route.ts**
   - Queries: `cogs_periods` (lines 24, 64)
   - Fix: Add `.eq('tenant_id', tenantId)` to all queries

10. **src/app/api/admin/cogs/product-recipes/[id]/route.ts**
    - Queries: `cogs_product_recipes` (lines 47, 129, 139), `cogs_product_recipe_lines` (lines 57, 156)
    - Fix: Add `.eq('tenant_id', tenantId)` to all queries

11. **src/app/api/admin/cogs/product-recipes/route.ts**
    - Queries: `cogs_product_recipes` (lines 41, 111), `cogs_product_recipe_lines` (line 129)
    - Fix: Add `.eq('tenant_id', tenantId)` to all queries

12. **src/app/api/admin/cogs/products/[id]/route.ts**
    - Queries: `cogs_products` (line 35)
    - Fix: Add `.eq('tenant_id', tenantId)` to all queries

13. **src/app/api/admin/cogs/sellable-overrides/[id]/route.ts**
    - Queries: `cogs_sellable_recipe_overrides` (lines 118, 172, 182), `cogs_sellable_recipe_override_ops` (lines 128, 197)
    - Fix: Add `.eq('tenant_id', tenantId)` to all queries

14. **src/app/api/admin/cogs/sellable-overrides/route.ts**
    - Queries: `cogs_sellable_recipe_overrides` (lines 117, 156), `cogs_sellable_recipe_override_ops` (line 172)
    - Fix: Add `.eq('tenant_id', tenantId)` to all queries

15. **src/app/api/admin/cogs/sellables/route.ts**
    - Queries: Multiple (not listed in excerpt)
    - Fix: Add `.eq('tenant_id', tenantId)` to all queries

#### Category: Customer Routes (2 files)

16. **src/app/api/admin/customers/[customerId]/orders/route.ts**
    - Fix: Add `.eq('tenant_id', tenantId)` to all queries

17. **src/app/api/admin/customers/route.ts**
    - Fix: Add `.eq('tenant_id', tenantId)` to all queries

#### Category: Inventory Routes (18 files)

18. **src/app/api/admin/inventory/adjust/route.ts**
19. **src/app/api/admin/inventory/alerts/route.ts**
20. **src/app/api/admin/inventory/analytics/export/route.ts**
21. **src/app/api/admin/inventory/analytics/route.ts**
22. **src/app/api/admin/inventory/cost-history/route.ts**
23. **src/app/api/admin/inventory/locations/[locationId]/route.ts**
24. **src/app/api/admin/inventory/locations/route.ts**
25. **src/app/api/admin/inventory/push-to-square/route.ts**
26. **src/app/api/admin/inventory/restock/route.ts**
27. **src/app/api/admin/inventory/restore/route.ts**
28. **src/app/api/admin/inventory/revert-cost/route.ts**
29. **src/app/api/admin/inventory/sales-sync/route.ts**
30. **src/app/api/admin/inventory/sales-sync/status/route.ts**
31. **src/app/api/admin/inventory/settings/route.ts**
32. **src/app/api/admin/inventory/sync-square/route.ts**
33. **src/app/api/admin/inventory/units/[unitId]/route.ts**
34. **src/app/api/admin/inventory/units/route.ts**

All inventory routes need: Add `.eq('tenant_id', tenantId)` to all queries

#### Category: Invoice Routes (12 files)

35. **src/app/api/admin/invoices/[id]/confirm/route.ts**
36. **src/app/api/admin/invoices/[id]/file/route.ts**
37. **src/app/api/admin/invoices/[id]/link-order/route.ts**
38. **src/app/api/admin/invoices/[id]/match-items/route.ts**
39. **src/app/api/admin/invoices/[id]/match-orders/route.ts**
40. **src/app/api/admin/invoices/[id]/parse/route.ts**
41. **src/app/api/admin/invoices/[id]/route.ts**
42. **src/app/api/admin/invoices/items/[itemId]/create-and-match/route.ts**
43. **src/app/api/admin/invoices/items/[itemId]/match/route.ts**
44. **src/app/api/admin/invoices/items/[itemId]/skip/route.ts**
45. **src/app/api/admin/invoices/upload/route.ts**

All invoice routes need: Add `.eq('tenant_id', tenantId)` to all queries

#### Category: Purchase Order Routes (8 files)

46. **src/app/api/admin/purchase-orders/[orderId]/attachments/[attachmentId]/route.ts**
47. **src/app/api/admin/purchase-orders/[orderId]/attachments/route.ts**
48. **src/app/api/admin/purchase-orders/[orderId]/invoices/[matchId]/route.ts**
49. **src/app/api/admin/purchase-orders/[orderId]/invoices/route.ts**
50. **src/app/api/admin/purchase-orders/[orderId]/items/[itemId]/route.ts**
51. **src/app/api/admin/purchase-orders/[orderId]/receipts/route.ts**
52. **src/app/api/admin/purchase-orders/[orderId]/route.ts**
53. **src/app/api/admin/purchase-orders/[orderId]/send/route.ts**

All purchase order routes need: Add `.eq('tenant_id', tenantId)` to all queries

#### Category: Supplier Routes (3 files)

54. **src/app/api/admin/suppliers/[supplierId]/email-templates/route.ts**
55. **src/app/api/admin/suppliers/[supplierId]/route.ts**
56. **src/app/api/admin/suppliers/bulk-upload/route.ts**

All supplier routes need: Add `.eq('tenant_id', tenantId)` to all queries

#### Category: Webhook Routes (2 files) - HIGH PRIORITY

57. **src/app/api/webhooks/square/catalog/route.ts**
   - **Risk:** CRITICAL - Webhooks receive events from all tenants
   - Fix: Must use `resolveTenantFromMerchantId()` then filter all queries by resolved tenant_id

58. **src/app/api/webhooks/square/inventory/route.ts**
   - **Risk:** CRITICAL - Webhooks receive events from all tenants
   - Fix: Must use `resolveTenantFromMerchantId()` then filter all queries by resolved tenant_id

#### Category: Shared Library Modules (5 files) - HIGH PRIORITY

59. **src/lib/admin/setup.ts**
   - Queries: `profiles` (lines 24, 44, 63)
   - **Risk:** HIGH - Used by multiple routes, affects all callers
   - Fix: Add tenantId parameter to functions, filter all queries

60. **src/lib/kds/queries.ts**
   - Queries: `kds_categories` (lines 84, 106), `kds_menu_items` (lines 125, 148), `kds_images` (line 171)
   - **Risk:** HIGH - Used by KDS display pages
   - Fix: Add tenantId parameter to all query functions, filter by tenant_id

61. **src/lib/services/siteSettings.ts**
   - Queries: `site_settings` (lines 20, 69, 84, 112, 130)
   - **Risk:** HIGH - Site settings should be per-tenant
   - Fix: Add tenantId parameter, filter all queries by tenant_id

62. **src/lib/supabase/database.ts**
   - Queries: `profiles` (lines 9, 26, 39), `orders` (line 89), `order_items` (line 117)
   - **Risk:** HIGH - Core database utilities used throughout app
   - Fix: Add tenantId parameter to all functions, filter all queries

63. **src/lib/tenant/identity.ts**
   - Queries: `tenants` (line 26)
   - **Risk:** MEDIUM - Already filters by tenantId via `.eq('id', tenantId)` on line 35
   - **False positive:** Audit script didn't detect `.eq('id', tenantId)` as equivalent to tenant filtering
   - **No action needed** - Query is already correctly filtered

#### Category: Admin Utilities (1 file)

64. **src/app/api/admin/check-role/route.ts**
   - Queries: `profiles` (line 17)
   - Fix: Add `.eq('tenant_id', tenantId)` or use tenant-scoped client instead

---

## Section 2: Cache Findings

### 2.1 PASS - Correctly Implemented (2 caches)

1. **src/lib/tenant/cache.ts - __tenantCache**
   - **Status:** ✓ PASS
   - **Cache structure:** `Map<string, TenantCacheEntry>`
   - **Key pattern:** `slug` (tenant identifier)
   - **Evidence:** `cache.get(slug)` at line 30
   - **Conclusion:** Correctly tenant-scoped

2. **src/lib/square/config.ts - __squareConfigCache**
   - **Status:** ✓ PASS
   - **Cache structure:** `Map<string, { config: SquareConfig; expiresAt: number }>`
   - **Key pattern:** `tenantId`
   - **Evidence:** `cache.get(tenantId)` at line 35
   - **Conclusion:** Correctly tenant-scoped

### 2.2 WARNING - Needs Review (1 cache)

1. **src/lib/services/siteSettings.edge.ts - __siteStatusCacheEdge**
   - **Status:** ⚠️  WARNING
   - **Cache structure:** `CacheEntry | undefined` (singleton, not Map)
   - **Key pattern:** None (single cached value shared across all requests)
   - **Evidence:**
     - Line 13: `var __siteStatusCacheEdge: CacheEntry | undefined`
     - Line 39: `const cache = globalThis.__siteStatusCacheEdge`
     - Line 46: `globalThis.__siteStatusCacheEdge = { status, expiresAt }`
   - **Current behavior:** Single site status shared across all tenants
   - **Risk:** If site status should be per-tenant, Tenant A will see Tenant B's status

   **Recommendation:**
   - **Option A (if site status should be per-tenant):** Refactor to `Map<string, CacheEntry>` keyed by tenantId
   - **Option B (if site status is intentionally global):** Document why shared cache is correct and add comment explaining intentional design

   **Questions to resolve:**
   - Is "site status" (maintenance mode, etc.) a platform-wide setting or per-tenant?
   - If per-tenant, does each tenant have independent maintenance mode control?

---

## Section 3: Recommendations

Priority-ordered list of fixes required:

### Priority 1: CRITICAL - Webhook Routes (2 files)

**Impact:** Webhooks receive events from ALL tenants. Without tenant filtering, webhook handlers could apply Tenant A's event to Tenant B's data.

**Files:**
1. `src/app/api/webhooks/square/catalog/route.ts`
2. `src/app/api/webhooks/square/inventory/route.ts`

**Fix Pattern:**
```typescript
// At the start of webhook handler
const merchantId = event.merchant_id
const tenantId = await resolveTenantFromMerchantId(merchantId)

if (!tenantId) {
  return Response.json({ error: 'Unknown merchant' }, { status: 200 })
}

// In all queries
.from('table_name')
.eq('tenant_id', tenantId)
```

### Priority 2: CRITICAL - Shared Library Modules (4 files)

**Impact:** These modules are used by multiple routes. If uncorrected, they propagate cross-tenant leakage to all callers.

**Files:**
1. `src/lib/admin/setup.ts` - Admin setup utilities
2. `src/lib/kds/queries.ts` - KDS data queries
3. `src/lib/services/siteSettings.ts` - Site settings management
4. `src/lib/supabase/database.ts` - Core database utilities

**Fix Pattern:**
```typescript
// Add tenantId parameter to all exported functions
export async function getKdsCategories(tenantId: string, screen?: KDSScreen) {
  const supabase = createServiceClient()

  const { data } = await supabase
    .from('kds_categories')
    .select('*')
    .eq('tenant_id', tenantId) // Add this
    .order('sort_order')

  return data
}
```

### Priority 3: HIGH - Admin API Routes (54 files)

**Impact:** Admin routes can leak data between tenants if admin user switches tenants or if middleware fails.

**Categories:**
- COGS routes (17 files)
- Inventory routes (18 files)
- Invoice routes (12 files)
- Purchase order routes (8 files)
- Supplier routes (3 files)
- Customer routes (2 files)
- Admin utilities (1 file)

**Fix Pattern:**
```typescript
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(request: Request) {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const { data } = await supabase
    .from('table_name')
    .select('*')
    .eq('tenant_id', tenantId) // Add this to ALL queries

  return Response.json({ data })
}
```

### Priority 4: MEDIUM - Site Status Cache (1 file)

**Impact:** Unclear if intentional. If site status should be per-tenant, shared cache causes wrong status to display.

**File:** `src/lib/services/siteSettings.edge.ts`

**Fix (if per-tenant):**
```typescript
declare global {
  var __siteStatusCacheEdge: Map<string, CacheEntry> | undefined
}

export async function getCachedSiteStatus(
  request: NextRequest,
  tenantId: string,
  forceRefresh = false
): Promise<SiteStatus> {
  const cache = getCache()
  const cached = cache.get(tenantId)

  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.status
  }

  const status = await fetchSiteStatus(request, tenantId)
  cache.set(tenantId, { status, expiresAt: Date.now() + CACHE_TTL_MS })

  return status
}
```

### Priority 5: LOW - False Positives (1 file)

**File:** `src/lib/tenant/identity.ts`

This file is already correctly filtered by `tenantId` via `.eq('id', tenantId)` on line 35. The audit script didn't recognize this pattern.

**No action needed** - Query is secure.

---

## Section 4: Next Steps

### Immediate Actions (This Phase - 70)

1. **Create gap closure plan (70-03):** Address Priority 1 and 2 issues (webhooks + shared libraries)
2. **Review site status cache:** Determine if per-tenant or global, document decision
3. **Update audit scripts:** Improve detection of `.eq('id', tenantId)` patterns to reduce false positives

### Short-Term Actions (Phase 71)

1. **Systematic fix of admin routes:** Add `.eq('tenant_id', tenantId)` to all 54 admin API routes
2. **Add tenant_id parameter to library functions:** Refactor lib/ modules to accept tenantId
3. **Integration tests:** Add E2E tests that verify tenant isolation for fixed routes
4. **RLS policy tests:** Create pgTAP tests to verify database-level isolation

### Long-Term Actions (Phase 72+)

1. **Linting rule:** Create ESLint rule to detect `createServiceClient()` without tenant filtering
2. **Code review checklist:** Add "Does this service-role query filter by tenant_id?" to PR template
3. **Type-level enforcement:** Create typed wrapper around createServiceClient() that requires tenantId parameter
4. **Continuous monitoring:** Run audit scripts in CI/CD, fail builds if new unfiltered queries detected

---

## Section 5: Audit Script Limitations

### Known Issues

1. **False positives:** Script flags `src/lib/tenant/identity.ts` as FAIL even though it correctly filters by `.eq('id', tenantId)`
2. **Pattern detection:** Only detects `.eq('tenant_id')` and `WHERE tenant_id` patterns, misses `.eq('id', tenantId)` in tenants table queries
3. **Context awareness:** Cannot determine if service-role usage is legitimately needed (e.g., platform admin routes, Vault RPC calls)

### Improvements Needed

1. **Expand pattern matching:** Detect `.eq('id', tenantId)` when table is 'tenants'
2. **RPC parameter detection:** Better detection of RPC calls with `p_tenant_id` parameter
3. **Control flow analysis:** Detect if `getCurrentTenantId()` is called earlier in function

### Manual Review Recommended

These categories require human review beyond automated script:

1. **Admin middleware effectiveness:** Does middleware consistently set tenant context?
2. **Service-role necessity:** Are there routes that could use tenant-scoped client instead?
3. **Site settings architecture:** Should site_settings be per-tenant or platform-wide?

---

## Appendix A: Summary Statistics

### Service-Role Queries by Category

| Category | Files | PASS | FAIL | % Secure |
|----------|-------|------|------|----------|
| Platform Admin | 6 | 6 | 0 | 100% |
| COGS | 18 | 2 | 16 | 11% |
| Inventory | 19 | 1 | 18 | 5% |
| Invoices | 13 | 1 | 12 | 8% |
| Purchase Orders | 9 | 1 | 8 | 11% |
| Suppliers | 4 | 1 | 3 | 25% |
| Customers | 2 | 0 | 2 | 0% |
| Webhooks | 2 | 0 | 2 | 0% |
| Shared Libraries | 5 | 2 | 3 | 40% |
| Admin Utilities | 1 | 0 | 1 | 0% |
| Specialized | 3 | 3 | 0 | 100% |
| **TOTAL** | **82** | **18** | **64** | **22%** |

### Caches by Risk Level

| Cache | Risk Level | Action Required |
|-------|------------|-----------------|
| __tenantCache | NONE | No action - correctly scoped |
| __squareConfigCache | NONE | No action - correctly scoped |
| __siteStatusCacheEdge | MEDIUM | Review architecture decision |

---

## Appendix B: Quick Reference - Fix Checklist

For each file in the FAIL category:

- [ ] Import `getCurrentTenantId` from `@/lib/tenant/context`
- [ ] Call `const tenantId = await getCurrentTenantId()` at start of handler
- [ ] Add `.eq('tenant_id', tenantId)` to EVERY `.from()` query
- [ ] Verify no queries bypass the filter
- [ ] Test with multiple tenants to confirm isolation
- [ ] Run audit script again to verify PASS status

---

**End of Audit Report**

Generated by:
- `audits/service-role-audit.sh`
- `audits/cache-audit.sh`

Full findings available in:
- `audits/service-role-findings.txt`
- `audits/cache-findings.txt`
- `audits/service-role-output.txt`
- `audits/cache-output.txt`
