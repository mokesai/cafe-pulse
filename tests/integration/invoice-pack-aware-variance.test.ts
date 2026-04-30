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

// ─────────────────────────────────────────────────────────────────────────────
// MOK-134 — pickBestPackAwareMatch (mirror of supabase/functions/.../04-pick-best-pack-aware-match.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface Cand {
  id: string
  unit_cost: number
  pack_size: number
}

function pickBestPackAwareMatch<T extends { unit_cost: number; pack_size: number }>(
  candidates: T[],
  invoiceUnitPrice: number,
): T {
  if (candidates.length === 1) return candidates[0]
  let best = candidates[0]
  let bestVariance = detectPriceMode(invoiceUnitPrice, best.unit_cost, best.pack_size).variancePct
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]
    const v = detectPriceMode(invoiceUnitPrice, c.unit_cost, c.pack_size).variancePct
    if (v < bestVariance) {
      best = c
      bestVariance = v
    }
  }
  return best
}

describe('pickBestPackAwareMatch (MOK-134, vitest mirror)', () => {
  it('single candidate is returned as-is', () => {
    const c: Cand = { id: 'a', unit_cost: 1.55, pack_size: 4 }
    expect(pickBestPackAwareMatch([c], 6.19).id).toBe('a')
  })

  it('pack-pair: picks the pack candidate when invoice is per-pack priced (BP repro)', () => {
    const candidates: Cand[] = [
      { id: 'butter-1pk', unit_cost: 1.50, pack_size: 1 },
      { id: 'butter-4pk', unit_cost: 1.55, pack_size: 4 },
    ]
    expect(pickBestPackAwareMatch(candidates, 6.19).id).toBe('butter-4pk')
  })

  it('pack-pair: picks the per-unit candidate when invoice is per-unit priced', () => {
    const candidates: Cand[] = [
      { id: 'butter-1pk', unit_cost: 1.55, pack_size: 1 },
      { id: 'butter-4pk', unit_cost: 1.55, pack_size: 4 },
    ]
    expect(pickBestPackAwareMatch(candidates, 1.55).id).toBe('butter-1pk')
  })

  it('three candidates: picks smallest variance', () => {
    const candidates: Cand[] = [
      { id: 'single', unit_cost: 0.85, pack_size: 1 },
      { id: '4pk', unit_cost: 0.85, pack_size: 4 },
      { id: '12pk', unit_cost: 0.85, pack_size: 12 },
    ]
    expect(pickBestPackAwareMatch(candidates, 10.30).id).toBe('12pk')
  })

  it('first candidate wins on tie (stable)', () => {
    const candidates: Cand[] = [
      { id: 'a', unit_cost: 2.0, pack_size: 1 },
      { id: 'b', unit_cost: 2.0, pack_size: 1 },
    ]
    expect(pickBestPackAwareMatch(candidates, 2.5).id).toBe('a')
  })
})
