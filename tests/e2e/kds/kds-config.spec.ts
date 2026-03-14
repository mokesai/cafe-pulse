/**
 * KDS Configuration E2E Tests — MOK-8, MOK-9
 * Tests the KDS config hub and Google Sheets generation flow
 */

import { test, expect } from '@playwright/test'
import { loginAsAdmin, testUsers } from '../helpers/auth'

const TENANT = process.env.TEST_TENANT_1 ?? 'bigcafe'

test.describe('KDS Config Hub', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, testUsers.bigcafeOwner, TENANT)
  })

  test('KDS Setup appears in admin nav', async ({ page }) => {
    await expect(page.getByRole('link', { name: /KDS Setup/i })).toBeVisible()
  })

  test('hub page loads at /admin/kds-config', async ({ page }) => {
    await page.goto(`http://${TENANT}.localhost:3000/admin/kds-config`)
    await expect(page.getByRole('heading', { name: /KDS Configuration/i })).toBeVisible()
    // Status cards
    await expect(page.getByText(/Setup Sheet/i)).toBeVisible()
    await expect(page.getByText(/Last Import/i)).toBeVisible()
    await expect(page.getByText(/Square Sync/i)).toBeVisible()
  })

  test('hub page shows quick action tiles', async ({ page }) => {
    await page.goto(`http://${TENANT}.localhost:3000/admin/kds-config`)
    await expect(page.getByRole('link', { name: /Manage Sheet/i })).toBeVisible()
    await expect(page.getByText(/Layout Editor/i)).toBeVisible()
    await expect(page.getByText(/Coming soon/i)).toBeVisible()
  })
})

test.describe('KDS Sheets Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, testUsers.bigcafeOwner, TENANT)
  })

  test('sheets page loads at /admin/kds-config/sheets', async ({ page }) => {
    await page.goto(`http://${TENANT}.localhost:3000/admin/kds-config/sheets`)
    await expect(page.getByRole('heading', { name: /Google Sheets Management/i })).toBeVisible()
    await expect(page.getByText(/Import from Sheet/i)).toBeVisible()
    await expect(page.getByText(/Sync from Square/i)).toBeVisible()
  })

  test('shows generate button when no sheet exists', async ({ page }) => {
    await page.goto(`http://${TENANT}.localhost:3000/admin/kds-config/sheets`)
    // Either "Generate Setup Sheet" button or "Open Sheet" link should be present
    const generateBtn = page.getByRole('button', { name: /Generate Setup Sheet/i })
    const openSheetBtn = page.getByRole('link', { name: /Open Sheet/i })
    await expect(generateBtn.or(openSheetBtn)).toBeVisible()
  })

  test('back link navigates to hub', async ({ page }) => {
    await page.goto(`http://${TENANT}.localhost:3000/admin/kds-config/sheets`)
    await page.getByRole('link', { name: /Back to KDS Configuration/i }).click()
    await expect(page).toHaveURL(/\/admin\/kds-config$/)
  })
})
