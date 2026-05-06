/**
 * MOK-150 — findMissingPoLines is the pure-function core of the
 * PO-completeness audit (stage 4 reverse-direction check). Given the PO's
 * lines and the set of inventory ids the invoice's items matched, it
 * returns the PO lines that have no invoice counterpart.
 *
 * Pre-MOK-150 stage 4 only audited invoice→PO direction. Items on the PO
 * that never appeared on the invoice (entirely missing or short-shipped)
 * gave no signal — operator caught them only via manual cross-check. Live
 * repro 2026-05-03 on PO-752389: 2 sauces ordered but missing from the
 * invoice silently auto-confirmed.
 *
 * Run: deno test __tests__/04-find-missing-po-lines.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

import {
  findMissingPoLines,
  type PoLineForCompleteness,
} from '../stages/04-match-items.ts'

function poLine(id: string, invId: string | null, qty = 5): PoLineForCompleteness {
  return { id, inventory_item_id: invId, quantity_ordered: qty }
}

Deno.test('findMissingPoLines — surfaces PO lines whose inventory_item_id was never matched (Lulala repro)', () => {
  // PO ordered 5 lines; invoice only matched 3 (2 sauces missing).
  const poLines = [
    poLine('po-bacon', 'inv-bacon'),
    poLine('po-cheese', 'inv-cheese'),
    poLine('po-chorizo', 'inv-chorizo'),
    poLine('po-chipotle', 'inv-chipotle-sauce', 1),
    poLine('po-garlic', 'inv-garlic-sauce', 1),
  ]
  const matched = new Set(['inv-bacon', 'inv-cheese', 'inv-chorizo'])
  const missing = findMissingPoLines(poLines, matched)
  assertEquals(missing.map((p) => p.id), ['po-chipotle', 'po-garlic'])
})

Deno.test('findMissingPoLines — fully matched invoice → empty result', () => {
  const poLines = [poLine('a', 'inv-a'), poLine('b', 'inv-b')]
  const matched = new Set(['inv-a', 'inv-b'])
  const missing = findMissingPoLines(poLines, matched)
  assertEquals(missing.length, 0)
})

Deno.test('findMissingPoLines — empty PO returns empty (no lines to audit)', () => {
  const missing = findMissingPoLines([], new Set(['inv-a']))
  assertEquals(missing.length, 0)
})

Deno.test('findMissingPoLines — invoice matched nothing → all PO lines are missing', () => {
  const poLines = [poLine('a', 'inv-a'), poLine('b', 'inv-b')]
  const missing = findMissingPoLines(poLines, new Set())
  assertEquals(missing.map((p) => p.id), ['a', 'b'])
})

Deno.test('findMissingPoLines — skips PO lines with null inventory_item_id (free-text, untracked)', () => {
  // PO lines without an inventory_item_id can't be audited (no concept of
  // "matched"). Filter them out rather than treating them as always-missing.
  const poLines = [
    poLine('a', 'inv-a'),
    poLine('free-text-line', null),
    poLine('b', 'inv-b'),
  ]
  const matched = new Set(['inv-a', 'inv-b'])
  const missing = findMissingPoLines(poLines, matched)
  assertEquals(missing.length, 0)
})

Deno.test('findMissingPoLines — null inventory_item_id is excluded even when nothing matched', () => {
  const poLines = [poLine('free-text', null), poLine('a', 'inv-a')]
  const missing = findMissingPoLines(poLines, new Set())
  assertEquals(missing.map((p) => p.id), ['a'])
})
