# Multi-Tenant E2E Isolation Tests

This directory contains Playwright E2E tests that verify cross-tenant isolation for the multi-tenant SaaS platform.

## Test Suites

### Menu Isolation (`menu-isolation.spec.ts`)
- Verifies Tenant A menu shows only Tenant A items
- Verifies Tenant B menu shows only Tenant B items
- Tests concurrent menu loading to catch cache pollution

### Checkout Flow Isolation (`checkout-flow.spec.ts`)
- Verifies Tenant A and Tenant B can add items to cart concurrently
- Tests cart data isolation (Tenant A cart !== Tenant B cart)
- Verifies cart persistence within tenant context

### Admin Panel Isolation (`admin-isolation.spec.ts`)
- Verifies admin routes are protected (require authentication)
- Tests that unauthenticated users cannot access admin panels
- Includes framework for future authenticated cross-tenant access tests

## Prerequisites

### 1. Test Tenants Must Exist

Before running these tests, you must create two tenants in the database:

**Tenant A:**
- Slug: `tenant-a`
- Status: `active`
- Has Square credentials configured (for menu/checkout tests)

**Tenant B:**
- Slug: `tenant-b`
- Status: `active`
- Has Square credentials configured (for menu/checkout tests)

**How to create test tenants:**

#### Option 1: Via Platform Admin UI
1. Start dev server: `npm run dev:webpack`
2. Navigate to `http://localhost:3000/platform`
3. Login as platform admin
4. Create two tenants with slugs `tenant-a` and `tenant-b`
5. Complete Square OAuth for both tenants

#### Option 2: Via Direct Database Insert
```sql
-- Connect to Supabase database via psql or SQL Editor

-- Insert Tenant A
INSERT INTO tenants (id, slug, name, status, created_at, updated_at)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'tenant-a',
  'Test Tenant A',
  'active',
  NOW(),
  NOW()
);

-- Insert Tenant B
INSERT INTO tenants (id, slug, name, status, created_at, updated_at)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'tenant-b',
  'Test Tenant B',
  'active',
  NOW(),
  NOW()
);
```

**Note:** You'll still need to configure Square credentials for each tenant via the platform admin UI or by storing credentials in Supabase Vault.

### 2. Dev Server Must Be Running

Tests connect to `http://localhost:3000`, so the dev server must be running:

```bash
npm run dev:webpack
```

(Use `dev:webpack` instead of `dev` for API route stability)

### 3. Subdomain Routing Must Work

Tests use subdomain routing patterns like:
- `http://tenant-a.localhost:3000`
- `http://tenant-b.localhost:3000`

The middleware already supports this pattern without requiring `/etc/hosts` configuration.

## How to Run Tests

### Run all E2E tests
```bash
npm run test:e2e
```

### Run with UI mode (debugging)
```bash
npm run test:e2e:ui
```

### Run specific test file
```bash
npx playwright test tests/e2e/isolation/menu-isolation.spec.ts
```

### Run with headed browser (see what's happening)
```bash
npx playwright test --headed
```

### Run with debug mode
```bash
npx playwright test --debug
```

## Expected Outcomes

### When Prerequisites Are Met (Tenants Exist)

All tests should **PASS**:
- ✓ Menu isolation tests verify each tenant sees only their own menu items
- ✓ Checkout flow tests verify concurrent cart operations are isolated
- ✓ Admin panel tests verify routes are protected

### When Prerequisites Are NOT Met (Tenants Don't Exist)

Tests will **FAIL** with one of these scenarios:

**Scenario 1: 404 Not Found**
- Subdomain `tenant-a.localhost:3000` returns 404
- Subdomain `tenant-b.localhost:3000` returns 404
- **Root cause:** Tenants with slugs `tenant-a` and `tenant-b` don't exist in database

**Scenario 2: Empty Menu / No Items**
- Menu page loads but no items are visible
- **Root cause:** Tenant exists but has no Square catalog configured

**Scenario 3: 503 Service Unavailable**
- Menu or checkout routes return 503
- **Root cause:** Tenant exists but Square credentials not configured

