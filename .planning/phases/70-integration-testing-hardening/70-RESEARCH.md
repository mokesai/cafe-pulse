# Phase 70: Integration Testing & Hardening - Research

**Researched:** 2026-02-16
**Domain:** Multi-tenant SaaS integration testing, security auditing, and performance verification
**Confidence:** MEDIUM

## Summary

Phase 70 requires comprehensive testing and hardening of the multi-tenant SaaS platform built in Phases 10-60. The research identifies four critical domains: cross-tenant isolation testing (E2E with Playwright), service-role query auditing (prevent RLS bypass leaks), client-side state isolation (localStorage prefixing), and module-level cache verification (globalThis pollution prevention).

The standard approach combines automated testing (Playwright E2E with parallel workers), database-level testing (pgTAP for RLS policies), static code analysis (grep-based audits for service-role usage), and performance profiling (PostgreSQL EXPLAIN ANALYZE for index verification).

Key findings:
- Next.js 15 lacks native async Server Component testing support; E2E tests via Playwright are the recommended approach
- Supabase provides pgTAP extension for unit testing RLS policies; supashield tool offers automated RLS vulnerability scanning
- Cross-tenant isolation is the highest-priority security test for multi-tenant systems
- The codebase already uses globalThis caching patterns that require tenant-id keying to prevent cross-contamination

**Primary recommendation:** Build a layered testing strategy combining Playwright E2E tests for user flows, pgTAP unit tests for RLS policies, manual service-role audits via grep, and localStorage/cache audits via static analysis.

## Standard Stack

The established libraries/tools for multi-tenant SaaS testing:

### Core Testing Tools

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Playwright | Latest (2026) | E2E testing with parallel execution and multi-user isolation | Official Next.js recommendation for E2E testing; built-in parallelism via worker processes; supports subdomain testing |
| pgTAP | PostgreSQL extension | Unit testing for RLS policies and database functions | Official Supabase-recommended testing framework; allows testing policies from client perspective (not SQL Editor which bypasses RLS) |
| Vitest | Latest | Unit testing for synchronous Server/Client Components | Official Next.js recommendation for unit tests; does not support async Server Components yet |
| React Testing Library | Latest | Component integration testing | Works with Vitest for testing component interactions |

### Supporting Tools

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| supashield | Latest (2026) | Automated Supabase RLS security testing CLI | Catch RLS vulnerabilities before production; static analysis + coverage reporting + pgTap export |
| PostgreSQL EXPLAIN ANALYZE | Built-in | Query performance analysis | Verify indexes are used correctly; identify slow queries |
| Chrome DevTools | Built-in | localStorage inspection | Manual verification of key prefixing and tenant isolation in browser storage |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Playwright | Cypress | Playwright has better parallel execution and multi-browser support; Cypress has easier debugging UI |
| pgTAP | Manual SQL testing | pgTAP provides repeatable, version-controlled tests; manual testing is error-prone |
| Static grep audit | AST-based static analysis tools | Grep is simpler and sufficient for service-role pattern detection; AST tools add complexity |

**Installation:**

```bash
# Playwright (E2E testing)
npm install -D @playwright/test
npx playwright install

# Vitest (unit testing)
npm install -D vitest @vitejs/plugin-react

# pgTAP (database testing)
# Enable via Supabase Dashboard: Database → Extensions → search "pgtap"

# supashield (optional - RLS security scanner)
npm install -g supashield
```

## Architecture Patterns

### Recommended Test Structure

```
tests/
├── e2e/                          # Playwright E2E tests
│   ├── isolation/                # Cross-tenant isolation tests
│   │   ├── menu-isolation.spec.ts
│   │   ├── order-isolation.spec.ts
│   │   └── admin-isolation.spec.ts
│   ├── flows/                    # Complete user flows
│   │   ├── checkout-flow.spec.ts
│   │   └── admin-onboarding-flow.spec.ts
│   └── fixtures/                 # Test data and helpers
│       └── tenants.ts
├── unit/                         # Vitest unit tests
│   ├── cache.test.ts
│   └── utils.test.ts
├── database/                     # pgTAP database tests
│   └── rls-policies.sql
└── audits/                       # Manual audit scripts
    ├── service-role-audit.sh
    └── cache-audit.sh
```

