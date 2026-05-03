/**
 * MOK-144 — promoteToPackPairSibling: after the initial alias/exact/fuzzy
 * match picks an inventory row, promote to a pack-pair sibling (rows
 * sharing the matched row's `square_item_id`) when a sibling lands a
 * lower-variance price-mode interpretation. Resolves ties by preferring
 * the row whose supplier matches the invoice's resolved supplier.
 *
 * Live repro 2026-05-03: Bluepoint Bakery invoice line "Croissant 3 oz 4pk"
 * at $6.19/unit fuzzy-matched the legacy 1pk Aspen "Butter Croissant"
 * ($1.50) instead of the new 4pk Bluepoint "Croissant 3oz 4pk" ($1.55) —
 * even though both shared `square_item_id`. Pre-MOK-144: matcher took the
 * fuzzy top hit and emitted a +312% block exception. Post-MOK-144: matcher
 * promotes to the 4pk sibling, raises a -0.16% info exception (pack
 * variance), invoice auto-confirms.
 *
 * Run: deno test __tests__/04-promote-pack-pair-sibling.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

import {
  promoteToPackPairSibling,
  type PackPairCandidate,
} from '../stages/04-match-items.ts'

function row(overrides: Partial<PackPairCandidate> & { id: string }): PackPairCandidate {
  return {
    unit_cost: 1,
    pack_size: 1,
    square_item_id: null,
    supplier_id: null,
    ...overrides,
  }
}

Deno.test('promoteToPackPairSibling — returns the input row when square_item_id is null', () => {
  const initial = row({ id: 'a', unit_cost: 1.5, pack_size: 1, square_item_id: null })
  const inventory = [initial, row({ id: 'b', unit_cost: 1.55, pack_size: 4, square_item_id: 'X' })]
  const result = promoteToPackPairSibling(initial, inventory, 6.19, null)
  assertEquals(result.id, 'a')
})

Deno.test('promoteToPackPairSibling — returns the input row when no other siblings exist', () => {
  const initial = row({ id: 'a', unit_cost: 1.5, pack_size: 1, square_item_id: 'X' })
  const inventory = [initial, row({ id: 'unrelated', unit_cost: 9, pack_size: 1, square_item_id: 'Y' })]
  const result = promoteToPackPairSibling(initial, inventory, 6.19, null)
  assertEquals(result.id, 'a')
})

Deno.test('promoteToPackPairSibling — promotes to pack sibling when invoice price matches per-pack interpretation (the live repro)', () => {
  // Invoice line: per-pack price $6.19. Pack-pair siblings:
  //   id=single: pack_size=1, unit_cost=$1.50 → per-unit variance |6.19-1.50|/1.50 = 312.7%
  //   id=four:   pack_size=4, unit_cost=$1.55 → per-pack variance |6.19-(1.55*4)|/6.20 = 0.16%
  // Per-pack wins → matcher should pick id=four.
  const single = row({ id: 'single', unit_cost: 1.5, pack_size: 1, square_item_id: 'X' })
  const four = row({ id: 'four', unit_cost: 1.55, pack_size: 4, square_item_id: 'X' })
  const inventory = [single, four]
  const result = promoteToPackPairSibling(single, inventory, 6.19, null)
  assertEquals(result.id, 'four')
})

Deno.test('promoteToPackPairSibling — keeps the input when it is already the lowest-variance match', () => {
  // Invoice line per-unit $1.55. Pack=1 sibling at $1.55 wins; pack=4 at $1.55 has 4x variance.
  const single = row({ id: 'single', unit_cost: 1.55, pack_size: 1, square_item_id: 'X' })
  const four = row({ id: 'four', unit_cost: 1.55, pack_size: 4, square_item_id: 'X' })
  const inventory = [single, four]
  const result = promoteToPackPairSibling(single, inventory, 1.55, null)
  assertEquals(result.id, 'single')
})

Deno.test('promoteToPackPairSibling — supplier-match tiebreaker selects the matching-supplier row when variances tie', () => {
  // Two rows with identical price profile but different suppliers; invoice
  // supplier matches only one. Tiebreaker should select that one.
  const aspen = row({ id: 'aspen', unit_cost: 1.55, pack_size: 4, square_item_id: 'X', supplier_id: 'aspen-id' })
  const bluepoint = row({ id: 'bluepoint', unit_cost: 1.55, pack_size: 4, square_item_id: 'X', supplier_id: 'bluepoint-id' })
  const inventory = [aspen, bluepoint]
  const result = promoteToPackPairSibling(aspen, inventory, 6.20, 'bluepoint-id')
  assertEquals(result.id, 'bluepoint')
})

Deno.test('promoteToPackPairSibling — supplier match does NOT override a strictly-better variance', () => {
  // Invoice supplier matches the WORSE-variance row. Variance still wins —
  // we shouldn't promote into a +N00% match just because the supplier lines up.
  const single = row({ id: 'single', unit_cost: 1.5, pack_size: 1, square_item_id: 'X', supplier_id: 'invoice-supplier' })
  const four = row({ id: 'four', unit_cost: 1.55, pack_size: 4, square_item_id: 'X', supplier_id: 'other-supplier' })
  const inventory = [single, four]
  const result = promoteToPackPairSibling(single, inventory, 6.19, 'invoice-supplier')
  assertEquals(result.id, 'four')
})

Deno.test('promoteToPackPairSibling — excludes $0 unit_cost stubs from the sibling group', () => {
  // A skeleton row at $0 should never win the promotion even if its variance
  // calc happens to look favorable in detectPriceMode's edge case.
  const initial = row({ id: 'real', unit_cost: 1.5, pack_size: 1, square_item_id: 'X' })
  const stub = row({ id: 'stub', unit_cost: 0, pack_size: 1, square_item_id: 'X' })
  const inventory = [initial, stub]
  const result = promoteToPackPairSibling(initial, inventory, 1.5, null)
  assertEquals(result.id, 'real')
})

Deno.test('promoteToPackPairSibling — empty inventory list returns the input', () => {
  const initial = row({ id: 'a', unit_cost: 1.5, pack_size: 1, square_item_id: 'X' })
  const result = promoteToPackPairSibling(initial, [], 6.19, null)
  assertEquals(result.id, 'a')
})
