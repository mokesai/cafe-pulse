/**
 * B3 / MOK-175 — computeCostJumps flags inventory items whose supplier cost rose at least the
 * threshold over the window (baseline = cost before the earliest in-window change vs current).
 */
import { describe, expect, it } from 'vitest'

import { computeCostJumps } from '../cost-jump'

const items = [
  { id: 'a', item_name: 'Espresso Beans', unit_cost: 46 }, // baseline 40 → +15%
  { id: 'b', item_name: 'Whole Milk', unit_cost: 3.3 }, // baseline 3.2 → +3.1% (below)
  { id: 'c', item_name: 'Cups', unit_cost: 0.13 }, // no history
]

describe('computeCostJumps (MOK-175)', () => {
  it('flags items whose cost rose >= threshold, ignoring sub-threshold ones', () => {
    const history = [
      { inventory_item_id: 'a', previous_unit_cost: 40, new_unit_cost: 46, changed_at: '2026-07-01T00:00:00Z' },
      { inventory_item_id: 'b', previous_unit_cost: 3.2, new_unit_cost: 3.3, changed_at: '2026-07-02T00:00:00Z' },
    ]
    const flagged = computeCostJumps(items, history)
    expect(flagged.map((f) => f.id)).toEqual(['a'])
    expect(flagged[0].pct_change).toBe(15)
    expect(flagged[0].baseline_cost).toBe(40)
    expect(flagged[0].current_cost).toBe(46)
  })

  it('uses the earliest in-window baseline vs current cost (catches a cumulative jump)', () => {
    const history = [
      { inventory_item_id: 'a', previous_unit_cost: 40, new_unit_cost: 43, changed_at: '2026-06-20T00:00:00Z' },
      { inventory_item_id: 'a', previous_unit_cost: 43, new_unit_cost: 46, changed_at: '2026-07-01T00:00:00Z' },
    ]
    const flagged = computeCostJumps(items, history)
    expect(flagged.map((f) => f.id)).toEqual(['a'])
    expect(flagged[0].pct_change).toBe(15) // (46 - 40) / 40
  })

  it('skips items with no prior cost (null baseline)', () => {
    const history = [
      { inventory_item_id: 'a', previous_unit_cost: null, new_unit_cost: 46, changed_at: '2026-07-01T00:00:00Z' },
    ]
    expect(computeCostJumps(items, history)).toEqual([])
  })

  it('respects a custom threshold', () => {
    const history = [
      { inventory_item_id: 'b', previous_unit_cost: 3.0, new_unit_cost: 3.3, changed_at: '2026-07-02T00:00:00Z' },
    ]
    // b current 3.3 vs baseline 3.0 = +10%
    expect(computeCostJumps(items, history, { thresholdPct: 5 }).map((f) => f.id)).toEqual(['b'])
    expect(computeCostJumps(items, history, { thresholdPct: 15 })).toEqual([])
  })
})