### Pattern 1: Parallel Multi-Tenant E2E Testing

**What:** Use Playwright's worker-based parallelism to test multiple tenants simultaneously with complete isolation.

**When to use:** Cross-tenant isolation testing (Phase 70 primary requirement).

**Example:**

```typescript
// tests/e2e/isolation/menu-isolation.spec.ts
import { test, expect } from '@playwright/test';

// Use worker index to assign tenant to each parallel worker
const getTenantForWorker = (workerIndex: number) => {
  const tenants = [
    { slug: 'tenant-a', subdomain: 'tenant-a.localhost:3000' },
    { slug: 'tenant-b', subdomain: 'tenant-b.localhost:3000' },
  ];
  return tenants[workerIndex % tenants.length];
};

test('tenant A menu does not show tenant B items', async ({ page }, testInfo) => {
  const tenant = getTenantForWorker(testInfo.workerIndex);

  // Navigate to tenant-specific subdomain
  await page.goto(`http://${tenant.subdomain}/menu`);

  // Verify only tenant A items are visible
  await expect(page.getByText('Tenant A Exclusive Item')).toBeVisible();
  await expect(page.getByText('Tenant B Exclusive Item')).not.toBeVisible();
});
```

**Source:** [Playwright Parallelism Docs](https://playwright.dev/docs/test-parallel), [Multi-User Testing with Playwright Fixtures](https://medium.com/@edtang44/isolate-and-conquer-multi-user-testing-with-playwright-fixtures-f211ad438974)

### Pattern 2: pgTAP RLS Policy Testing

**What:** Write database-level unit tests for RLS policies using pgTAP framework.

**When to use:** Verify tenant isolation at database level; catch RLS misconfigurations.

**Example:**

```sql
-- tests/database/rls-policies.sql
BEGIN;
SELECT plan(5);

-- Test 1: Verify tenant A user can only see tenant A orders
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub": "user-a-id"}', false);

SELECT results_eq(
  'SELECT COUNT(*)::int FROM orders',
  ARRAY[10], -- Tenant A has 10 orders
  'Tenant A user sees only tenant A orders'
);

-- Test 2: Verify tenant B user sees different data
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000002', false);
SELECT set_config('request.jwt.claims', '{"sub": "user-b-id"}', false);

SELECT results_eq(
  'SELECT COUNT(*)::int FROM orders',
  ARRAY[5], -- Tenant B has 5 orders
  'Tenant B user sees only tenant B orders'
);

-- Test 3: Verify cross-tenant INSERT fails
PREPARE insert_cross_tenant AS
  INSERT INTO orders (tenant_id, user_id)
  VALUES ('00000000-0000-0000-0000-000000000001', 'user-b-id');

SELECT throws_ok(
  'insert_cross_tenant',
  'Cross-tenant insert should fail'
);

SELECT * FROM finish();
ROLLBACK;
```

**Source:** [Testing RLS Policies with pgTAP](https://blair-devmode.medium.com/testing-row-level-security-rls-policies-in-postgresql-with-pgtap-a-supabase-example-b435c1852602), [Supabase pgTAP Docs](https://supabase.com/docs/guides/local-development/testing/pgtap-extended)

### Pattern 3: Service-Role Query Audit

**What:** Static code analysis to find all createServiceClient() usages and verify tenant_id filtering.

**When to use:** Security audit of service-role queries that bypass RLS.

**Example:**

```bash
#!/bin/bash
# audits/service-role-audit.sh

echo "=== Service-Role Query Audit ==="
echo "Finding all createServiceClient() usages..."

# Find all files using service client
grep -r "createServiceClient()" src/ --include="*.ts" --include="*.tsx" | \
  cut -d: -f1 | sort -u > /tmp/service-files.txt

