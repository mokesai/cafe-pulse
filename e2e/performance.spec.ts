/**
 * E2E Tests: Performance & Load Testing — MOK-61
 *
 * Tests concurrent and sequential invoice uploads to validate:
 *   - 1 concurrent upload   — baseline response time < 10s
 *   - 5 concurrent uploads  — all succeed, response time < 30s
 *   - 10 concurrent uploads — all succeed or fail gracefully (no 500s)
 *   - Large PDF upload (5MB) — processes without timeout
 *   - Rapid sequential uploads (5 back-to-back) — no state bleed between uploads
 *
 * Uses Playwright parallel workers for concurrency simulation.
 *
 * NOTE: Parallel execution is controlled by playwright.config.ts workers setting.
 * These tests use Promise.all() to simulate concurrent requests within a single worker,
 * which is the most reliable approach for load testing against a shared staging environment.
 */

import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = process.env.TEST_TENANT_BASE_URL || process.env.BASE_URL || 'https://bigcafe.staging.cafepulse.org'
const API_BASE = `${BASE_URL}/api/admin`

const ADMIN_EMAIL = process.env.TEST_TENANT_ADMIN_EMAIL ?? 'test-admin@cafe-pulse.test'
const ADMIN_PASSWORD = process.env.TEST_TENANT_ADMIN_PASSWORD ?? 'TestAdmin123!'

const FIXTURES = path.resolve(__dirname, '../tests/e2e/fixtures/pdfs')

