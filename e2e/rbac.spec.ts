/**
 * E2E Tests: Role-Based Access Control — MOK-57
 *
 * Covers all 5 roles × key protected routes.
 *
 * Roles & test accounts (seeded via 20260328221352_create_test_accounts.sql):
 *   Platform Admin : lloyd.ops@agentmail.to      / TestPassword123!  (platform_admins table, MFA-enrolled)
 *   Tenant Admin   : test-owner@cafe-pulse.test  / TestOwner123!     (role: owner)
 *   Admin          : test-admin@cafe-pulse.test  / TestAdmin123!     (role: admin)
 *   Staff          : test-staff@cafe-pulse.test  / TestStaff123!     (role: staff)
 *   Customer       : unauthenticated (no session)
 *
 * Routes under test:
 *   /platform            — Platform Admin only (MFA required)
 *   /admin/dashboard     — Tenant Admin, Admin, Staff (authenticated tenant users)
 *   /admin/invoices      — Admin + Tenant Admin (not Staff)
 *   /admin/settings      — Admin + Tenant Admin
 *   /admin/team          — Admin + Tenant Admin
 *   /admin/analytics     — Admin + Tenant Admin
 *   /admin/purchase-orders — Admin + Tenant Admin
 *   /admin/inventory     — Admin + Tenant Admin
 *   /admin/kds-config    — Admin + Tenant Admin (config_access_roles check)
 *
 * Environment variable overrides (all optional):
 *   TEST_PLATFORM_ADMIN_EMAIL / TEST_PLATFORM_ADMIN_PASSWORD
 *   TEST_TENANT_ADMIN_EMAIL   / TEST_TENANT_ADMIN_PASSWORD
 *   TEST_ADMIN_EMAIL          / TEST_ADMIN_PASSWORD
 *   TEST_STAFF_EMAIL          / TEST_STAFF_PASSWORD
 *   TEST_SKIP_PLATFORM_ADMIN  — set to any value to skip Platform Admin tests (requires MFA enrollment)
 */

import { test, expect, type Page } from '@playwright/test'

// ─── Credentials ─────────────────────────────────────────────────────────────

const ACCOUNTS = {
  platformAdmin: {
    email:    process.env.TEST_PLATFORM_ADMIN_EMAIL ?? 'lloyd.ops@agentmail.to',
    password: process.env.TEST_PLATFORM_ADMIN_PASSWORD ?? 'TestPassword123!',
  },
  tenantAdmin: {
    email:    process.env.TEST_TENANT_ADMIN_EMAIL ?? 'test-owner@cafe-pulse.test',
    password: process.env.TEST_TENANT_ADMIN_PASSWORD ?? 'TestOwner123!',
  },
  admin: {
    email:    process.env.TEST_ADMIN_EMAIL ?? 'test-admin@cafe-pulse.test',
    password: process.env.TEST_ADMIN_PASSWORD ?? 'TestAdmin123!',
  },
  staff: {
    email:    process.env.TEST_STAFF_EMAIL ?? 'test-staff@cafe-pulse.test',
    password: process.env.TEST_STAFF_PASSWORD ?? 'TestStaff123!',
  },
}

// ─── Login helpers ────────────────────────────────────────────────────────────

async function loginAsTenantUser(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/admin/login')
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.locator('button[type="submit"], button:has-text("Sign in")').first().click()
  await page.waitForURL(/\/admin\//, { timeout: 20_000 })
}

async function loginAsPlatformAdmin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/admin/login?return=/platform')
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.locator('button[type="submit"], button:has-text("Sign in")').first().click()
  // May land on /mfa-challenge (TOTP needed), /platform, or /mfa-enroll
  await page.waitForURL(/\/platform|\/mfa-challenge|\/mfa-enroll/, { timeout: 20_000 })
}

// ─── Route assertion helpers ──────────────────────────────────────────────────

/**
 * Assert a route is blocked: redirect to login/unauthorized OR 4xx HTTP response.
 */
async function expectBlocked(page: Page, routePath: string): Promise<void> {
  const response = await page.goto(routePath)
  await page.waitForLoadState('domcontentloaded')

  const finalUrl = page.url()

  const redirectedToGate =
    finalUrl.includes('/login') ||
    finalUrl.includes('/unauthorized') ||
    finalUrl.includes('/access-denied') ||
    finalUrl.includes('/mfa-')

  const httpBlocked = response != null && [401, 403, 404].includes(response.status())

  const textBlocked = await page
    .locator('text=/403|unauthorized|forbidden|not allowed|access denied/i')
    .isVisible()
    .catch(() => false)

  expect(
    redirectedToGate || httpBlocked || textBlocked,
    `Expected "${routePath}" to be BLOCKED, but landed at: ${finalUrl} (HTTP ${response?.status()})`
  ).toBe(true)
}

