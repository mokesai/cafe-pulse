/**
 * MOK-169 — classifyPriceVariance decides whether a non-zero price variance creates a per-line
 * exception (above threshold) or is a minor change that only gets recorded for a per-invoice
 * FYI count (at or below threshold). Sub-threshold variances no longer flood the exception queue.
 *
 * Run: deno test __tests__/04-classify-price-variance.test.ts --allow-env --allow-net
 */
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'

import { classifyPriceVariance } from '../stages/04-match-items.ts'

Deno.test('classifyPriceVariance — sub-threshold variance is info and creates no exception', () => {
  const result = classifyPriceVariance(3, 10)
  assertEquals(result.severity, 'info')
  assertEquals(result.createsException, false)
})

Deno.test('classifyPriceVariance — exactly at threshold is info (not >) and creates no exception', () => {
  const result = classifyPriceVariance(10, 10)
  assertEquals(result.severity, 'info')
  assertEquals(result.createsException, false)
})

Deno.test('classifyPriceVariance — above threshold is block and creates an exception', () => {
  const result = classifyPriceVariance(12.5, 10)
  assertEquals(result.severity, 'block')
  assertEquals(result.createsException, true)
})

Deno.test('classifyPriceVariance — just above threshold still blocks', () => {
  const result = classifyPriceVariance(10.01, 10)
  assertEquals(result.severity, 'block')
  assertEquals(result.createsException, true)
})
