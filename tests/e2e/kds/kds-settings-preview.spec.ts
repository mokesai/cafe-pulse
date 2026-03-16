/**
 * KDS Settings and Preview E2E Tests — MOK-21, 22, 23
 * Auth state pre-loaded via tests/e2e/auth.setup.ts
 */

import { test, expect } from '@playwright/test'

test.describe('KDS Settings Page', () => {
  test('settings page loads', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/settings')
    await expect(page.getByRole('heading', { name: /KDS Settings/i })).toBeVisible()
  })

  test('access permissions section visible', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/settings')
    await expect(page.getByText(/Access Permissions/i)).toBeVisible()
    await expect(page.getByText(/owner/i).first()).toBeVisible()
    await expect(page.getByText(/admin/i).first()).toBeVisible()
    await expect(page.getByText(/staff/i).first()).toBeVisible()
  })

  test('owner checkbox is disabled', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/settings')
    // Owner checkbox should be checked and disabled
    const ownerCheckbox = page.locator('input[type="checkbox"]').first()
    await expect(ownerCheckbox).toBeChecked()
    await expect(ownerCheckbox).toBeDisabled()
  })

  test('theme dropdown is present', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/settings')
    await expect(page.getByText(/Display theme/i)).toBeVisible()
    await expect(page.locator('select').first()).toBeVisible()
  })

  test('display settings fields are present', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/settings')
    await expect(page.getByText(/Café name/i)).toBeVisible()
    await expect(page.getByText(/Hours/i)).toBeVisible()
    await expect(page.getByText(/Drinks tagline/i)).toBeVisible()
    await expect(page.getByText(/Food tagline/i)).toBeVisible()
  })

  test('refresh settings are present', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/settings')
    await expect(page.getByText(/Screen refresh interval/i)).toBeVisible()
    await expect(page.getByText(/Image rotation interval/i)).toBeVisible()
  })

  test('save button is present', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/settings')
    await expect(page.getByRole('button', { name: /Save Settings/i })).toBeVisible()
  })

  test('back link navigates to hub', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/settings')
    await page.getByRole('link', { name: /Back to KDS Configuration/i }).click()
    await expect(page).toHaveURL(/\/admin\/kds-config$/)
  })
})

test.describe('KDS Preview Page', () => {
  test('drinks preview page loads', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/preview/drinks')
    await expect(page.getByText(/KDS Layout Editor|Previewing at 1920/i)).toBeVisible({ timeout: 10000 })
  })

  test('food preview page loads', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/preview/food')
    await expect(page.getByText(/Previewing at 1920×1080/i)).toBeVisible({ timeout: 10000 })
  })

  test('preview toolbar has screen toggle', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/preview/drinks')
    // Screen toggle links point to preview URLs
    await expect(page.locator('a[href="/admin/kds-config/preview/drinks"]')).toBeVisible()
    await expect(page.locator('a[href="/admin/kds-config/preview/food"]').first()).toBeVisible()
  })

  test('preview has full screen button', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/preview/drinks')
    await expect(page.getByRole('button', { name: /Full Screen/i })).toBeVisible()
  })

  test('back to editor link works', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/preview/drinks')
    await page.getByRole('link', { name: /Back to Editor/i }).click()
    await expect(page).toHaveURL(/\/admin\/kds-config\/editor\/drinks/)
  })
})