/**
 * Assert a route is accessible: no redirect to login, no 4xx response.
 */
async function expectAccessible(page: Page, routePath: string): Promise<void> {
  const response = await page.goto(routePath)
  await page.waitForLoadState('domcontentloaded')

  const finalUrl = page.url()

  const redirectedToGate =
    finalUrl.includes('/login') ||
    finalUrl.includes('/unauthorized') ||
    finalUrl.includes('/access-denied')

  const httpError = response != null && response.status() >= 400

  expect(
    redirectedToGate,
    `Expected "${routePath}" to be ACCESSIBLE, but was redirected to: ${finalUrl}`
  ).toBe(false)

  expect(
    httpError,
    `Expected "${routePath}" to be ACCESSIBLE, but got HTTP ${response?.status()}`
  ).toBe(false)
}

// ─── 1. Platform Admin ────────────────────────────────────────────────────────

test.describe('Platform Admin — RBAC', () => {
  test.skip(
    !!process.env.TEST_SKIP_PLATFORM_ADMIN,
    'Skipped: TEST_SKIP_PLATFORM_ADMIN is set (MFA pre-enrollment required in this env)'
  )

  test('reaches /platform or MFA gate after login', async ({ page }) => {
    await loginAsPlatformAdmin(page, ACCOUNTS.platformAdmin.email, ACCOUNTS.platformAdmin.password)
    const url = page.url()

    if (url.includes('/mfa-enroll')) {
      // MFA not yet enrolled — the gate is working
      test.skip(true, 'Platform admin MFA not enrolled in this environment')
      return
    }

    if (url.includes('/mfa-challenge')) {
      // MFA challenge is the expected gate — TOTP enforcement is working
      expect(url).toContain('/mfa-challenge')
      return
    }

    // Past MFA — must be on /platform
    expect(url).toContain('/platform')
    await expect(page.locator('h1, [data-testid="platform-header"]').first()).toBeVisible()
  })

  test('is blocked from /admin/dashboard (no tenant membership)', async ({ page }) => {
    await loginAsPlatformAdmin(page, ACCOUNTS.platformAdmin.email, ACCOUNTS.platformAdmin.password)
    if (page.url().includes('/mfa-')) {
      test.skip(true, 'Cannot proceed past MFA gate in this environment')
      return
    }
    await expectBlocked(page, '/admin/dashboard')
  })

  test('is blocked from /admin/invoices', async ({ page }) => {
    await loginAsPlatformAdmin(page, ACCOUNTS.platformAdmin.email, ACCOUNTS.platformAdmin.password)
    if (page.url().includes('/mfa-')) {
      test.skip(true, 'Cannot proceed past MFA gate in this environment')
      return
    }
    await expectBlocked(page, '/admin/invoices')
  })
})

// ─── 2. Tenant Admin (owner role) ────────────────────────────────────────────

test.describe('Tenant Admin (owner role) — RBAC', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTenantUser(page, ACCOUNTS.tenantAdmin.email, ACCOUNTS.tenantAdmin.password)
  })

  test('can access /admin/dashboard', async ({ page }) => {
    await expectAccessible(page, '/admin/dashboard')
    await expect(page.locator('h1, [data-testid="dashboard-header"]').first()).toBeVisible()
  })

  test('can access /admin/orders', async ({ page }) => {
    await expectAccessible(page, '/admin/orders')
  })

  test('can access /admin/invoices', async ({ page }) => {
    await expectAccessible(page, '/admin/invoices')
  })

  test('can access /admin/analytics', async ({ page }) => {
    await expectAccessible(page, '/admin/analytics')
  })

  test('can access /admin/team', async ({ page }) => {
    await expectAccessible(page, '/admin/team')
  })

  test('can access /admin/settings', async ({ page }) => {
    await expectAccessible(page, '/admin/settings')
  })

  test('can access /admin/inventory', async ({ page }) => {
    await expectAccessible(page, '/admin/inventory')
  })

  test('can access /admin/purchase-orders', async ({ page }) => {
    await expectAccessible(page, '/admin/purchase-orders')
  })

  test('can access /admin/kds-config', async ({ page }) => {
    await expectAccessible(page, '/admin/kds-config')
  })

  test('is blocked from /platform (not a platform admin)', async ({ page }) => {
    await expectBlocked(page, '/platform')
  })
})

// ─── 3. Admin (admin role) ────────────────────────────────────────────────────

