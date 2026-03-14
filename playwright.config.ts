import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

// Load test credentials
config({ path: '.env.test.local', override: false })
config({ path: '.env.test', override: false })

/**
 * Playwright E2E Testing Configuration for Multi-Tenant SaaS
 *
 * This config enables parallel testing with multiple workers to verify
 * cross-tenant isolation. Each worker can test a different tenant
 * simultaneously to catch cache pollution and data leakage.
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Run tests in parallel with 2 workers (one per tenant for isolation testing)
  fullyParallel: true,
  workers: 2,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter to use
  reporter: 'html',

  use: {
    // Base URL for tests (subdomain routing via localhost)
    baseURL: 'http://localhost:3000',

    // Collect trace on first retry for debugging
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // 30-second timeout per action (network requests to Supabase/Square)
    actionTimeout: 30000,
  },

  // Configure projects for major browsers
  projects: [
    // Auth setup — runs first, saves session state
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Reuse authenticated session from setup
        storageState: 'tests/e2e/.auth/owner.json',
      },
      dependencies: ['setup'],
    },
    // Uncomment to test on more browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Dev server must be running before tests: npm run dev
  // Playwright connects to it rather than managing its lifecycle
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 300 * 1000,
  },
});
