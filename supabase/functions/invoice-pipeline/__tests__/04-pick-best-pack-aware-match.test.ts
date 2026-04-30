/**
 * MOK-134 — pickBestPackAwareMatch picks the same-name candidate whose
 * detectPriceMode variance is smallest against the invoice unit_price.
 *
 * Run: deno test __tests__/04-pick-best-pack-aware-match.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

import { pickBestPackAwareMatch } from '../stages/04-match-items.ts'

interface Cand {
  id: string
  unit_cost: number
  pack_size: number
}

Deno.test('pickBestPackAwareMatch — single candidate is returned as-is', () => {
  const c: Cand = { id: 'a', unit_cost: 1.55, pack_size: 4 }
  const picked = pickBestPackAwareMatch([c], 6.19)
  assertEquals(picked.id, 'a')
})

Deno.test('pickBestPackAwareMatch — pack-pair: picks the pack candidate when invoice is per-pack priced', () => {
  // 2026-04-26 prod repro: BP "Butter Croissant" with pack_size=1, unit_cost=$1.50
  // and Croissant 3oz 4pk with pack_size=4, unit_cost=$1.55. Invoice line at $6.19
  // is per-pack — should pick the 4pk row.
  const candidates: Cand[] = [
    { id: 'butter-1pk', unit_cost: 1.50, pack_size: 1 }, // first by query order
    { id: 'butter-4pk', unit_cost: 1.55, pack_size: 4 }, // canonical
  ]
  const picked = pickBestPackAwareMatch(candidates, 6.19)
  assertEquals(picked.id, 'butter-4pk')
})

Deno.test('pickBestPackAwareMatch — pack-pair: picks the per-unit candidate when invoice is per-unit priced', () => {
  const candidates: Cand[] = [
    { id: 'butter-1pk', unit_cost: 1.55, pack_size: 1 },
    { id: 'butter-4pk', unit_cost: 1.55, pack_size: 4 },
  ]
  // Invoice priced per-individual at $1.55 — closer to the 1pk's per-unit
  // ($1.55) than to the 4pk's pack price ($6.20).
  const picked = pickBestPackAwareMatch(candidates, 1.55)
  assertEquals(picked.id, 'butter-1pk')
})

Deno.test('pickBestPackAwareMatch — three candidates: picks the smallest variance', () => {
  // Hypothetical: 3 inventory rows (single, 4pk, 12pk) sharing a name
  const candidates: Cand[] = [
    { id: 'single', unit_cost: 0.85, pack_size: 1 },
    { id: '4pk', unit_cost: 0.85, pack_size: 4 },
    { id: '12pk', unit_cost: 0.85, pack_size: 12 }, // pack price = $10.20
  ]
  // Invoice at $10.30 — per-pack 12 → variance ~0.98%, smallest
  const picked = pickBestPackAwareMatch(candidates, 10.30)
  assertEquals(picked.id, '12pk')
})

Deno.test('pickBestPackAwareMatch — first candidate wins on equal variance (stable)', () => {
  // Two identical candidates — the helper preserves the input order on tie.
  const candidates: Cand[] = [
    { id: 'a', unit_cost: 2.0, pack_size: 1 },
    { id: 'b', unit_cost: 2.0, pack_size: 1 },
  ]
  const picked = pickBestPackAwareMatch(candidates, 2.5)
  assertEquals(picked.id, 'a')
})
