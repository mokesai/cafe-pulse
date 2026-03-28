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
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    
    // Login with test credentials
    // Test account: tenant admin for bigcafe
    // Password: TestPassword123! (set in database migration)
    const testEmail = process.env.TEST_EMAIL || 'wanda.dev@example.com';
    const testPassword = process.env.TEST_PASSWORD || 'TestPassword123!';
    
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    
    // Click sign in button
    const signInButton = page.locator('button:has-text("Sign in"), button:has-text("Login")').first();
    await signInButton.click();
    
    // Wait for navigation (either to platform or admin dashboard)
    // Try multiple patterns since layout might vary
    try {
      await page.waitForURL(
        url => url.includes('/admin') || url.includes('/platform'),
        { timeout: 15000 }
      );
    } catch (error) {
      // If navigation fails, check for error messages
      const errorMsg = await page.locator('[role="alert"], .error, .toast').first().textContent().catch(() => 'Unknown error');
      throw new Error(`Login failed. Error: ${errorMsg}. Check credentials and login page structure.`);
    }
    
    // Use the authenticated page in tests
    await use(page);
  },
});

export { expect } from '@playwright/test';
