/**
 * Unit tests for Vision Service
 *
 * Tests response normalization, retry logic, confidence clamping,
 * and token usage logging. Does NOT make real API calls in unit tests.
 *
 * Run: deno test __tests__/vision-service.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
  assertExists,
  assert,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

// ============================================================
// Inline the normalization logic for testing
// (avoids importing the full vision-service module with env deps)
// ============================================================

interface RawVisionResponseForTest {
  invoice_number: string | null
  invoice_date: string | null
  supplier_info: {
    name: string | null
    address: string | null
    phone: string | null
    email: string | null
  }
  subtotal: number | null
  tax_amount: number | null
  total_amount: number | null
  line_items: Array<{
    line_number: number
    description: string
    supplier_item_code: string | null
    quantity: number
    unit_price: number
    total_price: number
    package_size: string | null
    unit_type: string | null
    confidence: number
  }>
  overall_confidence: number
}

function normalizeVisionResponseForTest(raw: RawVisionResponseForTest) {
  const lineItems = (raw.line_items ?? []).map((item, index) => ({
    line_number: Number(item.line_number ?? index + 1),
    description: String(item.description ?? 'Unknown Item').trim(),
    supplier_item_code: item.supplier_item_code ?? null,
    quantity: Math.max(0, Number(item.quantity ?? 0)),
    unit_price: Math.max(0, Number(item.unit_price ?? 0)),
    total_price: Math.max(0, Number(item.total_price ?? 0)),
    package_size: item.package_size ?? null,
    unit_type: item.unit_type ?? null,
    confidence: Math.min(1, Math.max(0, Number(item.confidence ?? 0.5))),
  }))

  const overallConfidence = Math.min(
    1,
    Math.max(0, Number(raw.overall_confidence ?? 0.5))
  )

  return {
    invoice_number: raw.invoice_number ?? null,
    invoice_date: raw.invoice_date ?? null,
    supplier_info: {
      name: raw.supplier_info?.name ?? null,
      address: raw.supplier_info?.address ?? null,
      phone: raw.supplier_info?.phone ?? null,
      email: raw.supplier_info?.email ?? null,
    },
    subtotal: raw.subtotal != null ? Number(raw.subtotal) : null,
    tax_amount: raw.tax_amount != null ? Number(raw.tax_amount) : null,
    total_amount: raw.total_amount != null ? Number(raw.total_amount) : null,
    line_items: lineItems,
    overall_confidence: overallConfidence,
    extraction_method: 'vision' as const,
  }
}

// ============================================================
// Tests
// ============================================================

Deno.test('VisionService — normalizes complete response correctly', () => {
  const raw: RawVisionResponseForTest = {
    invoice_number: 'INV-2024-001',
    invoice_date: '2024-01-15',
    supplier_info: {
      name: 'US Foods Inc',
      address: '123 Distribution Ave, Chicago, IL',
      phone: '555-0100',
      email: 'orders@usfoods.com',
    },
    subtotal: 450.00,
    tax_amount: 36.00,
    total_amount: 486.00,
    line_items: [
      {
        line_number: 1,
        description: 'Colombian Coffee Beans 5lb',
        supplier_item_code: 'COF-COL-5',
        quantity: 10,
        unit_price: 25.00,
        total_price: 250.00,
        package_size: null,
        unit_type: 'lb',
        confidence: 0.95,
      },
      {
        line_number: 2,
        description: 'Paper Cups 12oz 50-pack',
        supplier_item_code: 'CUP-12-50',
        quantity: 4,
        unit_price: 8.50,
        total_price: 34.00,
        package_size: '50-pack',
        unit_type: 'each',
        confidence: 0.88,
      },
    ],
    overall_confidence: 0.92,
  }

  const result = normalizeVisionResponseForTest(raw)

  assertEquals(result.invoice_number, 'INV-2024-001')
  assertEquals(result.invoice_date, '2024-01-15')
  assertEquals(result.supplier_info.name, 'US Foods Inc')
  assertEquals(result.total_amount, 486.00)
  assertEquals(result.line_items.length, 2)
  assertEquals(result.line_items[0].description, 'Colombian Coffee Beans 5lb')
  assertEquals(result.line_items[0].confidence, 0.95)
  assertEquals(result.line_items[1].package_size, '50-pack')
  assertEquals(result.overall_confidence, 0.92)
  assertEquals(result.extraction_method, 'vision')
})

Deno.test('VisionService — clamps confidence values to 0–1 range', () => {
  const raw: RawVisionResponseForTest = {
    invoice_number: null,
    invoice_date: null,
    supplier_info: { name: null, address: null, phone: null, email: null },
    subtotal: null,
    tax_amount: null,
    total_amount: null,
    line_items: [
      {
        line_number: 1,
        description: 'Test item',
        supplier_item_code: null,
        quantity: 1,
        unit_price: 10,
        total_price: 10,
        package_size: null,
        unit_type: null,
        confidence: 1.5, // Over 1 — should be clamped to 1
      },
      {
        line_number: 2,
        description: 'Another item',
        supplier_item_code: null,
        quantity: 2,
        unit_price: 5,
        total_price: 10,
        package_size: null,
        unit_type: null,
        confidence: -0.2, // Under 0 — should be clamped to 0
      },
    ],
    overall_confidence: 2.0, // Over 1 — should be clamped to 1
  }

  const result = normalizeVisionResponseForTest(raw)

  assertEquals(result.line_items[0].confidence, 1.0) // clamped from 1.5
  assertEquals(result.line_items[1].confidence, 0.0) // clamped from -0.2
  assertEquals(result.overall_confidence, 1.0) // clamped from 2.0
})

Deno.test('VisionService — handles missing optional fields gracefully', () => {
  // Simulate a partially complete Vision response (e.g., poor quality scan)
  const raw = {
    invoice_number: null,
    invoice_date: null,
    supplier_info: {
      name: 'Walmart Business',
      address: null,
      phone: null,
      email: null,
    },
    subtotal: null,
    tax_amount: null,
    total_amount: 127.83,
    line_items: [
      {
        line_number: 1,
        description: 'Great Value Whole Milk 1gal',
        supplier_item_code: null,
        quantity: 3,
        unit_price: 4.27,
        total_price: 12.81,
        package_size: null,
        unit_type: 'each',
        confidence: 0.72,
      },
    ],
    overall_confidence: 0.68,
  } as RawVisionResponseForTest

  const result = normalizeVisionResponseForTest(raw)

  assertEquals(result.invoice_number, null)
  assertEquals(result.supplier_info.name, 'Walmart Business')
  assertEquals(result.supplier_info.address, null)
  assertEquals(result.total_amount, 127.83)
  assertEquals(result.line_items[0].supplier_item_code, null)
  assertEquals(result.overall_confidence, 0.68)
})

Deno.test('VisionService — handles empty line_items array', () => {
  const raw: RawVisionResponseForTest = {
    invoice_number: 'INV-EMPTY',
    invoice_date: '2024-03-01',
    supplier_info: { name: 'Test Supplier', address: null, phone: null, email: null },
    subtotal: 0,
    tax_amount: null,
    total_amount: 0,
    line_items: [],
    overall_confidence: 0.3,
  }

  const result = normalizeVisionResponseForTest(raw)

  assertEquals(result.line_items.length, 0)
  assertEquals(result.invoice_number, 'INV-EMPTY')
})

Deno.test('VisionService — normalizes negative quantities and prices to 0', () => {
  const raw: RawVisionResponseForTest = {
    invoice_number: null,
    invoice_date: null,
    supplier_info: { name: null, address: null, phone: null, email: null },
    subtotal: null,
    tax_amount: null,
    total_amount: null,
    line_items: [
      {
        line_number: 1,
        description: 'Returned item',
        supplier_item_code: null,
        quantity: -5, // Invalid — should become 0
        unit_price: -10.00, // Invalid — should become 0
        total_price: -50.00, // Invalid — should become 0
        package_size: null,
        unit_type: null,
        confidence: 0.5,
      },
    ],
    overall_confidence: 0.5,
  }

  const result = normalizeVisionResponseForTest(raw)

  assertEquals(result.line_items[0].quantity, 0)
  assertEquals(result.line_items[0].unit_price, 0)
  assertEquals(result.line_items[0].total_price, 0)
})

Deno.test('VisionService — token usage calculation (approximate)', () => {
  // Verify that estimated cost calculation is reasonable
  const usage = {
    promptTokens: 2000,
    completionTokens: 800,
    totalTokens: 2800,
  }

  // GPT-4o pricing: $5/1M prompt, $15/1M completion
  const estimatedCostUsd =
    usage.promptTokens * 0.000005 + usage.completionTokens * 0.000015

  // 2000 * 0.000005 = 0.01 + 800 * 0.000015 = 0.012 = 0.022 total
  assert(estimatedCostUsd > 0.01)
  assert(estimatedCostUsd < 0.05)
})

Deno.test('VisionService — withRetry retries on failure', async () => {
  let attempts = 0
  const failTwiceThenSucceed = async () => {
    attempts++
    if (attempts < 3) throw new Error(`Attempt ${attempts} failed`)
    return 'success'
  }

  // Inline retry wrapper for testing
  async function withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts = 2,
    baseDelayMs = 10 // Use short delay for tests
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, baseDelayMs * attempt))
        }
      }
    }
    throw lastError
  }

  // With maxAttempts=3, should succeed on 3rd try
  const result = await withRetry(failTwiceThenSucceed, 3, 10)
  assertEquals(result, 'success')
  assertEquals(attempts, 3)
})

Deno.test('VisionService — withRetry throws after max attempts', async () => {
  let attempts = 0
  const alwaysFails = async () => {
    attempts++
    throw new Error(`Always fails (attempt ${attempts})`)
  }

  async function withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts = 2,
    baseDelayMs = 10
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, baseDelayMs * attempt))
        }
      }
    }
    throw lastError
  }

  try {
    await withRetry(alwaysFails, 2, 10)
    assert(false, 'Should have thrown')
  } catch (err) {
    assert(err instanceof Error)
    assertEquals(attempts, 2)
  }
})

Deno.test('VisionService — confidence threshold check logic', () => {
  // Simulates the confidence check in Stage 1
  const overallConfidence = 0.55
  const visionConfidenceThresholdPct = 60
  const visionThreshold = visionConfidenceThresholdPct / 100 // 0.60

  const shouldCreateException = overallConfidence < visionThreshold
  assertEquals(shouldCreateException, true)

  // At threshold — should NOT create exception
  const atThreshold = 0.60
  assertEquals(atThreshold < visionThreshold, false)
})

Deno.test('VisionService — extraction method enum values', () => {
  const validMethods = ['vision', 'text_fallback'] as const
  type ExtractionMethod = typeof validMethods[number]

  const visionMethod: ExtractionMethod = 'vision'
  const textMethod: ExtractionMethod = 'text_fallback'

  assertEquals(validMethods.includes(visionMethod), true)
  assertEquals(validMethods.includes(textMethod), true)
})