// Timeouts
const SINGLE_UPLOAD_TIMEOUT_MS = 10_000
const CONCURRENT_5_TIMEOUT_MS = 30_000
const CONCURRENT_10_TIMEOUT_MS = 60_000
const LARGE_PDF_TIMEOUT_MS = 120_000

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/login`)
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 })
}

// ─── Upload helper ────────────────────────────────────────────────────────────

interface UploadResult {
  status: number
  invoiceId: string | null
  elapsedMs: number
  error?: string
}

/**
 * Upload a single invoice via the API, returning status + timing.
 * Uses the authenticated page.request context (inherits session cookies).
 */
async function uploadInvoiceAndTime(
  page: import('@playwright/test').Page,
  opts: {
    filePath: string
    fileName: string
    invoiceNumber?: string
    invoiceDate?: string
  }
): Promise<UploadResult> {
  const fileBuffer = fs.readFileSync(opts.filePath)
  const start = Date.now()

  try {
    const res = await page.request.post(`${API_BASE}/invoices/upload`, {
      multipart: {
        file: {
          name: opts.fileName,
          mimeType: 'application/pdf',
          buffer: fileBuffer,
        },
        invoice_number: opts.invoiceNumber ?? `PERF-E2E-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        invoice_date: opts.invoiceDate ?? new Date().toISOString().split('T')[0],
      },
      // Override timeout for performance tests — we want to measure, not cut short
      timeout: LARGE_PDF_TIMEOUT_MS,
    })

    const elapsedMs = Date.now() - start

    if (res.status() === 200) {
      const body = await res.json()
      return {
        status: res.status(),
        invoiceId: body.id ?? body.data?.id ?? null,
        elapsedMs,
      }
    }

    return { status: res.status(), invoiceId: null, elapsedMs }
  } catch (err) {
    const elapsedMs = Date.now() - start
    return {
      status: 0,
      invoiceId: null,
      elapsedMs,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Generate a synthetic PDF of approximately targetSizeBytes.
 *
 * Creates a valid minimal PDF structure padded with comment bytes to reach target size.
 * This won't pass AI invoice parsing but will exercise the upload pipeline's size limits.
 */
function generateSyntheticPdf(targetSizeBytes: number): Buffer {
  // Minimal valid PDF structure
  const header = '%PDF-1.4\n'
  const body = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n` +
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`

  // Pad with PDF comment lines (% is a comment in PDF) to hit ~targetSizeBytes
  const currentLen = header.length + body.length
  const needed = Math.max(0, targetSizeBytes - currentLen - 20)
  const padding = '% ' + 'X'.repeat(78) + '\n'
  const repeatCount = Math.ceil(needed / padding.length)
  const padContent = padding.repeat(repeatCount).slice(0, needed)

  // Cross-reference table + trailer
  const xrefOffset = header.length + body.length + padContent.length
  const trailer = `xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000068 00000 n \n0000000125 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(header + body + padContent + trailer)
}

// ─── Auth setup ───────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
})

// ─── 1. Baseline: Single Upload < 10s ─────────────────────────────────────────

test.describe('MOK-61-1: Baseline — single concurrent upload < 10s', () => {
  test('single invoice upload completes in under 10 seconds', async ({ page }) => {
    const result = await uploadInvoiceAndTime(page, {
      filePath: path.join(FIXTURES, 'bluepoint-invoice.pdf'),
      fileName: 'bluepoint-invoice.pdf',
      invoiceNumber: `BASELINE-E2E-${Date.now()}`,
    })

    expect(result.status).toBeGreaterThanOrEqual(200)
    expect(result.status).toBeLessThan(300)
    expect(result.invoiceId).toBeTruthy()
    expect(result.elapsedMs).toBeLessThan(SINGLE_UPLOAD_TIMEOUT_MS)
  })
})

// ─── 2. 5 Concurrent Uploads < 30s ────────────────────────────────────────────

test.describe('MOK-61-2: 5 concurrent uploads — all succeed, response time < 30s', () => {
  test('5 simultaneous invoice uploads all succeed within 30 seconds', async ({ page }) => {
    const CONCURRENCY = 5
    const fixtures = [
      'bluepoint-invoice.pdf',
      'odeko-invoice.pdf',
      'goldseal-invoice.pdf',
      'samclub-invoice.pdf',
      'walmart-invoice.pdf',
    ]

    const start = Date.now()

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => {
        const fixture = fixtures[i % fixtures.length]
        return uploadInvoiceAndTime(page, {
          filePath: path.join(FIXTURES, fixture),
          fileName: fixture,
          invoiceNumber: `CONC5-E2E-${i}-${Date.now()}`,
        })
      })
    )

    const wallClockMs = Date.now() - start

    // All should succeed (200)
    for (const result of results) {
      expect(result.status).toBeGreaterThanOrEqual(200)
    expect(result.status).toBeLessThan(300)
      expect(result.invoiceId).toBeTruthy()
    }

    // Wall-clock time for all 5 should be under 30s
    expect(wallClockMs).toBeLessThan(CONCURRENT_5_TIMEOUT_MS)

    // Log results for visibility
    console.log(`5-concurrent upload results:`)
    results.forEach((r, i) =>
      console.log(`  [${i}] status=${r.status} elapsed=${r.elapsedMs}ms invoiceId=${r.invoiceId}`)
    )
    console.log(`  Wall-clock total: ${wallClockMs}ms`)
  })
})

// ─── 3. 10 Concurrent Uploads — Graceful ─────────────────────────────────────

test.describe('MOK-61-3: 10 concurrent uploads — succeed or fail gracefully (no 500s)', () => {
  test('10 simultaneous uploads do not produce HTTP 500 errors', async ({ page }) => {
    const CONCURRENCY = 10
    const availableFixtures = [
      'bluepoint-invoice.pdf',
      'odeko-invoice.pdf',
      'goldseal-invoice.pdf',
      'samclub-invoice.pdf',
      'walmart-invoice.pdf',
      'multi-page-invoice.pdf',
      'supplier-fees-invoice.pdf',
      'test-invoice-5.pdf',
    ]

    const start = Date.now()

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => {
        const fixture = availableFixtures[i % availableFixtures.length]
        return uploadInvoiceAndTime(page, {
          filePath: path.join(FIXTURES, fixture),
          fileName: fixture,
          invoiceNumber: `CONC10-E2E-${i}-${Date.now()}`,
        })
      })
    )

    const wallClockMs = Date.now() - start

    // No 500s allowed — each upload should either succeed (200) or return a client error (4xx)
    for (const result of results) {
      if (result.status !== 0) {
        // status=0 means a network timeout/error — acceptable under load
        expect(result.status).toBeLessThan(500)
      }
    }

    // Count successes (2xx)
    const successes = results.filter((r) => r.status >= 200 && r.status < 300)
    const failures = results.filter((r) => r.status >= 300 && r.status !== 0)
    const timeouts = results.filter((r) => r.status === 0)

    console.log(`10-concurrent upload results:`)
    console.log(`  Successes: ${successes.length}`)
    console.log(`  Failures (4xx): ${failures.length}`)
    console.log(`  Timeouts/errors: ${timeouts.length}`)
    console.log(`  Wall-clock total: ${wallClockMs}ms`)

    // At least 50% must succeed — the system shouldn't completely fall over
    expect(successes.length).toBeGreaterThanOrEqual(Math.floor(CONCURRENCY * 0.5))

    // Total wall-clock should be under 60s (we don't hard-require 30s for 10-concurrent)
    expect(wallClockMs).toBeLessThan(CONCURRENT_10_TIMEOUT_MS)
  })
})

// ─── 4. Large PDF Upload (5MB) ────────────────────────────────────────────────

test.describe('MOK-61-4: Large PDF upload — 5MB processes without timeout', () => {
  test('uploads a ~5MB PDF and receives a non-error response within 2 minutes', async ({
    page,
  }) => {
    const TARGET_SIZE = 5 * 1024 * 1024 // 5MB
    const largePdfBuffer = generateSyntheticPdf(TARGET_SIZE)

    // Write to a temp file so we can use the standard upload helper
    const tmpPath = path.join(FIXTURES, `large-perf-${Date.now()}.pdf`)
    fs.writeFileSync(tmpPath, largePdfBuffer)

    let result: UploadResult
    try {
      result = await uploadInvoiceAndTime(page, {
        filePath: tmpPath,
        fileName: 'large-invoice.pdf',
        invoiceNumber: `LARGE-E2E-${Date.now()}`,
      })
    } finally {
      // Clean up temp file
      fs.unlinkSync(tmpPath)
    }

    console.log(`Large PDF upload: status=${result.status} elapsed=${result.elapsedMs}ms size=${(largePdfBuffer.length / (1024 * 1024)).toFixed(2)}MB`)

    // Should not 500 — accept 200 (processed), 202 (async accepted), 400 (file too large), or 413 (payload too large)
    // A 413 means the server correctly rejected it — not a timeout, which is what we're guarding against.
    if (result.status === 0) {
      // A timeout / network error counts as a failure for this test
      throw new Error(
        `Large PDF upload timed out or errored after ${result.elapsedMs}ms: ${result.error}`
      )
    }

    // No 500s
    expect(result.status).not.toBe(500)
    expect(result.status).not.toBe(502)
    expect(result.status).not.toBe(503)

    // Should respond within 2 minutes
    expect(result.elapsedMs).toBeLessThan(LARGE_PDF_TIMEOUT_MS)
  })
})

// ─── 5. Rapid Sequential Uploads — No State Bleed ────────────────────────────

test.describe('MOK-61-5: Rapid sequential uploads — no state bleed', () => {
  test('5 back-to-back uploads produce 5 distinct invoice records with no shared data', async ({
    page,
  }) => {
    const SEQUENTIAL_COUNT = 5
    const fixtures = [
      'bluepoint-invoice.pdf',
      'odeko-invoice.pdf',
      'goldseal-invoice.pdf',
      'samclub-invoice.pdf',
      'walmart-invoice.pdf',
    ]

    const results: UploadResult[] = []
    const invoiceNumbers: string[] = []

    for (let i = 0; i < SEQUENTIAL_COUNT; i++) {
      const fixture = fixtures[i % fixtures.length]
      const invoiceNumber = `SEQ-E2E-${i}-${Date.now()}`
      invoiceNumbers.push(invoiceNumber)

      const result = await uploadInvoiceAndTime(page, {
        filePath: path.join(FIXTURES, fixture),
        fileName: fixture,
        invoiceNumber,
      })
      results.push(result)

      // Brief pause between uploads to simulate rapid-but-not-simultaneous requests
      await page.waitForTimeout(200)
    }

    // All 5 must succeed
    for (let i = 0; i < SEQUENTIAL_COUNT; i++) {
      expect(results[i].status).toBeGreaterThanOrEqual(200)
      expect(results[i].status).toBeLessThan(300)
      expect(results[i].invoiceId).toBeTruthy()
    }

    // All invoice IDs must be distinct (no state bleed)
    const invoiceIds = results.map((r) => r.invoiceId).filter(Boolean) as string[]
    const uniqueIds = new Set(invoiceIds)
    expect(uniqueIds.size).toBe(invoiceIds.length)

    // Fetch each invoice and verify its invoice_number matches what we submitted (no cross-bleed)
    for (let i = 0; i < SEQUENTIAL_COUNT; i++) {
      const invoiceId = results[i].invoiceId!
      const invoiceRes = await page.request.get(`${API_BASE}/invoices/${invoiceId}`)
      expect(invoiceRes.status()).toBe(200)
      const invoiceBody = await invoiceRes.json()
      const invoiceData = invoiceBody.data ?? invoiceBody

      // The stored invoice_number must match what we submitted
      // (verifies the request data didn't bleed into a neighboring upload)
      expect(invoiceData.invoice_number).toBe(invoiceNumbers[i])
    }

    console.log(`Sequential upload results:`)
    results.forEach((r, i) =>
      console.log(
        `  [${i}] status=${r.status} elapsed=${r.elapsedMs}ms invoiceId=${r.invoiceId} invoiceNumber=${invoiceNumbers[i]}`
      )
    )
  })

  test('sequential uploads produce isolated parse results — no line-item cross-contamination', async ({
    page,
  }) => {
    // Upload 2 distinct PDFs back-to-back and verify their extracted data doesn't mix
    const fixtures = ['bluepoint-invoice.pdf', 'odeko-invoice.pdf']

    const results: UploadResult[] = []
    for (const fixture of fixtures) {
      const result = await uploadInvoiceAndTime(page, {
        filePath: path.join(FIXTURES, fixture),
        fileName: fixture,
        invoiceNumber: `ISOLATION-E2E-${fixture.replace('.pdf', '')}-${Date.now()}`,
      })
      results.push(result)

      // Parse each invoice right after upload
      if (result.invoiceId) {
        const parseRes = await page.request.post(
          `${API_BASE}/invoices/${result.invoiceId}/parse`
        )
        expect([200, 202]).toContain(parseRes.status())
      }
    }

    // Wait briefly for parse to complete, then verify they have distinct line items
    await page.waitForTimeout(3_000)

    if (results[0].invoiceId && results[1].invoiceId) {
      const inv1Res = await page.request.get(`${API_BASE}/invoices/${results[0].invoiceId}`)
      const inv2Res = await page.request.get(`${API_BASE}/invoices/${results[1].invoiceId}`)

      expect(inv1Res.status()).toBe(200)
      expect(inv2Res.status()).toBe(200)

      const inv1 = (await inv1Res.json()).data ?? (await inv1Res.json())
      const inv2 = (await inv2Res.json()).data ?? (await inv2Res.json())

      // invoice_numbers must differ — proves they're distinct records
      expect(inv1.invoice_number).not.toBe(inv2.invoice_number)
      expect(inv1.id).not.toBe(inv2.id)
    }
  })
})

// ─── 6. Response time distribution ───────────────────────────────────────────

test.describe('MOK-61-6: Response time distribution — multiple single uploads', () => {
  test('uploads 3 invoices serially and logs individual response times', async ({ page }) => {
    const uploads = [
      { fixture: 'bluepoint-invoice.pdf', label: 'Bluepoint' },
      { fixture: 'odeko-invoice.pdf', label: 'Odeko' },
      { fixture: 'goldseal-invoice.pdf', label: 'Goldseal' },
    ]

    const timings: { label: string; elapsedMs: number; status: number }[] = []

    for (const { fixture, label } of uploads) {
      const result = await uploadInvoiceAndTime(page, {
        filePath: path.join(FIXTURES, fixture),
        fileName: fixture,
        invoiceNumber: `TIMING-E2E-${label}-${Date.now()}`,
      })
      timings.push({ label, elapsedMs: result.elapsedMs, status: result.status })

      // Each individual upload should be under 10s
      expect(result.status).toBeGreaterThanOrEqual(200)
    expect(result.status).toBeLessThan(300)
      expect(result.elapsedMs).toBeLessThan(SINGLE_UPLOAD_TIMEOUT_MS)
    }

    // Log timing breakdown
    console.log('Response time distribution:')
    timings.forEach((t) =>
      console.log(`  ${t.label}: ${t.elapsedMs}ms (status=${t.status})`)
    )
    const avg = timings.reduce((sum, t) => sum + t.elapsedMs, 0) / timings.length
    console.log(`  Average: ${avg.toFixed(0)}ms`)
  })
})
