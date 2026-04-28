/**
 * MOK-133 — pack-aware price-mode detection (vitest mirror).
 *
 * The pipeline edge function ships a `detectPriceMode` helper in
 * `supabase/functions/invoice-pipeline/stages/04-match-items.ts`. That
 * helper runs in Deno and is covered by `__tests__/04-detect-price-mode.test.ts`,
 * but Deno tests aren't wired to CI yet. This file mirrors the logic
 * inline and tests it via vitest so CI catches regressions.
 *
 * If either side changes, both sides should be updated to match.
 */
import { describe, expect, it } from 'vitest'

type PriceMode = 'per_unit' | 'per_pack'

interface PriceModeResult {
  mode: PriceMode
  comparatorCost: number
  variancePct: number
  effectiveUnitPrice: number
  packSize: number
}

function detectPriceMode(
  invoiceUnitPrice: number,
  inventoryUnitCost: number,
  inventoryPackSize: number,
): PriceModeResult {
  const packSize = Math.max(1, inventoryPackSize || 1)

  if (inventoryUnitCost <= 0) {
    return {
      mode: 'per_unit',
      comparatorCost: 0,
      variancePct: 0,
      effectiveUnitPrice: invoiceUnitPrice,
      packSize,
    }
  }

  const variancePerUnit =
    (Math.abs(invoiceUnitPrice - inventoryUnitCost) / inventoryUnitCost) * 100

  if (packSize === 1) {
    return {
      mode: 'per_unit',
      comparatorCost: inventoryUnitCost,
      variancePct: variancePerUnit,
      effectiveUnitPrice: invoiceUnitPrice,
      packSize: 1,
    }
  }

  const inventoryPackCost = inventoryUnitCost * packSize
  const variancePerPack =
    (Math.abs(invoiceUnitPrice - inventoryPackCost) / inventoryPackCost) * 100

  if (variancePerPack < variancePerUnit) {
    return {
      mode: 'per_pack',
      comparatorCost: inventoryPackCost,
      variancePct: variancePerPack,
      effectiveUnitPrice: invoiceUnitPrice / packSize,
      packSize,
    }
  }

  return {
    mode: 'per_unit',
    comparatorCost: inventoryUnitCost,
    variancePct: variancePerUnit,
    effectiveUnitPrice: invoiceUnitPrice,
    packSize,
  }
}

describe('detectPriceMode (MOK-133, vitest mirror)', () => {
  it('per-pack match: bakery 4-pack at exactly the pack price', () => {
    // 2026-04-26 prod repro: Croissant 3oz 4pk, unit_cost=$1.55,
    // invoice line "Butter Croissant @ $6.19"
    const r = detectPriceMode(6.19, 1.55, 4)
    expect(r.mode).toBe('per_pack')
    expect(r.packSize).toBe(4)
    expect(r.comparatorCost).toBeCloseTo(6.2, 3)
    expect(r.variancePct).toBeCloseTo(0.161, 2)
    expect(r.effectiveUnitPrice).toBeCloseTo(1.5475, 4)
  })

  it('per-unit match: invoice ships individuals at the unit price', () => {
    const r = detectPriceMode(1.55, 1.55, 4)
    expect(r.mode).toBe('per_unit')
    expect(r.variancePct).toBe(0)
  })

  it('pack_size=1: always per_unit', () => {
    const r = detectPriceMode(2.5, 2.0, 1)
    expect(r.mode).toBe('per_unit')
    expect(r.variancePct).toBeCloseTo(25, 2)
  })

  it('real per-unit price change still detected on packed items', () => {
    // ~+19% real per-unit increase. Per-pack interp (-70%) is much worse
    // → must pick per_unit.
    const r = detectPriceMode(1.85, 1.55, 4)
    expect(r.mode).toBe('per_unit')
    expect(r.variancePct).toBeCloseTo(19.355, 2)
  })

  it('real per-pack price change still detected', () => {
    // 6-pack pack_cost=$9.54, invoice prices per-pack at $11.00 (+15%).
    // Per-unit interp (+591%) is far worse → must pick per_pack.
    const r = detectPriceMode(11.0, 1.59, 6)
    expect(r.mode).toBe('per_pack')
    expect(r.variancePct).toBeCloseTo(15.3, 1)
  })

  it('zero unit_cost: forced to per_unit, zero variance', () => {
    const r = detectPriceMode(5.99, 0, 4)
    expect(r.mode).toBe('per_unit')
    expect(r.variancePct).toBe(0)
  })

  it('pack_size of 0 or negative is normalized to 1', () => {
    expect(detectPriceMode(2.0, 1.5, 0).packSize).toBe(1)
    expect(detectPriceMode(2.0, 1.5, -3).packSize).toBe(1)
  })

  it('large pack (12-case beverages)', () => {
    const r = detectPriceMode(10.3, 0.85, 12)
    expect(r.mode).toBe('per_pack')
    expect(r.packSize).toBe(12)
    expect(r.variancePct).toBeCloseTo(0.98, 1)
  })

  it('exact tie between per_unit and per_pack variance: per_unit wins', () => {
    // m = 2up/(u+p) makes variances exactly equal. u=2, p=4 → m=8/3.
    const m = (2 * 2 * 4) / (2 + 4)
    const r = detectPriceMode(m, 2, 2)
    expect(r.mode).toBe('per_unit')
  })
})