## Failure Scenarios (What Cross-Tenant Leakage Looks Like)

If multi-tenant isolation is broken, you would see:

### Cache Pollution
- Tenant A sees Tenant B's menu items
- Cart from Tenant A appears for Tenant B
- **Root cause:** globalThis cache not keyed by tenant_id

### localStorage Pollution
- Cart persists across tenant switches (tenant-a → tenant-b keeps same cart)
- **Root cause:** localStorage keys not prefixed with tenant slug

### RLS Bypass Leaks
- Tenant A admin can access Tenant B orders/data
- **Root cause:** Service-role queries missing explicit tenant_id filtering

### Admin Route Leaks
- Tenant A admin can navigate to `tenant-b.localhost:3000/admin` and see data
- **Root cause:** Admin auth not checking tenant_memberships correctly

## Test Results (Initial Run)

**Date:** 2026-02-17
**Status:** 8 failed, 3 passed
**Reason:** Test tenants (`tenant-a`, `tenant-b`) do not exist in database yet

**Passed tests:**
- Admin Panel Isolation › Admin routes are protected across tenants
- Admin Panel Isolation › Admin subpages are also protected
- Checkout Flow Isolation › Cart persists after navigation within tenant

**Failed tests:**
- All tests expecting `tenant-a` and `tenant-b` to exist and have menu items

**Conclusion:** Tests are working correctly. Failures are expected until test tenants are created.

## Next Steps

1. **Create test tenants** via platform admin UI or database inserts
2. **Configure Square credentials** for both tenants
3. **Re-run tests** to verify multi-tenant isolation
4. **Document any isolation bugs** found during testing
5. **Expand tests** to include authenticated admin cross-tenant access tests

## Parallel Execution

All test suites use `test.describe.configure({ mode: 'parallel' })` to run tests concurrently with multiple workers (configured as `workers: 2` in `playwright.config.ts`).

This parallel execution is critical for catching:
- Race conditions in cache operations
- globalThis pollution between concurrent requests
- localStorage conflicts across subdomains

## CI/CD Integration

To run these tests in CI/CD:

1. **Set up test database** with tenant-a and tenant-b
2. **Store Square sandbox credentials** in environment variables
3. **Configure subdomain routing** in CI environment (may require DNS mocking)
4. **Run tests** as part of build pipeline

Example GitHub Actions workflow:
```yaml
- name: Run E2E Tests
  run: |
    npm run build
    npm run dev &
    npx playwright test
  env:
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
    SQUARE_ACCESS_TOKEN: ${{ secrets.TEST_SQUARE_ACCESS_TOKEN }}
```

## Troubleshooting

### Tests timeout waiting for dev server
- Make sure `npm run dev:webpack` is running before running tests
- Or uncomment the `webServer` section in `playwright.config.ts` to auto-start server

### Subdomain routing not working
- Verify middleware is handling subdomain extraction correctly
- Check that tenants exist with exact slugs `tenant-a` and `tenant-b`
- Try accessing subdomains manually in browser to debug

### Menu items not loading
- Check that tenant has Square catalog configured
- Verify Square credentials are stored in Supabase Vault
- Check API route logs for errors (`/api/square/catalog`)

### Admin tests failing
- Verify admin routes require authentication (middleware check)
- Check that unauthenticated requests redirect to `/auth`
- Ensure `requireAdmin()` is checking tenant_memberships

## Future Enhancements

1. **Authenticated admin cross-tenant tests**
   - Create test user accounts via Supabase Auth
   - Add users to tenant_memberships
   - Use `storageState` to save authenticated sessions
   - Test that Tenant A admin cannot access Tenant B routes

2. **Performance profiling**
   - Measure page load times across tenants
   - Verify database queries use tenant_id indexes
   - Check for N+1 query issues

3. **Visual regression testing**
   - Screenshot comparison between tenants
   - Verify branding (logo, colors) is tenant-specific

4. **API route isolation tests**
   - Test that API routes filter by tenant_id
   - Verify webhooks resolve tenant from merchant_id
   - Check that service-role queries have explicit filtering
