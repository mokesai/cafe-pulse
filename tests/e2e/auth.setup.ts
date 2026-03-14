/**
 * Playwright global auth setup
 * Logs in as the test owner and saves the authenticated state to disk.
 * All tests reuse this state — no login on every test.
 */

import { test as setup } from '@playwright/test'
import path from 'path'

export const STORAGE_STATE = path.join(__dirname, '.auth/owner.json')

setup('authenticate as test owner', async ({ page }) => {
  // Clear any existing session
  await page.context().clearCookies()

  // Use ?return=/admin/dashboard to bypass platform mode on bare localhost
  await page.goto('http://localhost:3000/admin/login?return=/admin/dashboard')
  console.log('Login page URL:', page.url())

  // Wait for the form to be ready
  await page.locator('input[type="email"]').waitFor({ timeout: 10000 })

  await page.locator('input[type="email"]').fill('test-owner@cafe-pulse.test')
  await page.locator('input[type="password"]').fill('TestOwner123!')

  console.log('Submitting login form...')
  await page.locator('button[type="submit"]').first().click()

  // Wait for navigation away from login
  await page.waitForURL(url => !url.toString().includes('/admin/login'), { timeout: 15000 })
  console.log('After login URL:', page.url())

  // If we landed on MFA enroll, log it
  if (page.url().includes('mfa-enroll')) {
    console.error('ERROR: Redirected to MFA enroll:', page.url())
    throw new Error('Test account hit MFA enroll — bypass not working')
  }

  // Wait for dashboard
  await page.waitForURL(/\/admin\/dashboard/, { timeout: 10000 })

  // Save auth state (cookies + localStorage)
  await page.context().storageState({ path: STORAGE_STATE })
  console.log('Auth state saved to', STORAGE_STATE)
})
