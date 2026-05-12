/**
 * MOK-152 / KDS v3 phase 2 — grid validation unit tests.
 *
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T3)
 *
 * Pure-function tests for grid layout validation. Same helpers run on both
 * server (route validation) and client (editor UX feedback) so the integration
 * tests in T7 can assert the server and client agree.
 */
import { describe, expect, it } from 'vitest'

import {
  boxFitsInGrid,
  boxesOverlap,
  validateBoxLayout,
  nextAvailablePosition,
  cellsOccupied,
  firstFreeCell,
  type GridBox,
} from '../grid-validation'

function box(position: number, r: number, c: number, rs = 1, cs = 1): GridBox {
  return { position, row_start: r, col_start: c, row_span: rs, col_span: cs }
}

// ─────────────────────────────────────────────────────────────────────────────
// boxFitsInGrid
// ─────────────────────────────────────────────────────────────────────────────

describe('boxFitsInGrid', () => {
  it('1x1 box at (1,1) fits in a 4x6 grid', () => {
    expect(boxFitsInGrid(box(1, 1, 1), { rows: 4, cols: 6 })).toBe(true)
  })

  it('2x3 box at (3,4) fits in a 4x6 grid (exact corner)', () => {
    expect(boxFitsInGrid(box(1, 3, 4, 2, 3), { rows: 4, cols: 6 })).toBe(true)
  })

  it('rejects box overflowing rows', () => {
    expect(boxFitsInGrid(box(1, 4, 1, 2, 1), { rows: 4, cols: 6 })).toBe(false)
  })

  it('rejects box overflowing columns', () => {
    expect(boxFitsInGrid(box(1, 1, 6, 1, 2), { rows: 4, cols: 6 })).toBe(false)
  })

  it('rejects 0-span box (defensive)', () => {
    expect(boxFitsInGrid(box(1, 1, 1, 0, 1), { rows: 4, cols: 6 })).toBe(false)
    expect(boxFitsInGrid(box(1, 1, 1, 1, 0), { rows: 4, cols: 6 })).toBe(false)
  })

  it('rejects negative coordinates (defensive)', () => {
    expect(boxFitsInGrid(box(1, 0, 1), { rows: 4, cols: 6 })).toBe(false)
    expect(boxFitsInGrid(box(1, 1, 0), { rows: 4, cols: 6 })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// boxesOverlap
// ─────────────────────────────────────────────────────────────────────────────

describe('boxesOverlap', () => {
  it('non-adjacent boxes do not overlap', () => {
    expect(boxesOverlap(box(1, 1, 1), box(2, 3, 3))).toBe(false)
  })

  it('edge-adjacent (touching) boxes do not overlap', () => {
    // Box A ends at row 2; box B starts at row 3 — adjacent, not overlapping.
    expect(boxesOverlap(box(1, 1, 1, 2, 2), box(2, 3, 1, 1, 2))).toBe(false)
  })

  it('partially overlapping boxes overlap', () => {
    // Box A spans (1..2, 1..2), box B spans (2..3, 2..3) — overlap at (2,2).
    expect(boxesOverlap(box(1, 1, 1, 2, 2), box(2, 2, 2, 2, 2))).toBe(true)
  })

  it('contained boxes overlap', () => {
    // Box B sits entirely inside box A.
    expect(boxesOverlap(box(1, 1, 1, 4, 4), box(2, 2, 2, 1, 1))).toBe(true)
  })

  it('identical boxes overlap', () => {
    expect(boxesOverlap(box(1, 2, 3, 2, 2), box(2, 2, 3, 2, 2))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateBoxLayout
// ─────────────────────────────────────────────────────────────────────────────

describe('validateBoxLayout', () => {
  it('empty layout is valid', () => {
    const r = validateBoxLayout([], { rows: 4, cols: 6 })
    expect(r.ok).toBe(true)
  })

  it('all-valid layout passes', () => {
    const r = validateBoxLayout(
      [box(1, 1, 1, 2, 2), box(2, 1, 3, 2, 2), box(3, 3, 1, 1, 4)],
      { rows: 4, cols: 6 },
    )
    expect(r.ok).toBe(true)
  })

  it('out-of-bounds box surfaces a clear error', () => {
    const r = validateBoxLayout([box(1, 1, 5, 1, 3)], { rows: 4, cols: 6 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(1)
      expect(r.errors[0]).toMatch(/Box 1.*extends beyond/)
    }
  })

  it('overlap surfaces a clear error', () => {
    const r = validateBoxLayout(
      [box(1, 1, 1, 2, 2), box(2, 2, 2, 2, 2)],
      { rows: 4, cols: 6 },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(1)
      expect(r.errors[0]).toMatch(/Box 1 and box 2 overlap/)
    }
  })

  it('multiple overlaps each surface as a separate error', () => {
    const r = validateBoxLayout(
      [
        box(1, 1, 1, 2, 2),
        box(2, 1, 1, 2, 2), // overlaps 1
        box(3, 2, 2, 2, 2), // overlaps 1 and 2
      ],
      { rows: 4, cols: 6 },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(3) // 1-2, 1-3, 2-3
    }
  })

  it('duplicate position numbers surface as a defensive error', () => {
    const r = validateBoxLayout([box(1, 1, 1), box(1, 2, 2)], { rows: 4, cols: 6 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => /Position number 1.*2 boxes/.test(e))).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// nextAvailablePosition + stability
// ─────────────────────────────────────────────────────────────────────────────

describe('nextAvailablePosition', () => {
  it('empty list returns 1', () => {
    expect(nextAvailablePosition([])).toBe(1)
  })

  it('returns max + 1 even when there are gaps (positions are stable, not compacted)', () => {
    // After deletes, the layout might be [1, 3, 7]. Next position is 8, not 2.
    expect(nextAvailablePosition([box(1, 1, 1), box(3, 1, 2), box(7, 2, 1)])).toBe(8)
  })

  it('single box returns its position + 1', () => {
    expect(nextAvailablePosition([box(5, 1, 1)])).toBe(6)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// cellsOccupied + firstFreeCell
// ─────────────────────────────────────────────────────────────────────────────

describe('cellsOccupied', () => {
  it('returns an empty set when no boxes', () => {
    expect(cellsOccupied([]).size).toBe(0)
  })

  it('expands each box into its constituent cells', () => {
    const occupied = cellsOccupied([box(1, 2, 3, 2, 2)])
    expect(occupied.size).toBe(4)
    expect(occupied.has('2,3')).toBe(true)
    expect(occupied.has('2,4')).toBe(true)
    expect(occupied.has('3,3')).toBe(true)
    expect(occupied.has('3,4')).toBe(true)
  })
})

describe('firstFreeCell', () => {
  it('returns (1,1) on an empty grid', () => {
    expect(firstFreeCell([], { rows: 4, cols: 6 })).toEqual({ row: 1, col: 1 })
  })

  it('skips occupied cells in row-major order', () => {
    const boxes = [box(1, 1, 1, 1, 2)] // occupies (1,1) and (1,2)
    expect(firstFreeCell(boxes, { rows: 4, cols: 6 })).toEqual({ row: 1, col: 3 })
  })

  it('returns null when the grid is fully occupied', () => {
    const fullCover = [box(1, 1, 1, 4, 6)]
    expect(firstFreeCell(fullCover, { rows: 4, cols: 6 })).toBeNull()
  })
})
