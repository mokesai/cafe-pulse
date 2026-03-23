/**
 * KDS Sheets Pipeline E2E Tests — MOK-10, MOK-11, MOK-12
 * Tests Import from Sheet and Sync from Square UI flows
 * Auth state pre-loaded via tests/e2e/auth.setup.ts
 */

import { test, expect } from '@playwright/test'

test.describe('Sheets Pipeline UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/sheets')
    await expect(page.getByRole('heading', { name: /Google Sheets Management/i })).toBeVisible()
  })

  test('Import section is collapsed by default', async ({ page }) => {
    await expect(page.getByText(/Import mode/i)).not.toBeVisible()
  })

  test('Import section expands on click', async ({ page }) => {
    // Click the collapsible header button (contains "Import from Sheet" text)
    await page.locator('button').filter({ hasText: /Import from Sheet/ }).click()
    await expect(page.getByText(/Import mode/i)).toBeVisible()
    await expect(page.getByText(/Clean \(default\)/i)).toBeVisible()
    await expect(page.getByText(/Merge/i).first()).toBeVisible()
  })

  test('Import clean mode shows warning', async ({ page }) => {
    await page.locator('button').filter({ hasText: /Import from Sheet/ }).click()
    await expect(page.getByText(/deletes all existing KDS data/i)).toBeVisible()
  })

  test('Import merge mode hides clean warning', async ({ page }) => {
    await page.locator('button').filter({ hasText: /Import from Sheet/ }).click()
    // Click the Merge toggle button
    await page.locator('button').filter({ hasText: /^Merge$/ }).click()
    await expect(page.getByText(/deletes all existing KDS data/i)).not.toBeVisible()
  })

  test('Sync section is collapsed by default', async ({ page }) => {
    await expect(page.getByText(/Sync mode/i)).not.toBeVisible()
  })

  test('Sync section expands on click', async ({ page }) => {
    await page.locator('button').filter({ hasText: /Sync from Square/ }).click()
    await expect(page.getByText(/Sync mode/i)).toBeVisible()
    await expect(page.getByText(/Merge \(default\)/i)).toBeVisible()
    await expect(page.getByText(/Clean \(overwrite\)/i)).toBeVisible()
  })

  test('Sync clean mode shows extra confirmation warning', async ({ page }) => {
    await page.locator('button').filter({ hasText: /Sync from Square/ }).click()
    await page.getByRole('button', { name: /Clean \(overwrite\)/i }).click()
    // The action button should now be the sync trigger
    await page.getByRole('button', { name: /^Sync from Square$/ }).click()
    await expect(page.getByText(/discard all your KDS display edits/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Yes, overwrite/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Cancel$/i })).toBeVisible()
  })

  test('Sync clean confirmation can be cancelled', async ({ page }) => {
    await page.locator('button').filter({ hasText: /Sync from Square/ }).click()
    await page.getByRole('button', { name: /Clean \(overwrite\)/i }).click()
    await page.getByRole('button', { name: /^Sync from Square$/ }).click()
    await page.getByRole('button', { name: /^Cancel$/i }).click()
    await expect(page.getByText(/discard all your KDS display edits/i)).not.toBeVisible()
  })
})