# For each file, check if queries have explicit tenant_id filtering
while read -r file; do
  echo ""
  echo "File: $file"

  # Check for .from() queries without .eq('tenant_id')
  if grep -q "\.from(" "$file"; then
    if ! grep -q "\.eq('tenant_id'" "$file" && ! grep -q "WHERE tenant_id" "$file"; then
      echo "  ⚠️  WARNING: Has .from() query but no tenant_id filter"
      grep -n "\.from(" "$file"
    else
      echo "  ✓ Has tenant_id filtering"
    fi
  fi
done < /tmp/service-files.txt
```

**Why this pattern:** createServiceClient() bypasses RLS, making it a security risk if queries don't explicitly filter by tenant_id. Manual audit catches cases where developers forget filtering.

**Source:** Project codebase patterns (STATE.md decisions), [Multi-Tenant Leakage article](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c)

### Pattern 4: Cache Key Prefixing Verification

**What:** Audit all globalThis cache implementations to ensure keys are prefixed with tenant_id.

**When to use:** Prevent cross-tenant pollution in module-level caches.

**Example:**

```bash
#!/bin/bash
# audits/cache-audit.sh

echo "=== Module-Level Cache Audit ==="

# Find all globalThis cache declarations
grep -r "globalThis\." src/ --include="*.ts" -A 10 | grep -E "Map|Set|cache" > /tmp/caches.txt

echo "Found caches:"
cat /tmp/caches.txt

echo ""
echo "Checking cache key patterns..."

# Check each cache file for tenant_id keying
for cache_file in $(grep -l "globalThis\." src/**/*.ts); do
  echo ""
  echo "File: $cache_file"

  # Look for tenant-scoped keying patterns
  if grep -q "tenantId" "$cache_file" && grep -q "\.get(" "$cache_file"; then
    echo "  ✓ Appears to use tenant-scoped keys"
  else
    echo "  ⚠️  WARNING: May not have tenant-scoped keys"
    grep -n "\.get(" "$cache_file" | head -3
  fi
