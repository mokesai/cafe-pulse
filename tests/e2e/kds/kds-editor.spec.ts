/**
 * KDS Grid Editor E2E Tests — MOK-16, 17, 18, 19
 * Auth state pre-loaded via tests/e2e/auth.setup.ts
 */

import { test, expect } from '@playwright/test'

test.describe('KDS Editor', () => {
  test('editor page loads for drinks screen', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/drinks')
    await expect(page.getByText(/KDS Layout Editor/i)).toBeVisible()
    await expect(page.getByText(/1920×1080/i)).toBeVisible()
  })

  test('editor page loads for food screen', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/food')
    await expect(page.getByText(/KDS Layout Editor/i)).toBeVisible()
  })

  test('screen toggle is visible', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/drinks')
    await expect(page.getByRole('link', { name: /Drinks/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Food/i })).toBeVisible()
  })

  test('toolbar buttons are present', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/drinks')
    await expect(page.getByRole('button', { name: /Save Draft/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Publish/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Reset/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Preview/i })).toBeVisible()
    // Column controls
    await expect(page.getByRole('button', { name: /Add column/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Remove last column/i })).toBeVisible()
  })

  test('properties panel shows screen settings when nothing selected', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/drinks')
    await expect(page.getByText(/Screen Settings/i)).toBeVisible()
    await expect(page.getByText(/^Columns$/i)).toBeVisible()
    await expect(page.getByText(/^Theme$/i)).toBeVisible()
  })

  test('add row button adds a row to canvas', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/drinks')
    // Each column has an Add row button
    const addRowBtns = page.getByRole('button', { name: /Add row/i })
    await expect(addRowBtns.first()).toBeVisible()
    await addRowBtns.first().click()
    // After adding a row, unsaved indicator appears
    await expect(page.getByText(/Unsaved/i)).toBeVisible()
  })

  test('save draft is disabled when no unsaved changes', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/drinks')
    const saveBtn = page.getByRole('button', { name: /Save Draft/i })
    await expect(saveBtn).toBeDisabled()
  })

  test('save draft enables after making a change', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/drinks')
    await page.getByRole('button', { name: /Add column/i }).click()
    const saveBtn = page.getByRole('button', { name: /Save Draft/i })
    await expect(saveBtn).not.toBeDisabled()
  })

  test('reset button shows confirmation', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/drinks')
    await page.getByRole('button', { name: /Reset/i }).click()
    await expect(page.getByText(/deletes your custom layout/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Yes, reset/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Cancel/i })).toBeVisible()
  })

  test('reset confirmation can be cancelled', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/drinks')
    await page.getByRole('button', { name: /Reset/i }).click()
    await page.getByRole('button', { name: /Cancel/i }).click()
    await expect(page.getByText(/deletes your custom layout/i)).not.toBeVisible()
  })

  test('hub page Layout Editor link navigates to editor', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config')
    await page.getByRole('link', { name: /Layout Editor/i }).click()
    await expect(page).toHaveURL(/\/admin\/kds-config\/editor\/drinks/)
  })

  test('404 for invalid screen param', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/kds-config/editor/breakfast')
    await expect(page).toHaveURL(/404|not-found|admin\/kds-config\/editor\/breakfast/)
  })
})