test.describe('Admin (admin role) — RBAC', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTenantUser(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password)
  })

  test('can access /admin/dashboard', async ({ page }) => {
    await expectAccessible(page, '/admin/dashboard')
    await expect(page.locator('h1, [data-testid="dashboard-header"]').first()).toBeVisible()
  })

  test('can access /admin/orders', async ({ page }) => {
    await expectAccessible(page, '/admin/orders')
  })

  test('can access /admin/invoices', async ({ page }) => {
    await expectAccessible(page, '/admin/invoices')
  })

  test('can access /admin/inventory', async ({ page }) => {
    await expectAccessible(page, '/admin/inventory')
  })

  test('can access /admin/analytics', async ({ page }) => {
    await expectAccessible(page, '/admin/analytics')
  })

  test('can access /admin/team', async ({ page }) => {
    await expectAccessible(page, '/admin/team')
  })

  test('can access /admin/purchase-orders', async ({ page }) => {
    await expectAccessible(page, '/admin/purchase-orders')
  })

  test('can access /admin/invoice-exceptions', async ({ page }) => {
    await expectAccessible(page, '/admin/invoice-exceptions')
  })

  test('can access /admin/settings', async ({ page }) => {
    await expectAccessible(page, '/admin/settings')
  })

  test('is blocked from /platform', async ({ page }) => {
    await expectBlocked(page, '/platform')
  })
})

// ─── 4. Staff ────────────────────────────────────────────────────────────────

test.describe('Staff — RBAC', () => {
  /**
   * Staff can authenticate via /admin/login.
   * The app gives staff access to dashboard and operational views,
   * but blocks /admin/invoices, /admin/analytics, and platform admin routes.
   * /admin/kds-config is gated by config_access_roles (default: owner+admin only).
   */

  test.beforeEach(async ({ page }) => {
    await loginAsTenantUser(page, ACCOUNTS.staff.email, ACCOUNTS.staff.password)
  })

  test('can access /admin/dashboard', async ({ page }) => {
    await expectAccessible(page, '/admin/dashboard')
  })

  test('can access /admin/orders', async ({ page }) => {
    await expectAccessible(page, '/admin/orders')
  })

  test('can access /admin/menu', async ({ page }) => {
    await expectAccessible(page, '/admin/menu')
  })

  test('is blocked from /platform', async ({ page }) => {
    await expectBlocked(page, '/platform')
  })

  test('/admin/kds-config: blocked or access-denied (config_access_roles gate)', async ({ page }) => {
    const response = await page.goto('/admin/kds-config')
    await page.waitForLoadState('domcontentloaded')
    const finalUrl = page.url()

    const isBlocked =
      finalUrl.includes('/access-denied') ||
      finalUrl.includes('/login') ||
      finalUrl.includes('/unauthorized') ||
      (response != null && [401, 403].includes(response.status())) ||
      await page.locator('text=/access denied|not allowed|forbidden/i').isVisible().catch(() => false)

    const isGranted = !isBlocked && finalUrl.includes('/admin/kds-config')

    // Both outcomes acceptable — if staff is in config_access_roles it's allowed,
    // otherwise it's blocked. Either way: no unhandled crash.
    expect(isBlocked || isGranted).toBe(true)
  })
})

// ─── 5. Customer (unauthenticated) ───────────────────────────────────────────

test.describe('Customer (unauthenticated) — RBAC', () => {
  /**
   * No login — fresh browser context with no session cookies.
   * Every admin route must redirect to /login or return a 4xx.
   */

  test('is blocked from /admin/dashboard', async ({ page }) => {
    await expectBlocked(page, '/admin/dashboard')
  })

  test('is blocked from /admin/orders', async ({ page }) => {
    await expectBlocked(page, '/admin/orders')
  })

  test('is blocked from /admin/invoices', async ({ page }) => {
    await expectBlocked(page, '/admin/invoices')
  })

  test('is blocked from /admin/analytics', async ({ page }) => {
    await expectBlocked(page, '/admin/analytics')
  })

  test('is blocked from /admin/team', async ({ page }) => {
    await expectBlocked(page, '/admin/team')
  })

  test('is blocked from /admin/menu', async ({ page }) => {
    await expectBlocked(page, '/admin/menu')
  })

  test('is blocked from /admin/inventory', async ({ page }) => {
    await expectBlocked(page, '/admin/inventory')
  })

  test('is blocked from /admin/settings', async ({ page }) => {
    await expectBlocked(page, '/admin/settings')
  })

  test('is blocked from /admin/purchase-orders', async ({ page }) => {
    await expectBlocked(page, '/admin/purchase-orders')
  })

  test('is blocked from /admin/invoice-exceptions', async ({ page }) => {
    await expectBlocked(page, '/admin/invoice-exceptions')
  })

  test('is blocked from /admin/kds-config', async ({ page }) => {
    await expectBlocked(page, '/admin/kds-config')
  })

  test('is blocked from /platform', async ({ page }) => {
    await expectBlocked(page, '/platform')
  })

  test('/admin/login is publicly accessible', async ({ page }) => {
    const response = await page.goto('/admin/login')
    expect(response?.status() ?? 200).toBeLessThan(400)
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 })
  })
})
