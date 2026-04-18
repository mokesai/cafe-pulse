# E2E Tests for Invoice Pipeline

End-to-end tests for the cafe-pulse invoice management system using Playwright.

## Setup

### Prerequisites

- Node.js 18+
- Playwright installed (`npm install -D @playwright/test`)
- Test credentials configured

### Environment Variables

Create a `.env.local` file with:

```bash
# Staging environment
BASE_URL=https://staging.cafepulse.org

# Admin test account credentials
TEST_PASSWORD=<admin-password>
```

### First Run

Install Playwright browsers:

```bash
npx playwright install
```

## Running Tests

### All tests (headless)
```bash
npm run test:e2e
```

### Interactive UI mode
```bash
npm run test:e2e:ui
```

### Debug mode (step through)
```bash
npm run test:e2e:debug
```

### Against staging environment
```bash
npm run test:e2e:staging
```

### View test report
```bash
npm run test:e2e:report
```

## Test Organization

- `fixtures/auth.ts` — Authentication fixture (pre-login for tests)
- `invoice-pipeline.spec.ts` — Invoice upload and processing tests

## Writing New Tests

```typescript
import { test, expect } from './fixtures/auth';

test('should do something', async ({ authenticatedPage }) => {
  await authenticatedPage.goto('/admin/invoices');
  await expect(authenticatedPage.locator('text=Invoices')).toBeVisible();
});
```

## CI/CD Integration

Tests run on pull requests via GitHub Actions. See `.github/workflows/e2e.yml` (to be created).

## Test Coverage

- ✅ Navigation between invoice sections
- ✅ Invoice management page load
- ✅ Exception handling page load
- ✅ Settings page access
- 🚧 Invoice upload and processing (requires test data)
- 🚧 Exception resolution workflows
- 🚧 Variance detection
- 🚧 COGS calculations

## Troubleshooting

### Tests timeout
- Check if staging environment is accessible
- Verify TEST_PASSWORD is set correctly
- Increase timeouts in playwright.config.ts

### Selector not found
- Use `--debug` mode to inspect elements
- Check if element visibility changed in recent UI updates
- Run in UI mode to visually debug

### Auth failures
- Verify test credentials work manually
- Check if login page has changed
- Review auth fixture in `fixtures/auth.ts`

## Performance

Run tests in parallel (default):
```bash
npm run test:e2e
```

Run sequentially (slower, more reliable):
```bash
npx playwright test --workers=1
```

## Reports

After running tests:
- HTML report: `playwright-report/index.html`
- Screenshots: `test-results/` (on failure)
- Videos: `test-results/` (on failure)

View report:
```bash
npm run test:e2e:report
```

## Known Issues

- Invoice upload test skipped (needs test PDF file)
- Some selectors may need adjustment if UI changes
- Test credentials hardcoded (TODO: use proper test account setup)
