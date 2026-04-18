import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for E2E Testing
 *
 * Two modes:
 *   1. Remote (BASE_URL set)  — tests hit an already-running server (staging, preview, etc.)
 *   2. Local  (BASE_URL unset) — Playwright spins up `next dev` automatically
 *
 * CI uses PLAYWRIGHT_WEB_SERVER=true to activate webServer in mode 2.
 * Locally, set BASE_URL in .env.test.local to hit a running server, or leave it
 * unset to have Playwright start the dev server for you.
 */

const baseURL = process.env.BASE_URL || 'http://localhost:3000';

// Activate webServer when:
//   - No BASE_URL is provided (we need to boot the app ourselves), AND
//   - We're either in CI (PLAYWRIGHT_WEB_SERVER=true) or running locally without a
//     server already listening on port 3000.
const useWebServer = !process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['github']] : 'html',
  // AI parsing + PO matching can take 20-30s — give each test 60s in CI
  timeout: process.env.CI ? 60_000 : 30_000,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pass Vercel deployment protection bypass header for CI
    ...(process.env.VERCEL_BYPASS_SECRET ? {
      extraHTTPHeaders: {
        'x-vercel-protection-bypass': process.env.VERCEL_BYPASS_SECRET,
      }
    } : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Spin up the Next.js dev server when no external BASE_URL is provided.
  // In CI this covers the "local" mode. Locally it's convenient too — just run
  // `npx playwright test` without starting the server first.
  webServer: useWebServer
    ? {
        command: 'npm run dev:webpack',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          // Pass through any env vars the app needs at startup
          ...(process.env.NEXT_PUBLIC_SUPABASE_URL
            ? { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL }
            : {}),
          ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            ? { NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }
            : {}),
        },
      }
    : undefined,
});
