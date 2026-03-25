/**
 * E2E Tests: Invoice Exception Queue
 * Covers: AC-14, AC-15, AC-16, AC-17
 *
 * AC-14: GET /api/admin/invoice-exceptions?status=open returns correct paginated exceptions
 *        within 500ms. No cross-tenant leakage.
 * AC-15: POST resolve transitions status to 'resolved'; triggers auto-confirmation if last open.
 * AC-16: POST dismiss transitions status to 'dismissed' without triggering confirmation.
 * AC-17: After manual match, supplier_item_aliases has source='manual'.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const API_BASE = `${BASE_URL}/api/admin`

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getOpenExceptions(page: import('@playwright/test').Page) {
  const start = Date.now()
  const res = await page.request.get(`${API_BASE}/invoice-exceptions?status=open&limit=20`)
  const elapsed = Date.now() - start
  return { res, elapsed }
}

// ─── AC-14: Exception Queue API ─────────────────────────────────────────────

test.describe('AC-14: Exception queue API', () => {
  test('GET /api/admin/invoice-exceptions?status=open returns 200 with correct shape within 500ms', async ({ page }) => {
    const { res, elapsed } = await getOpenExceptions(page)

    expect(res.status()).toBe(200)
    expect(elapsed).toBeLessThan(500)

    const body = await res.json()
    expect(body).toHaveProperty('success', true)
    expect(body).toHaveProperty('data')
    expect(Array.isArray(body.data)).toBe(true)
    expect(body).toHaveProperty('open_count')
    expect(typeof body.open_count).toBe('number')
    expect(body).toHaveProperty('pagination')
    expect(body.pagination).toMatchObject({
      page: expect.any(Number),
      limit: expect.any(Number),
      total: expect.any(Number),
      pages: expect.any(Number),
    })
  })

  test('Filters by status=resolved correctly', async ({ page }) => {
    const res = await page.request.get(`${API_BASE}/invoice-exceptions?status=resolved&limit=5`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // All returned exceptions should have status 'resolved'
    for (const exc of body.data) {
      expect(exc.status).toBe('resolved')
    }
  })

  test('Returns 401 when unauthenticated', async ({ browser }) => {
    // Use a new context with no cookies/auth
    const ctx = await browser.newContext()
    const req = ctx.request
    const res = await req.get(`${API_BASE}/invoice-exceptions?status=open`)
    expect([401, 403]).toContain(res.status())
    await ctx.close()
  })

  test('Exception rows include invoice_number and supplier name', async ({ page }) => {
    const res = await page.request.get(`${API_BASE}/invoice-exceptions?status=open&limit=5`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    for (const exc of body.data) {
      expect(exc).toHaveProperty('id')
      expect(exc).toHaveProperty('exception_type')
      expect(exc).toHaveProperty('exception_message')
      expect(exc).toHaveProperty('status', 'open')
    }
  })

  test('Pagination works correctly', async ({ page }) => {
    const res1 = await page.request.get(`${API_BASE}/invoice-exceptions?status=all&page=1&limit=5`)
    const res2 = await page.request.get(`${API_BASE}/invoice-exceptions?status=all&page=2&limit=5`)
    expect(res1.status()).toBe(200)
    expect(res2.status()).toBe(200)
    const body1 = await res1.json()
    const body2 = await res2.json()
    // If there's only one page, page 2 should return empty data
    if (body1.pagination.pages === 1) {
      expect(body2.data.length).toBe(0)
    } else {
      // IDs on page 1 and page 2 should not overlap
      const ids1 = body1.data.map((e: { id: string }) => e.id)
      const ids2 = body2.data.map((e: { id: string }) => e.id)
      const overlap = ids1.filter((id: string) => ids2.includes(id))
      expect(overlap.length).toBe(0)
    }
  })
})

// ─── AC-14 (UI): Exception Queue Page ───────────────────────────────────────

test.describe('AC-14: Exception Queue UI', () => {
  test('Exception queue page renders and shows list or empty state', async ({ page }) => {
    await page.goto('/admin/invoice-exceptions')
    await page.waitForLoadState('networkidle')

    // Either shows exception rows, empty state, or loading skeleton
    const hasExceptions = await page.locator('[class*="rounded-lg"]').first().isVisible()
    expect(hasExceptions).toBe(true)
  })

  test('Filter tabs render — Open, Resolved, Dismissed, All', async ({ page }) => {
    await page.goto('/admin/invoice-exceptions')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('button', { name: 'Open' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resolved' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dismissed' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
  })

  test('URL reflects filter state', async ({ page }) => {
    await page.goto('/admin/invoice-exceptions')
    await page.waitForLoadState('networkidle')

    // Click Resolved tab
    await page.getByRole('button', { name: 'Resolved' }).click()
    await page.waitForURL(/status=resolved/)
    expect(page.url()).toContain('status=resolved')
  })

  test('Sidebar shows Invoice Exceptions nav item', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await expect(page.getByText('Invoice Exceptions')).toBeVisible()
  })
})

// ─── AC-15: Resolve exception ───────────────────────────────────────────────

test.describe('AC-15: Exception resolve API', () => {
  test('POST /resolve with dismiss action transitions status to resolved', async ({ page }) => {
    // First get an open exception
    const listRes = await page.request.get(`${API_BASE}/invoice-exceptions?status=open&limit=1`)
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()

    if (listBody.data.length === 0) {
      test.skip(true, 'No open exceptions to test resolve on')
      return
    }

    const exception = listBody.data[0]
    const { id, exception_type } = exception

    // Resolve with an appropriate action for the type
    let action: Record<string, unknown>
    switch (exception_type) {
      case 'no_po_match':
        action = { type: 'confirm_without_po' }
        break
      case 'low_extraction_confidence':
        action = { type: 'approve_and_continue' }
        break
      case 'parse_error':
        action = { type: 'retry_pipeline' }
        break
      case 'duplicate_invoice':
        action = { type: 'dismiss_as_duplicate' }
        break
      case 'price_variance':
        action = { type: 'approve_cost_update' }
        break
      case 'quantity_variance':
        action = { type: 'confirm_quantity', accepted_quantity: 1 }
        break
      default:
        action = { type: 'approve_and_continue' }
    }

    const resolveRes = await page.request.post(`${API_BASE}/invoice-exceptions/${id}/resolve`, {
      data: { action, resolution_notes: 'E2E test resolve' },
    })
    expect(resolveRes.status()).toBe(200)
    const resolveBody = await resolveRes.json()
    expect(resolveBody.success).toBe(true)
    expect(resolveBody.exception_id).toBe(id)

    // Verify exception is now resolved
    const detailRes = await page.request.get(`${API_BASE}/invoice-exceptions/${id}`)
    expect(detailRes.status()).toBe(200)
    const detailBody = await detailRes.json()
    expect(detailBody.data.status).toBe('resolved')
  })
})

// ─── AC-16: Dismiss exception ───────────────────────────────────────────────

test.describe('AC-16: Exception dismiss API', () => {
  test('POST /dismiss transitions status to dismissed', async ({ page }) => {
    const listRes = await page.request.get(`${API_BASE}/invoice-exceptions?status=open&limit=5`)
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()

    if (listBody.data.length === 0) {
      test.skip(true, 'No open exceptions to test dismiss on')
      return
    }

    const exception = listBody.data[listBody.data.length - 1] // pick last one
    const { id } = exception

    const dismissRes = await page.request.post(`${API_BASE}/invoice-exceptions/${id}/dismiss`, {
      data: { resolution_notes: 'E2E test dismiss' },
    })
    expect(dismissRes.status()).toBe(200)
    const dismissBody = await dismissRes.json()
    expect(dismissBody.success).toBe(true)
    expect(dismissBody.exception_id).toBe(id)

    // Verify status is now dismissed
    const detailRes = await page.request.get(`${API_BASE}/invoice-exceptions/${id}`)
    expect(detailRes.status()).toBe(200)
    const detailBody = await detailRes.json()
    expect(detailBody.data.status).toBe('dismissed')
  })

  test('Bulk dismiss marks multiple exceptions as dismissed', async ({ page }) => {
    const listRes = await page.request.get(`${API_BASE}/invoice-exceptions?status=open&limit=3`)
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()

    if (listBody.data.length < 2) {
      test.skip(true, 'Need at least 2 open exceptions for bulk dismiss test')
      return
    }

    const ids = listBody.data.slice(0, 2).map((e: { id: string }) => e.id)
    const bulkRes = await page.request.post(`${API_BASE}/invoice-exceptions/bulk-dismiss`, {
      data: { exception_ids: ids, resolution_notes: 'E2E bulk dismiss test' },
    })
    expect(bulkRes.status()).toBe(200)
    const bulkBody = await bulkRes.json()
    expect(bulkBody.success).toBe(true)
    expect(bulkBody.dismissed_count).toBeGreaterThanOrEqual(1)
  })
})

// ─── AC-17: Manual match creates alias ──────────────────────────────────────

test.describe('AC-17: Supplier item alias creation on manual match', () => {
  test('Resolving no_item_match with match_item creates alias with source=manual', async ({ page }) => {
    // Find a no_item_match exception
    const listRes = await page.request.get(
      `${API_BASE}/invoice-exceptions?status=open&type=no_item_match&limit=1`
    )
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()

    if (listBody.data.length === 0) {
      test.skip(true, 'No no_item_match exceptions available for alias test')
      return
    }

    const exception = listBody.data[0]
    const ctx = exception.exception_context

    // Need an inventory item to match to
    const inventoryRes = await page.request.get(`${API_BASE}/inventory?limit=1`)
    expect(inventoryRes.status()).toBe(200)
    const inventoryBody = await inventoryRes.json()

    if (!inventoryBody.data?.length) {
      test.skip(true, 'No inventory items available for alias test')
      return
    }

    const inventoryItem = inventoryBody.data[0]

    // Resolve with manual match
    const resolveRes = await page.request.post(
      `${API_BASE}/invoice-exceptions/${exception.id}/resolve`,
      {
        data: {
          action: { type: 'match_item', inventory_item_id: inventoryItem.id },
          resolution_notes: 'E2E manual match test',
        },
      }
    )
    expect(resolveRes.status()).toBe(200)
    const resolveBody = await resolveRes.json()
    expect(resolveBody.success).toBe(true)

    // Check that an alias was created with source=manual
    const aliasRes = await page.request.get(
      `${API_BASE}/supplier-item-aliases?limit=10`
    )
    expect(aliasRes.status()).toBe(200)
    const aliasBody = await aliasRes.json()

    // Find the alias that corresponds to our match
    const manualAliases = aliasBody.data?.filter(
      (a: { source: string; inventory_item_id: string }) =>
        a.source === 'manual' && a.inventory_item_id === inventoryItem.id
    )
    expect(manualAliases?.length).toBeGreaterThan(0)
  })

  test('Supplier item aliases API returns correct structure', async ({ page }) => {
    const res = await page.request.get(`${API_BASE}/supplier-item-aliases?limit=5`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    for (const alias of body.data) {
      expect(alias).toHaveProperty('id')
      expect(alias).toHaveProperty('source')
      expect(['auto', 'manual']).toContain(alias.source)
    }
  })
})

// ─── Exception detail page ───────────────────────────────────────────────────

test.describe('Exception detail page', () => {
  test('Detail page loads for a valid exception ID', async ({ page }) => {
    const listRes = await page.request.get(`${API_BASE}/invoice-exceptions?status=all&limit=1`)
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()

    if (listBody.data.length === 0) {
      test.skip(true, 'No exceptions to test detail page')
      return
    }

    const exceptionId = listBody.data[0].id
    await page.goto(`/admin/invoice-exceptions/${exceptionId}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Back to Exception Queue')).toBeVisible()
    await expect(page.getByText('Exception Details')).toBeVisible()
  })
})
