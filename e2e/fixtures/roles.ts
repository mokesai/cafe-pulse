import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Role-specific test fixtures
 * Provides pre-authenticated sessions for each user role
 */

type RoleFixtures = {
  platformAdminPage: Page;
  tenantAdminPage: Page;
  adminPage: Page;
  staffPage: Page;
  customerPage: Page;
};

const roles = {
  platformAdmin: {
    email: 'lloyd.ops@agentmail.to',
    password: 'TestPassword123!',
  },
  tenantAdmin: {
    email: 'wanda.dev@example.com',
    password: 'TestPassword123!',
  },
  admin: {
    email: 'milli.design@example.com',
    password: 'TestPassword123!',
  },
  staff: {
    email: 'jesse.business@example.com',
    password: 'TestPassword123!',
  },
  customer: {
    email: 'marvin.marketing@example.com',
    password: 'TestPassword123!',
  },
};

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  
  const signInButton = page.locator('button:has-text("Sign in"), button:has-text("Login")').first();
  await signInButton.click();
  
  await page.waitForURL(
    url => url.includes('/admin') || url.includes('/platform'),
    { timeout: 15000 }
  );
}

export const test = base.extend<RoleFixtures>({
  platformAdminPage: async ({ page }, use) => {
    await loginAs(page, roles.platformAdmin.email, roles.platformAdmin.password);
    await use(page);
  },
  
  tenantAdminPage: async ({ page }, use) => {
    await loginAs(page, roles.tenantAdmin.email, roles.tenantAdmin.password);
    await use(page);
  },
  
  adminPage: async ({ page }, use) => {
    await loginAs(page, roles.admin.email, roles.admin.password);
    await use(page);
  },
  
  staffPage: async ({ page }, use) => {
    await loginAs(page, roles.staff.email, roles.staff.password);
    await use(page);
  },
  
  customerPage: async ({ page }, use) => {
    await loginAs(page, roles.customer.email, roles.customer.password);
    await use(page);
  },
});

export { expect } from '@playwright/test';