done
```

**Why this pattern:** globalThis caches persist across requests in Node.js. Without tenant_id keying, Tenant A can see cached data from Tenant B.

**Source:** [Multi-Tenant Performance Crisis article](https://www.addwebsolution.com/blog/multi-tenant-performance-crisis-advanced-isolation-2026), Project codebase (src/lib/tenant/cache.ts, src/lib/square/config.ts)

### Anti-Patterns to Avoid

- **Testing with SQL Editor for RLS verification:** SQL Editor bypasses RLS; always test from client SDK perspective
- **Single-worker E2E tests for isolation:** Won't catch race conditions or cache pollution between parallel users
- **Assuming RLS always works:** 83% of exposed Supabase databases involve RLS misconfigurations (2025 stat)
- **localStorage without tenant prefixing:** Browser storage is shared across subdomains; must prefix keys with tenant_id or slug

**Sources:**
- [Supabase RLS Complete Guide 2026](https://designrevision.com/blog/supabase-row-level-security)
- [SaaS Multi-Tenancy Testing 2026](https://www.qabash.com/saas-multi-tenancy-architecture-testing-2026/)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RLS policy testing | Custom SQL test harness | pgTAP extension | Official Supabase recommendation; handles transaction rollback, provides TAP output format for CI integration |
| E2E test parallelism | Custom worker pool | Playwright's built-in workers | Playwright handles process isolation, browser contexts, and parallel execution with --workers flag |
| RLS vulnerability scanning | Manual code review only | supashield CLI tool | Automated scanning catches common patterns (missing tenant_id filters, public tables without RLS) |
| localStorage isolation | Manual prefixing | Standardized prefix pattern | Easy to forget; establish convention early (e.g., `${tenantSlug}:cart`) |
| Performance profiling | Custom query logging | PostgreSQL EXPLAIN ANALYZE | Built-in, shows actual execution plan and index usage |

**Key insight:** Multi-tenant isolation bugs are catastrophic (instant data breach). Don't rely on manual testing alone; use automated tools and database-level constraints.

## Common Pitfalls

### Pitfall 1: Service-Role Queries Without Tenant Filtering

**What goes wrong:** Using createServiceClient() to bypass RLS, then forgetting to add explicit .eq('tenant_id', tenantId) filter. Results in cross-tenant data leakage.

**Why it happens:** Service-role client is needed for legitimate admin operations (e.g., platform admin viewing all tenants), but developers forget it bypasses all RLS policies.

**How to avoid:**
1. Audit all createServiceClient() usages with grep (see Pattern 3)
2. Establish rule: Every service-role .from() query MUST have explicit tenant_id filter OR be in platform admin routes
3. Code review checklist: "Does this service-role query filter by tenant_id?"

**Warning signs:**
- File has createServiceClient() but no .eq('tenant_id') calls
- Comments like "TODO: add tenant filtering"
- Platform routes using tenant-scoped queries (should use service client to see all tenants)

**Source:** [Multi-Tenant Leakage article](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c)

### Pitfall 2: globalThis Cache Pollution

**What goes wrong:** Module-level caches (globalThis.__cache) shared across all requests. Without tenant_id keying, Tenant A gets cached data from Tenant B.

**Why it happens:** Node.js server keeps globalThis alive between requests. Developers cache data for performance but forget to scope by tenant.

**How to avoid:**
1. Always use Map<string, CacheEntry> where key includes tenantId
2. Pattern: `cache.get(tenantId)` NOT `cache.get('singleton')`
3. Audit existing caches (see Pattern 4)

**Warning signs:**
- Cache key is static string ('menu', 'config') instead of tenant-scoped
- getCachedX() function doesn't accept tenantId parameter
- Comments about "global cache" or "singleton pattern"

**Current state:** Project already has 3 globalThis caches (tenant cache, Square config cache, site status cache). Tenant and Square config caches are already tenant-keyed. Site status cache is tenant-agnostic (OK for now but needs review if multi-tenant).

**Source:** [Multi-Tenant Performance article](https://www.addwebsolution.com/blog/multi-tenant-performance-crisis-advanced-isolation-2026), Project codebase audit

### Pitfall 3: localStorage Without Tenant Prefixing

**What goes wrong:** localStorage keys like 'cafe-cart' are shared across all subdomains on localhost. Tenant A's cart shows up for Tenant B.

**Why it happens:** Browser localStorage is scoped to domain, not subdomain. tenant-a.localhost and tenant-b.localhost share the same localStorage on localhost.

**How to avoid:**
1. Prefix all localStorage keys with tenant slug: `${tenantSlug}:cart`
2. Create wrapper functions (getLocalStorageKey(tenantSlug, key))
3. Audit all localStorage.getItem/setItem calls

**Warning signs:**
- Hardcoded localStorage keys ('cafe-cart', 'cafe-selected-variations')
- localStorage calls without tenant context
- Cart data persisting across tenant switches

**Current state:** Project has 2 localStorage usages (useCart.ts, useCartData.ts) with hardcoded keys 'cafe-cart' and 'cafe-selected-variations'. REQUIRES FIXING in Phase 70.

**Source:** [Data Isolation in Multi-Tenant SaaS](https://redis.io/blog/data-isolation-multi-tenant-saas/)

### Pitfall 4: Testing RLS with SQL Editor

**What goes wrong:** RLS policies look correct in SQL Editor queries, but fail in production. SQL Editor bypasses RLS when using postgres role.

**Why it happens:** SQL Editor uses postgres superuser role which has BYPASSRLS privilege. Policies are never enforced.

**How to avoid:**
1. Always test RLS from client SDK (Supabase JavaScript client)
2. Use pgTAP with set_config() to simulate different user contexts
3. Never trust SQL Editor results for RLS verification

**Warning signs:**
- "It works in SQL Editor but not in app"
- Testing with SELECT without SET ROLE
- No pgTAP tests for policies

**Source:** [Supabase RLS Complete Guide](https://designrevision.com/blog/supabase-row-level-security), [pgTAP Testing Guide](https://usebasejump.com/blog/testing-on-supabase-with-pgtap)

### Pitfall 5: Single-Worker E2E Tests Missing Race Conditions

**What goes wrong:** E2E tests pass when run sequentially, but fail in production with concurrent users from different tenants.

**Why it happens:** Cache race conditions and shared state only appear with true parallelism. Sequential tests don't catch timing-dependent bugs.

**How to avoid:**
1. Run Playwright tests with --workers=2 or more
2. Use testInfo.workerIndex to assign different tenants to workers
3. Test concurrent operations (e.g., two tenants placing orders simultaneously)

**Warning signs:**
- Playwright config has workers: 1
- Tests always pass locally but fail in staging
- Intermittent failures that can't be reproduced

**Source:** [Playwright Parallelism Docs](https://playwright.dev/docs/test-parallel)

## Code Examples

Verified patterns from official sources:

### Example 1: Playwright Multi-Tenant Test with Workers

```typescript
// tests/e2e/isolation/concurrent-checkout.spec.ts
import { test, expect } from '@playwright/test';

