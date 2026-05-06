/**
 * MOK-149 — selectCandidatePool restricts the matcher's inventory candidates
 * to the invoice's resolved supplier.
 *
 * Pre-MOK-149 stage 4 fuzzy-matched against the entire tenant inventory pool.
 * A Lulala invoice line "Bacon" landed on Odeko's "Sammies Bacon Sandwich"
 * (literal-word similarity) instead of Lulala's "Loly's Burrito (bacon)" —
 * the matcher had no signal to prefer same-supplier candidates. Filtering up
 * front means short-form descriptions resolve correctly within the supplier's
 * own catalog. Pack-pair sibling promotion (MOK-144) keeps the full pool
 * separately so cross-supplier siblings (Aspen→Bluepoint transitions) still
 * work as a safety net.
 *
 * Run: deno test __tests__/04-select-candidate-pool.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

import { selectCandidatePool } from '../stages/04-match-items.ts'

interface TestRow {
  id: string
  supplier_id: string | null
}

const lulala = (id: string): TestRow => ({ id, supplier_id: 'lulala-id' })
const odeko = (id: string): TestRow => ({ id, supplier_id: 'odeko-id' })
const orphan = (id: string): TestRow => ({ id, supplier_id: null })

Deno.test('selectCandidatePool — filters to the resolved supplier (the live repro)', () => {
  // Lulala invoice; pool has 2 Lulala items + 3 Odeko items + 1 orphan.
  const pool = [
    lulala('lulala-bacon'),
    odeko('odeko-sammies-bacon'),
    odeko('odeko-burrito-chorizzo'),
    lulala('lulala-chorizo'),
    odeko('odeko-egg-cheese'),
    orphan('legacy-no-supplier'),
  ]
  const filtered = selectCandidatePool(pool, 'lulala-id')
  assertEquals(filtered.map((r) => r.id), ['lulala-bacon', 'lulala-chorizo'])
})

Deno.test('selectCandidatePool — excludes orphan rows (supplier_id null) when supplier is resolved', () => {
  // An orphan row's null supplier_id never matches a resolved supplier id.
  const pool = [lulala('a'), orphan('b')]
  const filtered = selectCandidatePool(pool, 'lulala-id')
  assertEquals(filtered.map((r) => r.id), ['a'])
})

Deno.test('selectCandidatePool — returns full pool when no supplier is resolved', () => {
  // No resolved supplier (stage 3 failed) — fall back to full pool so the
  // matcher can still produce some result instead of a guaranteed miss.
  const pool = [lulala('a'), odeko('b'), orphan('c')]
  const filtered = selectCandidatePool(pool, null)
  assertEquals(filtered.map((r) => r.id), ['a', 'b', 'c'])
})

Deno.test('selectCandidatePool — supplier with no inventory returns empty array (caller raises no_item_match)', () => {
  // Resolved supplier exists but has no inventory rows. The fuzzy matcher
  // will get an empty pool and return zero matches; the existing
  // no_item_match exception path handles it. This is the right signal —
  // false-matching cross-supplier was strictly worse than flagging.
  const pool = [odeko('a'), odeko('b')]
  const filtered = selectCandidatePool(pool, 'lulala-id')
  assertEquals(filtered.length, 0)
})

Deno.test('selectCandidatePool — empty input returns empty', () => {
  const filtered = selectCandidatePool([] as TestRow[], 'any-id')
  assertEquals(filtered.length, 0)
})
