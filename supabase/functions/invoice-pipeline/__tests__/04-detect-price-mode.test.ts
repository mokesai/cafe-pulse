/**
 * MOK-133 — detectPriceMode picks per-unit vs per-pack pricing by minimal variance.
 *
 * Stage 4 used to compare invoice unit_price directly against
 * inventory.unit_cost. For pack-priced items (bakery 4-packs, beverage cases)
 * that mis-fired as +312% / +499% / +N00% variances on every line. The fix:
 * compare against both unit_cost and unit_cost*pack_size (the implied pack
 * price); pick whichever interpretation is closer to the invoice.
 *
 * Run: deno test __tests__/04-detect-price-mode.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
  assertAlmostEquals,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

import { detectPriceMode } from '../stages/04-match-items.ts'

Deno.test('detectPriceMode — per-pack match: bakery 4-pack at exactly the pack price', () => {
  // Real-world repro from 2026-04-26: Croissant 3oz 4pk, unit_cost=$1.55,
  // invoice line "Butter Croissant @ $6.19" (≈ pack of 4 × $1.5475)
  const result = detectPriceMode(6.19, 1.55, 4)

  assertEquals(result.mode, 'per_pack')
  assertEquals(result.packSize, 4)
  assertAlmostEquals(result.comparatorCost, 6.20, 0.001) // unit_cost × pack_size
  assertAlmostEquals(result.variancePct, 0.161, 0.01) // |6.19 - 6.20| / 6.20 * 100
  assertAlmostEquals(result.effectiveUnitPrice, 1.5475, 0.0001)
})

Deno.test('detectPriceMode — per-unit match: invoice ships individuals at the unit price', () => {
  const result = detectPriceMode(1.55, 1.55, 4)

  assertEquals(result.mode, 'per_unit')
  assertEquals(result.comparatorCost, 1.55)
  assertEquals(result.variancePct, 0)
  assertEquals(result.effectiveUnitPrice, 1.55)
})

Deno.test('detectPriceMode — pack_size=1: always per_unit, no pack interpretation possible', () => {
  const result = detectPriceMode(2.5, 2.0, 1)

  assertEquals(result.mode, 'per_unit')
  assertEquals(result.comparatorCost, 2.0)
  assertAlmostEquals(result.variancePct, 25, 0.01) // (2.5 - 2.0) / 2.0 * 100
})

Deno.test('detectPriceMode — real per-unit price change still detected on packed items', () => {
  // Inventory: pack_size=4, unit_cost=$1.55. Invoice prices per-unit at $1.85
  // (real ~+19% increase). Per-pack interpretation: $1.85 vs $6.20 = -70%
  // variance — a much worse fit. Should pick per_unit.
  const result = detectPriceMode(1.85, 1.55, 4)

  assertEquals(result.mode, 'per_unit')
  assertEquals(result.comparatorCost, 1.55)
  assertAlmostEquals(result.variancePct, 19.355, 0.01)
})

Deno.test('detectPriceMode — real per-pack price change still detected', () => {
  // Inventory: pack_size=6, unit_cost=$1.59 (pack_cost=$9.54). Invoice
  // prices per-pack at $11.00 (real ~+15% pack increase). Per-unit
  // interpretation: $11.00 vs $1.59 = +591% variance. Should pick per_pack
  // and report the modest 15% change.
  const result = detectPriceMode(11.0, 1.59, 6)

  assertEquals(result.mode, 'per_pack')
  assertEquals(result.packSize, 6)
  assertAlmostEquals(result.comparatorCost, 9.54, 0.001)
  assertAlmostEquals(result.variancePct, 15.3, 0.1)
})

Deno.test('detectPriceMode — exactly equidistant: tie goes to per_unit', () => {
  // unit_cost=$2, pack_size=4, pack_cost=$8. Invoice unit_price=$5 sits
  // exactly between $2 and $8. variancePerUnit = 150%, variancePerPack
  // = 37.5%. Per-pack wins because it's strictly closer.
  const equidistantResult = detectPriceMode(5, 2, 4)
  assertEquals(equidistantResult.mode, 'per_pack')

  // True tie: unit_cost=$5, pack_size=2, pack_cost=$10. Invoice $7.50.
  // variancePerUnit = 50%, variancePerPack = 25%. Per-pack wins.
  const tieResult = detectPriceMode(7.5, 5, 2)
  assertEquals(tieResult.mode, 'per_pack')

  // Construct an exact tie. unit_cost=$2, pack_size=2, pack_cost=$4.
  // Invoice $3 — variancePerUnit = 50%, variancePerPack = 25%. NOT a tie.
  // To make a true tie we need invoice = (unit + pack)/2 such that the
  // ratios are equal: (m - u)/u = (p - m)/p → m = 2up/(u+p).
  // u=2, p=4: m = 16/6 = 2.667. Both variances = 33.3%.
  const trueTieInvoice = (2 * 2 * 4) / (2 + 4)
  const tieExact = detectPriceMode(trueTieInvoice, 2, 2)
  // When variancePerPack < variancePerUnit is false (equal), we keep per_unit.
  assertEquals(tieExact.mode, 'per_unit')
})

Deno.test('detectPriceMode — zero unit_cost: forced to per_unit, zero variance', () => {
  const result = detectPriceMode(5.99, 0, 4)

  assertEquals(result.mode, 'per_unit')
  assertEquals(result.variancePct, 0)
  assertEquals(result.comparatorCost, 0)
})

Deno.test('detectPriceMode — pack_size of 0 or negative is normalized to 1', () => {
  const zero = detectPriceMode(2.0, 1.5, 0)
  assertEquals(zero.packSize, 1)
  assertEquals(zero.mode, 'per_unit')

  const negative = detectPriceMode(2.0, 1.5, -3)
  assertEquals(negative.packSize, 1)
  assertEquals(negative.mode, 'per_unit')
})

Deno.test('detectPriceMode — large pack (12-case beverages)', () => {
  // Inventory: pack_size=12, unit_cost=$0.85, pack_cost=$10.20.
  // Invoice line "Sparkling water 12-pack @ $10.30" — per_pack with tiny variance.
  const result = detectPriceMode(10.3, 0.85, 12)
  assertEquals(result.mode, 'per_pack')
  assertEquals(result.packSize, 12)
  assertAlmostEquals(result.variancePct, 0.98, 0.05)
})