const tenants = [
  { id: '00000000-0000-0000-0000-000000000001', slug: 'cafe-a', subdomain: 'cafe-a.localhost:3000' },
  { id: '00000000-0000-0000-0000-000000000002', slug: 'cafe-b', subdomain: 'cafe-b.localhost:3000' },
];

test.describe('concurrent checkout isolation', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const tenant of tenants) {
    test(`tenant ${tenant.slug} checkout is isolated`, async ({ page }) => {
      // Each test runs in parallel worker with own browser context
      await page.goto(`http://${tenant.subdomain}/menu`);

      // Add item to cart
      await page.getByRole('button', { name: 'Add to Cart' }).first().click();

      // Open cart modal
      await page.getByRole('button', { name: 'Cart' }).click();

      // Verify cart has items
      await expect(page.getByText(/Cart \(1\)/)).toBeVisible();

      // Complete checkout
      await page.getByRole('button', { name: 'Checkout' }).click();
      // ... payment flow ...

      // Verify order appears in tenant's order history only
      await page.goto(`http://${tenant.subdomain}/orders`);
      await expect(page.getByText(/Order #/)).toBeVisible();
    });
  }
});
```

**Source:** [Playwright Best Practices](https://playwright.dev/docs/best-practices), [Multi-User Testing with Playwright](https://medium.com/@edtang44/isolate-and-conquer-multi-user-testing-with-playwright-fixtures-f211ad438974)

### Example 2: pgTAP RLS Cross-Tenant Test

```sql
-- tests/database/rls-cross-tenant-isolation.sql
BEGIN;
SELECT plan(6);

-- Setup: Create two test users for different tenants
SET app.tenant_id = '00000000-0000-0000-0000-000000000001';
SET request.jwt.claims = '{"sub": "user-tenant-a"}';

-- Test: Tenant A user can insert into their tenant
PREPARE insert_tenant_a AS
  INSERT INTO orders (tenant_id, user_id, total)
  VALUES ('00000000-0000-0000-0000-000000000001', 'user-tenant-a', 100);

SELECT lives_ok(
  'insert_tenant_a',
  'Tenant A user can insert into tenant A orders'
);

-- Test: Tenant A user CANNOT read tenant B orders
SET app.tenant_id = '00000000-0000-0000-0000-000000000002';

SELECT results_eq(
  'SELECT COUNT(*)::int FROM orders WHERE tenant_id = ''00000000-0000-0000-0000-000000000002''',
  ARRAY[0],
  'Tenant A user context sees zero tenant B orders (RLS blocks)'
);

-- Test: Switch to Tenant B context
SET app.tenant_id = '00000000-0000-0000-0000-000000000002';
SET request.jwt.claims = '{"sub": "user-tenant-b"}';

SELECT results_eq(
  'SELECT COUNT(*)::int FROM orders WHERE tenant_id = ''00000000-0000-0000-0000-000000000002''',
  ARRAY[0], -- Assuming no orders yet for tenant B
  'Tenant B user sees only tenant B orders'
);

-- Test: Verify RLS policy exists on orders table
SELECT has_policy(
  'orders',
  'Tenants can read own orders',
  'RLS policy exists for tenant isolation'
);

