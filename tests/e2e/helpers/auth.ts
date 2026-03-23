/**
 * Playwright auth helpers for Cafe Pulse E2E tests
 * Handles login flows for platform admins and tenant users
 */

import { Page } from '@playwright/test'

export interface TestUser {
  email: string
  password: string
}

export const testUsers = {
  superAdmin: {
    email: process.env.TEST_SUPER_ADMIN_EMAIL ?? '',
    password: process.env.TEST_SUPER_ADMIN_PASSWORD ?? '',
  },
  bigcafeOwner: {
    email: process.env.TEST_BIGCAFE_OWNER_EMAIL ?? '',
    password: process.env.TEST_BIGCAFE_OWNER_PASSWORD ?? '',
  },
  bigcafeAdmin: {
    email: process.env.TEST_BIGCAFE_ADMIN_EMAIL ?? '',
    password: process.env.TEST_BIGCAFE_ADMIN_PASSWORD ?? '',
  },
}

/**
 * Log in as a tenant admin via the admin login page
 */
export async function loginAsAdmin(page: Page, user: TestUser, tenantSlug: string) {
  await page.goto(`http://${tenantSlug}.localhost:3000/admin/login`)
  await page.getByLabel(/email/i).fill(user.email)
  await page.getByLabel(/password/i).fill(user.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Wait for redirect to dashboard
  await page.waitForURL(/\/admin\/dashboard/, { timeout: 15000 })
}

/**
 * Log in as a platform admin via the bare domain login page
 */
export async function loginAsPlatformAdmin(page: Page, user: TestUser) {
  await page.goto('http://localhost:3000/admin/login')
  await page.getByLabel(/email/i).fill(user.email)
  await page.getByLabel(/password/i).fill(user.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/platform|\/admin\/dashboard/, { timeout: 15000 })
}
