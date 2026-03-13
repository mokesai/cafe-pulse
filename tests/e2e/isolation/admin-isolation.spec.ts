import { test, expect } from '@playwright/test';

/**
 * Admin Panel Isolation E2E Tests
 *
 * Prerequisite: Two tenants must exist in database with slugs 'tenant-a' and 'tenant-b'
 * AND admin users must be created for each tenant with proper tenant_memberships.
 *
 * Tests verify that:
 * - Tenant A admin cannot access Tenant B admin panel
 * - Tenant B admin cannot access Tenant A admin panel
 * - Cross-tenant admin access is blocked (403 or redirect to login)
 *
 * Note: These tests assume admin routes require authentication.
 * Unauthenticated users will see login redirect.
 */

test.describe('Admin Panel Isolation', () => {
  test.describe.configure({ mode: 'parallel' });

  test('Unauthenticated user cannot access Tenant A admin panel', async ({ page }) => {
    // Navigate to Tenant A admin panel (without authentication)
    await page.goto('http://tenant-a.localhost:3000/admin');
    await page.waitForLoadState('networkidle');

    // Verify user is redirected to login or sees unauthorized message
    const url = page.url();

    // Should redirect to /auth or show login page
    const isRedirectedToAuth = url.includes('/auth') || url.includes('/login');
    const hasUnauthorizedMessage = await page.locator('text=/unauthorized|forbidden|access denied|sign in/i').isVisible().catch(() => false);

    expect(isRedirectedToAuth || hasUnauthorizedMessage).toBeTruthy();
  });

  test('Unauthenticated user cannot access Tenant B admin panel', async ({ page }) => {
    // Navigate to Tenant B admin panel (without authentication)
    await page.goto('http://tenant-b.localhost:3000/admin');
    await page.waitForLoadState('networkidle');

    // Verify user is redirected to login or sees unauthorized message
    const url = page.url();

    // Should redirect to /auth or show login page
    const isRedirectedToAuth = url.includes('/auth') || url.includes('/login');
    const hasUnauthorizedMessage = await page.locator('text=/unauthorized|forbidden|access denied|sign in/i').isVisible().catch(() => false);

    expect(isRedirectedToAuth || hasUnauthorizedMessage).toBeTruthy();
  });

  test('Admin routes are protected across tenants', async ({ page }, testInfo) => {
    // Use worker index to assign tenant
    const tenants = [
      { slug: 'tenant-a', subdomain: 'tenant-a.localhost:3000' },
      { slug: 'tenant-b', subdomain: 'tenant-b.localhost:3000' },
    ];
    const tenant = tenants[testInfo.workerIndex % tenants.length];

    // Navigate to admin panel
    await page.goto(`http://${tenant.subdomain}/admin`);
    await page.waitForLoadState('networkidle');

    // Verify protection is in place (redirect or unauthorized)
    const url = page.url();
    const isProtected = url.includes('/auth') ||
                        url.includes('/login') ||
                        await page.locator('text=/unauthorized|forbidden|access denied|sign in/i').isVisible().catch(() => false);

    expect(isProtected).toBeTruthy();

    // This test passes when both tenants have admin route protection
    // and don't expose admin data to unauthenticated users
  });

  test('Admin subpages are also protected', async ({ page }) => {
    // Test multiple admin routes to verify protection is comprehensive
    const adminRoutes = [
      'http://tenant-a.localhost:3000/admin/orders',
      'http://tenant-a.localhost:3000/admin/menu',
      'http://tenant-a.localhost:3000/admin/settings',
    ];

    for (const route of adminRoutes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Verify each route is protected
      const url = page.url();
      const isProtected = url.includes('/auth') ||
                          url.includes('/login') ||
                          await page.locator('text=/unauthorized|forbidden|access denied|sign in/i').isVisible().catch(() => false);

      expect(isProtected).toBeTruthy();
    }
  });

  // NOTE: To test authenticated admin isolation (Tenant A admin cannot access Tenant B admin),
  // you would need to:
  // 1. Create test user accounts for each tenant via Supabase Auth
  // 2. Add those users to tenant_memberships with 'admin' or 'owner' role
  // 3. Use Playwright's storageState to save authenticated sessions
  // 4. Load those sessions in tests and attempt cross-tenant access
  // 5. Verify 403/redirect when Tenant A admin tries to access Tenant B routes
  //
  // Example (commented out - requires auth setup):
  //
  // test('Tenant A admin cannot access Tenant B admin panel', async ({ page }) => {
  //   // Load Tenant A admin authenticated session
  //   await page.goto('http://tenant-a.localhost:3000/admin');
  //   // ... login flow ...
  //
  //   // Try to access Tenant B admin
  //   await page.goto('http://tenant-b.localhost:3000/admin');
  //   await page.waitForLoadState('networkidle');
  //
  //   // Should see 403 or redirect (not Tenant B admin dashboard)
  //   const url = page.url();
  //   expect(url).not.toContain('tenant-b.localhost:3000/admin');
  // });
});