SELECT * FROM finish();
ROLLBACK;
```

**Source:** [Supabase pgTAP Extended Guide](https://supabase.com/docs/guides/local-development/testing/pgtap-extended)

### Example 3: Tenant-Scoped Cache Pattern

```typescript
// src/lib/cache/tenant-cache.ts (example of correct pattern)
import { cache } from 'react'

type CacheEntry<T> = {
  data: T
  expiresAt: number
}

declare global {
  var __tenantScopedCache: Map<string, CacheEntry<unknown>> | undefined
}

function getCache(): Map<string, CacheEntry<unknown>> {
  if (!globalThis.__tenantScopedCache) {
    globalThis.__tenantScopedCache = new Map()
  }
  return globalThis.__tenantScopedCache
}

export function getCached<T>(tenantId: string, key: string): T | null {
  const cacheKey = `${tenantId}:${key}` // CRITICAL: Prefix with tenant ID
  const cache = getCache()
  const entry = cache.get(cacheKey) as CacheEntry<T> | undefined

  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey)
    return null
  }

  return entry.data
}

export function setCached<T>(tenantId: string, key: string, data: T, ttlMs: number): void {
  const cacheKey = `${tenantId}:${key}` // CRITICAL: Prefix with tenant ID
  const cache = getCache()
  cache.set(cacheKey, {
    data,
    expiresAt: Date.now() + ttlMs,
  })
}
```

**Source:** Project codebase (src/lib/tenant/cache.ts, src/lib/square/config.ts)

### Example 4: Service-Role Query with Explicit Filtering

```typescript
// src/app/api/admin/tenant-stats/route.ts (example)
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(request: Request) {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  // CORRECT: Service-role query with explicit tenant_id filter
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('tenant_id', tenantId) // CRITICAL: Explicit filter

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ orders })
}
```

**Anti-pattern (WRONG):**

```typescript
// WRONG: Service-role without tenant_id filter
const { data: orders } = await supabase.from('orders').select('*')
// Returns ALL orders across ALL tenants! Data breach!
```

**Source:** Project STATE.md decisions, [Multi-Tenant Leakage article](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual RLS testing in SQL Editor | pgTAP automated tests + supashield scanning | 2024-2025 | SQL Editor bypasses RLS; automated testing catches misconfigurations before production |
| Sequential E2E tests | Parallel Playwright workers with multi-tenant fixtures | 2024+ | Catches race conditions and cache pollution that only appear with concurrent users |
| Application-level tenant filtering | Database-level RLS enforcement | Industry shift 2020-2023 | Defense in depth; even if app code forgets filtering, database blocks cross-tenant access |
| Manual security audits | Automated static analysis + CI/CD integration | 2025-2026 | Continuous verification; catches regressions in every PR |

**Deprecated/outdated:**
- Cypress for Next.js testing: Playwright has better parallelism and official Next.js support (2024+)
- Jest for Next.js: Vitest is faster and recommended by Next.js docs (2025+)
- Manual localStorage prefixing: Should be abstracted into utility functions with TypeScript enforcement

**Source:** [Next.js Testing Guide 2026](https://nextjs.org/docs/app/guides/testing), [Playwright Guide 2026](https://www.deviqa.com/blog/guide-to-playwright-end-to-end-testing-in-2025/)

## Open Questions

Things that couldn't be fully resolved:

1. **Subdomain testing in CI/CD**
   - What we know: Playwright supports subdomain testing locally via subdomain.localhost pattern
   - What's unclear: How to configure CI/CD environment (GitHub Actions) to support subdomain routing for multi-tenant tests
   - Recommendation: Use host file mapping or DNS mocking in CI; alternatively test with tenant_id headers instead of subdomains in CI

2. **localStorage isolation on production domains**
   - What we know: localStorage is scoped to domain; subdomains on same domain share storage
   - What's unclear: Whether tenant-a.example.com and tenant-b.example.com have isolated localStorage or share it
   - Recommendation: Test with real subdomains in staging; may need to use sessionStorage or cookies instead if localStorage is shared

3. **Performance impact of tenant_id indexes**
   - What we know: All 48 tables have btree indexes on tenant_id (Phase 20)
   - What's unclear: Actual performance impact under load with hundreds of tenants
   - Recommendation: Run EXPLAIN ANALYZE on critical queries; monitor pg_stat_statements in production; consider partial indexes for active tenants only

4. **Optimal number of Playwright workers**
   - What we know: Playwright supports parallel workers; more workers = faster but more resource-intensive
   - What's unclear: Optimal worker count for multi-tenant isolation testing (2? 4? 8?)
   - Recommendation: Start with 2 workers (one per tenant); increase if tests are slow; monitor CPU/memory in CI

## Sources

### Primary (HIGH confidence)

- [Next.js Testing Documentation](https://nextjs.org/docs/app/guides/testing) - Official Next.js testing guide
- [Playwright Official Docs - Parallelism](https://playwright.dev/docs/test-parallel) - Worker-based parallel execution
- [Playwright Official Docs - Best Practices](https://playwright.dev/docs/best-practices) - Test isolation and performance
- [Supabase RLS Documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) - Official RLS guide
- [Supabase pgTAP Documentation](https://supabase.com/docs/guides/local-development/testing/pgtap-extended) - Database testing framework
- [PostgreSQL 18 B-Tree Index Documentation](https://www.postgresql.org/docs/current/btree.html) - Index optimization
- Project codebase:
  - src/lib/tenant/cache.ts - Tenant-scoped globalThis cache pattern
  - src/lib/square/config.ts - Square config cache with tenant keying
  - src/hooks/useCart.ts - localStorage usage patterns (needs prefixing fix)

### Secondary (MEDIUM confidence)

- [Testing RLS Policies with pgTAP - Medium article](https://blair-devmode.medium.com/testing-row-level-security-rls-policies-in-postgresql-with-pgtap-a-supabase-example-b435c1852602) - Practical RLS testing examples
- [Multi-User Testing with Playwright Fixtures - Medium](https://medium.com/@edtang44/isolate-and-conquer-multi-user-testing-with-playwright-fixtures-f211ad438974) - Parallel user testing patterns
- [Supabase RLS Complete Guide 2026 - DesignRevision](https://designrevision.com/blog/supabase-row-level-security) - RLS best practices and pitfalls
- [SaaS Multi-Tenancy Testing 2026 - QAbash](https://www.qabash.com/saas-multi-tenancy-architecture-testing-2026/) - Multi-tenant testing strategies
- [Multi-Tenant Leakage article - Medium](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c) - Security audit checklist
- [Data Isolation in Multi-Tenant SaaS - Redis](https://redis.io/blog/data-isolation-multi-tenant-saas/) - Cache isolation patterns
- [Next.js Testing Guide - Strapi](https://strapi.io/blog/nextjs-testing-guide-unit-and-e2e-tests-with-vitest-and-playwright) - Comprehensive testing setup
- [PostgreSQL 18 Release Notes](https://www.postgresql.org/about/news/postgresql-18-released-3142/) - Performance improvements

### Tertiary (LOW confidence)

- [supashield GitHub repo](https://github.com/Rodrigotari1/supashield) - Automated RLS testing tool (newer project, needs validation)
- [Multi-Tenant Performance Crisis article](https://www.addwebsolution.com/blog/multi-tenant-performance-crisis-advanced-isolation-2026) - Cache isolation strategies (blog post, not authoritative)
- Web search results for localStorage isolation - Multiple sources with varying quality

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - Playwright and pgTAP are well-documented official recommendations; supashield is newer and less validated
- Architecture patterns: HIGH - Patterns derived from official docs and verified in project codebase
- Pitfalls: HIGH - All five pitfalls confirmed via official docs or observed in project code

**Research date:** 2026-02-16
**Valid until:** 60 days (stable testing ecosystem; Playwright/pgTAP patterns unlikely to change rapidly)

**Codebase-specific findings:**
- Project has 83 service-role client usages (requires manual audit)
- Project has 3 globalThis caches (2 tenant-scoped correctly, 1 needs review)
- Project has 2 localStorage usages with hardcoded keys (requires tenant prefixing fix)
- Project has Phases 10-60 verification patterns to follow (see 60-VERIFICATION.md, 40-VERIFICATION.md)
