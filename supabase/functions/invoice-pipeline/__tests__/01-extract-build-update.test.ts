/**
 * MOK-132 — buildInvoiceHeaderUpdate skips null/empty extracted fields.
 *
 * The upload route writes a non-null placeholder `invoice_number` (e.g.
 * `${PO_number}-N`). Vision's Stage 1 used to UPDATE invoice_number=null
 * when the model couldn't extract a real number, tripping the NOT NULL
 * constraint and crashing the pipeline. The fix: only write the column
 * if Vision returned something meaningful, otherwise let the placeholder
 * persist.
 *
 * Run: deno test __tests__/01-extract-build-update.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
  assertExists,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

import { buildInvoiceHeaderUpdate } from '../stages/01-extract.ts'
import type { ParsedInvoiceResult } from '../context.ts'

function makeParsed(overrides: Partial<ParsedInvoiceResult> = {}): ParsedInvoiceResult {
  return {
    invoice_number: null,
    invoice_date: null,
    supplier_info: { name: null, address: null, phone: null, email: null },
    subtotal: null,
    tax_amount: null,
    total_amount: null,
    supplier_fees: { delivery: 0, shipping: 0, processing: 0, other: 0 },
    total_fees: 0,
    line_items: [],
    overall_confidence: 0.5,
    extraction_method: 'vision',
    ...overrides,
  }
}

Deno.test('buildInvoiceHeaderUpdate — happy path: writes everything Vision extracted', () => {
  const parsed = makeParsed({
    invoice_number: 'INV-7842847',
    invoice_date: '2026-04-09',
    total_amount: 247.5,
    total_fees: 12.0,
    supplier_fees: { delivery: 12.0, shipping: 0, processing: 0, other: 0 },
  })

  const updates = buildInvoiceHeaderUpdate(parsed, 0.92, 'extracting')

  assertEquals(updates.invoice_number, 'INV-7842847')
  assertEquals(updates.invoice_date, '2026-04-09')
  assertEquals(updates.total_amount, 247.5)
  assertEquals(updates.vision_confidence, 0.92)
  assertEquals(updates.pipeline_stage, 'extracting')
  assertEquals(updates.fee_source, 'ai_extracted')
  assertEquals(updates.total_fees, 12.0)
  assertExists(updates.supplier_fees)
})

Deno.test('buildInvoiceHeaderUpdate — null invoice_number is omitted (preserves placeholder)', () => {
  const parsed = makeParsed({
    invoice_number: null,
    invoice_date: '2026-04-09',
    total_amount: 247.5,
  })

  const updates = buildInvoiceHeaderUpdate(parsed, 0.7, 'extracting')

  // The key bug: Vision returns null for invoice_number on hard-to-read PDFs.
  // We must NOT include invoice_number in the UPDATE so the placeholder
  // survives and the NOT NULL constraint isn't tripped.
  assertEquals('invoice_number' in updates, false)
  // Other fields with real values still write
  assertEquals(updates.invoice_date, '2026-04-09')
  assertEquals(updates.total_amount, 247.5)
})

Deno.test('buildInvoiceHeaderUpdate — empty-string invoice_number is omitted', () => {
  const parsed = makeParsed({ invoice_number: '   ' })
  const updates = buildInvoiceHeaderUpdate(parsed, 0.7, 'extracting')
  assertEquals('invoice_number' in updates, false)
})

Deno.test('buildInvoiceHeaderUpdate — null invoice_date is omitted', () => {
  const parsed = makeParsed({
    invoice_number: 'INV-1',
    invoice_date: null,
  })
  const updates = buildInvoiceHeaderUpdate(parsed, 0.7, 'extracting')
  assertEquals('invoice_date' in updates, false)
  assertEquals(updates.invoice_number, 'INV-1')
})

Deno.test('buildInvoiceHeaderUpdate — null total_amount is omitted', () => {
  const parsed = makeParsed({
    invoice_number: 'INV-1',
    total_amount: null,
  })
  const updates = buildInvoiceHeaderUpdate(parsed, 0.7, 'extracting')
  assertEquals('total_amount' in updates, false)
})

Deno.test('buildInvoiceHeaderUpdate — total_amount=0 IS written (legitimate value)', () => {
  // 0 is distinct from null — a legitimately empty invoice (e.g., credit memo)
  // should write 0 rather than retain a stale upload-time value.
  const parsed = makeParsed({ total_amount: 0 })
  const updates = buildInvoiceHeaderUpdate(parsed, 0.7, 'extracting')
  assertEquals(updates.total_amount, 0)
})

Deno.test('buildInvoiceHeaderUpdate — fees only written when total_fees > 0', () => {
  const noFees = buildInvoiceHeaderUpdate(makeParsed({ total_fees: 0 }), 0.7, 'extracting')
  assertEquals('supplier_fees' in noFees, false)
  assertEquals('total_fees' in noFees, false)
  assertEquals('fee_source' in noFees, false)

  const withFees = buildInvoiceHeaderUpdate(
    makeParsed({
      total_fees: 5.99,
      supplier_fees: { delivery: 5.99, shipping: 0, processing: 0, other: 0 },
    }),
    0.7,
    'extracting',
  )
  assertEquals(withFees.total_fees, 5.99)
  assertEquals(withFees.fee_source, 'ai_extracted')
  assertExists(withFees.supplier_fees)
})

Deno.test('buildInvoiceHeaderUpdate — vision_confidence and pipeline_stage are always written', () => {
  // These are pipeline-internal bookkeeping; they should never be omitted
  // even when every extracted field is null.
  const updates = buildInvoiceHeaderUpdate(makeParsed(), 0.0, 'extracting')
  assertEquals(updates.vision_confidence, 0.0)
  assertEquals(updates.pipeline_stage, 'extracting')
  // Sanity: nothing else got through
  assertEquals(Object.keys(updates).length, 2)
})
