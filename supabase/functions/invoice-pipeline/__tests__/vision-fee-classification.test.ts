/**
 * MOK-129 — fee-row classification + extraction.
 *
 * Vision occasionally returns fee rows ("Delivery Fee", "Shipping", etc.) in
 * `line_items` instead of `supplier_fees`. Pre-MOK-129 those rows leaked into
 * `invoice_items` and stage 4 raised a no_item_match exception trying to
 * match them against inventory. Now we reclassify fee-shaped rows in
 * `normalizeVisionResponse` before downstream consumers see them.
 *
 * Run: deno test __tests__/vision-fee-classification.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

import {
  classifyFeeLineItem,
  extractFeesFromLineItems,
} from '../vision-service.ts'

// ─────────────────────────────────────────────────────────────────────────────
// classifyFeeLineItem
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('classifyFeeLineItem — Delivery patterns route to delivery', () => {
  assertEquals(classifyFeeLineItem('Delivery Fee'), 'delivery')
  assertEquals(classifyFeeLineItem('delivery'), 'delivery')
  assertEquals(classifyFeeLineItem('Delivery charge'), 'delivery')
  assertEquals(classifyFeeLineItem('Fuel Surcharge'), 'delivery')
  assertEquals(classifyFeeLineItem('FUEL SURCHARGE'), 'delivery')
  assertEquals(classifyFeeLineItem('Drop Fee'), 'delivery')
})

Deno.test('classifyFeeLineItem — Shipping patterns route to shipping', () => {
  assertEquals(classifyFeeLineItem('Shipping'), 'shipping')
  assertEquals(classifyFeeLineItem('Freight'), 'shipping')
  assertEquals(classifyFeeLineItem('Postage'), 'shipping')
})

Deno.test('classifyFeeLineItem — Processing/service patterns route to processing', () => {
  assertEquals(classifyFeeLineItem('Service Fee'), 'processing')
  assertEquals(classifyFeeLineItem('Processing Fee'), 'processing')
  assertEquals(classifyFeeLineItem('Convenience Fee'), 'processing')
  assertEquals(classifyFeeLineItem('Handling Fee'), 'processing')
  assertEquals(classifyFeeLineItem('Transaction Fee'), 'processing')
})

Deno.test('classifyFeeLineItem — non-fee descriptions return null', () => {
  assertEquals(classifyFeeLineItem('Croissant 4pk'), null)
  assertEquals(classifyFeeLineItem('Loaf bread'), null)
  assertEquals(classifyFeeLineItem('Espresso beans 12oz'), null)
  // Hypothetical: a real product whose name starts with a fee word should
  // not match — patterns require a word boundary, but a product like
  // "Delivery Hot Sauce" would still match. Document the false positive.
  // For now, this is a tradeoff we accept; if it surfaces in prod, we'll
  // tighten with a presence-of-fee-word-AND-low-line-total heuristic.
})

Deno.test('classifyFeeLineItem — empty/whitespace inputs return null', () => {
  assertEquals(classifyFeeLineItem(''), null)
  assertEquals(classifyFeeLineItem('   '), null)
})

Deno.test('classifyFeeLineItem — leading/trailing whitespace is tolerated', () => {
  assertEquals(classifyFeeLineItem('  Delivery Fee  '), 'delivery')
})

// ─────────────────────────────────────────────────────────────────────────────
// extractFeesFromLineItems
// ─────────────────────────────────────────────────────────────────────────────

interface MakeItemOpts {
  description: string
  total_price?: number
}
function makeItem(opts: MakeItemOpts) {
  return {
    line_number: 1,
    description: opts.description,
    supplier_item_code: null,
    quantity: 1,
    unit_price: opts.total_price ?? 0,
    total_price: opts.total_price ?? 0,
    package_size: null,
    unit_type: null,
    confidence: 0.9,
  }
}

Deno.test('extractFeesFromLineItems — partitions a Delivery Fee row out', () => {
  const items = [
    makeItem({ description: 'Croissant 4pk', total_price: 24.0 }),
    makeItem({ description: 'Delivery Fee', total_price: 5.99 }),
    makeItem({ description: 'Bagel 6pk', total_price: 18.0 }),
  ]
  const result = extractFeesFromLineItems(items)
  assertEquals(result.cleanedLineItems.length, 2)
  assertEquals(result.cleanedLineItems[0].description, 'Croissant 4pk')
  assertEquals(result.cleanedLineItems[1].description, 'Bagel 6pk')
  assertEquals(result.reclassifiedFees.delivery, 5.99)
  assertEquals(result.reclassifiedFees.shipping, 0)
  assertEquals(result.reclassifiedFees.processing, 0)
  assertEquals(result.reclassifiedFees.other, 0)
  assertEquals(result.reclassifiedDescriptions, ['Delivery Fee'])
})

Deno.test('extractFeesFromLineItems — sums multiple fees in the same bucket', () => {
  const items = [
    makeItem({ description: 'Delivery', total_price: 4.50 }),
    makeItem({ description: 'Fuel Surcharge', total_price: 1.25 }),
  ]
  const result = extractFeesFromLineItems(items)
  assertEquals(result.cleanedLineItems.length, 0)
  assertEquals(result.reclassifiedFees.delivery, 5.75)
})

Deno.test('extractFeesFromLineItems — routes fees to correct buckets', () => {
  const items = [
    makeItem({ description: 'Delivery Fee', total_price: 5 }),
    makeItem({ description: 'Shipping', total_price: 10 }),
    makeItem({ description: 'Service Fee', total_price: 2 }),
  ]
  const result = extractFeesFromLineItems(items)
  assertEquals(result.cleanedLineItems.length, 0)
  assertEquals(result.reclassifiedFees, {
    delivery: 5,
    shipping: 10,
    processing: 2,
    other: 0,
  })
})

Deno.test('extractFeesFromLineItems — no fees: line items pass through untouched', () => {
  const items = [
    makeItem({ description: 'Croissant 4pk', total_price: 24.0 }),
    makeItem({ description: 'Bagel 6pk', total_price: 18.0 }),
  ]
  const result = extractFeesFromLineItems(items)
  assertEquals(result.cleanedLineItems.length, 2)
  assertEquals(result.reclassifiedFees, { delivery: 0, shipping: 0, processing: 0, other: 0 })
  assertEquals(result.reclassifiedDescriptions.length, 0)
})

Deno.test('extractFeesFromLineItems — negative total_price is clamped to 0 (defensive)', () => {
  const items = [
    makeItem({ description: 'Delivery Fee', total_price: -5 }),
  ]
  const result = extractFeesFromLineItems(items)
  assertEquals(result.reclassifiedFees.delivery, 0)
})

Deno.test('extractFeesFromLineItems — empty input returns empty result', () => {
  const result = extractFeesFromLineItems([])
  assertEquals(result.cleanedLineItems.length, 0)
  assertEquals(result.reclassifiedFees, { delivery: 0, shipping: 0, processing: 0, other: 0 })
  assertEquals(result.reclassifiedDescriptions.length, 0)
})
