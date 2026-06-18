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
  validateBoxDivision,
  nextAvailablePosition,
  cellsOccupied,
  firstFreeCell,
  MIN_SPAN_FOR_DIVISION,
  type GridBox,
  type BoxDivisionFields,
} from '../grid-validation'

function box(position: number, r: number, c: number, rs = 1, cs = 1): GridBox {
  return { position, row_start: r, col_start: c, row_span: rs, col_span: cs }
}

function divBox(
  position: number,
  r: number,
  c: number,
  rs: number,
  cs: number,
  div: BoxDivisionFields,
): GridBox & BoxDivisionFields {
  return { ...box(position, r, c, rs, cs), ...div }
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

// ─────────────────────────────────────────────────────────────────────────────
// validateBoxDivision (phase 2.5)
// ─────────────────────────────────────────────────────────────────────────────

describe('validateBoxDivision', () => {
  it('undivided + all _b NULL is valid', () => {
    expect(
      validateBoxDivision(divBox(1, 1, 1, 1, 1, { division: 'none' })),
    ).toEqual({ ok: true })
  })

  it('undefined division is treated as none (valid when _b is empty)', () => {
    expect(validateBoxDivision(divBox(1, 1, 1, 1, 1, {}))).toEqual({ ok: true })
  })

  it('horizontal + box_type_b set + row_span >= 2 is valid', () => {
    expect(
      validateBoxDivision(
        divBox(1, 1, 1, 2, 1, { division: 'horizontal', box_type_b: 'menu_group' }),
      ),
    ).toEqual({ ok: true })
  })

  it('vertical + box_type_b set + col_span >= 2 is valid', () => {
    expect(
      validateBoxDivision(
        divBox(1, 1, 1, 1, 2, { division: 'vertical', box_type_b: 'image_only' }),
      ),
    ).toEqual({ ok: true })
  })

  it('divided + missing box_type_b is rejected', () => {
    const result = validateBoxDivision(divBox(1, 1, 1, 2, 1, { division: 'horizontal' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/box_type_b is not set/)
    }
  })

  it('undivided + stray box_type_b is rejected', () => {
    const result = validateBoxDivision(
      divBox(1, 1, 1, 1, 1, { division: 'none', box_type_b: 'menu_group' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/slot-B fields are populated/)
    }
  })

  it('undivided + stray header_override_b is rejected', () => {
    const result = validateBoxDivision(
      divBox(1, 1, 1, 1, 1, { division: 'none', header_override_b: 'foo' }),
    )
    expect(result.ok).toBe(false)
  })

  it('horizontal + row_span=1 is rejected (min-span guard)', () => {
    const result = validateBoxDivision(
      divBox(1, 1, 1, 1, 4, { division: 'horizontal', box_type_b: 'menu_group' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/row_span >= 2/)
    }
  })

  it('vertical + col_span=1 is rejected (min-span guard)', () => {
    const result = validateBoxDivision(
      divBox(1, 1, 1, 4, 1, { division: 'vertical', box_type_b: 'menu_group' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/col_span >= 2/)
    }
  })

  it('horizontal + row_span=2 is valid (min-span boundary)', () => {
    expect(MIN_SPAN_FOR_DIVISION).toBe(2)
    expect(
      validateBoxDivision(
        divBox(1, 1, 1, 2, 4, { division: 'horizontal', box_type_b: 'menu_group' }),
      ),
    ).toEqual({ ok: true })
  })

  it('invalid division value is rejected', () => {
    const result = validateBoxDivision(
      divBox(1, 1, 1, 1, 1, { division: 'bogus' as 'horizontal' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/invalid division/)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateBoxLayout — phase 2.5 division integration
// ─────────────────────────────────────────────────────────────────────────────

describe('validateBoxLayout (with division)', () => {
  it('aggregates division errors alongside geometry errors', () => {
    const boxes = [
      // box 1: out of grid bounds
      divBox(1, 5, 1, 1, 1, { division: 'none' }),
      // box 2: divided but missing box_type_b
      divBox(2, 1, 1, 2, 1, { division: 'horizontal' }),
    ]
    const result = validateBoxLayout(boxes, { rows: 4, cols: 4 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2)
      expect(result.errors.some((e) => /extends beyond/.test(e))).toBe(true)
      expect(result.errors.some((e) => /box_type_b is not set/.test(e))).toBe(true)
    }
  })

  it('accepts a layout mixing divided and undivided boxes', () => {
    const boxes = [
      divBox(1, 1, 1, 1, 1, { division: 'none' }),
      divBox(2, 2, 1, 2, 2, { division: 'vertical', box_type_b: 'image_only' }),
    ]
    expect(validateBoxLayout(boxes, { rows: 4, cols: 4 })).toEqual({ ok: true })
  })
})
