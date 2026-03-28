import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Authentication fixtures for E2E tests
 * Provides pre-authenticated admin sessions
 */

type AuthenticatedFixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<AuthenticatedFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Navigate to login page
    await page.goto('/admin/login');
    
    // Wait for login form to be ready
    await page.waitForSelector('input[type="email"]');
    
    // Login with test credentials
    const testEmail = 'jerrym@mokesai.org'; // bigcafe admin
    const testPassword = process.env.TEST_PASSWORD || '';
    
    if (!testPassword) {
      throw new Error('TEST_PASSWORD environment variable not set');
    }
    
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button:has-text("Sign in")');
    
    // Wait for redirect to dashboard
    await page.waitForURL('**/platform/**', { timeout: 10000 });
    
    // Use the authenticated page in tests
    await use(page);
  },
});

export { expect } from '@playwright/test';
