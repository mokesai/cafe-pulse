/**
 * MOK-152 / KDS v3 phase 2 — grid layout validation helpers.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-152
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T3)
 *
 * Pure functions, shared between:
 *   - Server-side route validation in /api/admin/kds-v3/screens/[id]
 *   - Client-side editor UX feedback in GridEditor
 *
 * Single source of truth — the integration tests assert that the server's
 * 422 fires for the same shapes the client would block.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GridDims {
  rows: number
  cols: number
}

export interface GridBox {
  /** Stable 1-based identifier. Never reassigned across edits. */
  position: number
  row_start: number
  col_start: number
  row_span: number
  col_span: number
}

export interface ValidationOk {
  ok: true
}
export interface ValidationFailure {
  ok: false
  errors: string[]
}
export type ValidationResult = ValidationOk | ValidationFailure

// ─────────────────────────────────────────────────────────────────────────────
// Geometry primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the box's footprint fits entirely within the grid bounds.
 *
 * Bounds are inclusive at 1 and use `start + span - 1` for the last occupied
 * cell. A 1x1 box at (1,1) on a 1x1 grid fits exactly; a 1x2 box at (1,1) on
 * a 1x1 grid does NOT fit.
 */
export function boxFitsInGrid(box: GridBox, grid: GridDims): boolean {
  const lastRow = box.row_start + box.row_span - 1
  const lastCol = box.col_start + box.col_span - 1
  return (
    box.row_start >= 1 &&
    box.col_start >= 1 &&
    box.row_span >= 1 &&
    box.col_span >= 1 &&
    lastRow <= grid.rows &&
    lastCol <= grid.cols
  )
}

/**
 * Returns true if two box rectangles overlap on the grid plane.
 *
 * Boxes that share an edge but do not overlap (e.g. one ends at row 2, the
 * other starts at row 3) are NOT considered overlapping.
 */
export function boxesOverlap(a: GridBox, b: GridBox): boolean {
  const aLastRow = a.row_start + a.row_span - 1
  const aLastCol = a.col_start + a.col_span - 1
  const bLastRow = b.row_start + b.row_span - 1
  const bLastCol = b.col_start + b.col_span - 1
  return (
    a.row_start <= bLastRow &&
    aLastRow >= b.row_start &&
    a.col_start <= bLastCol &&
    aLastCol >= b.col_start
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a full set of boxes against the grid. Returns one error string per
 * offending box (or pair, for overlaps). Returns `{ ok: true }` only when the
 * entire layout is valid.
 *
 * Why a list of errors rather than a single boolean: the editor surfaces the
 * messages back to the operator so they can fix all violations at once.
 */
export function validateBoxLayout(boxes: GridBox[], grid: GridDims): ValidationResult {
  const errors: string[] = []

  // Grid bounds check
  for (const box of boxes) {
    if (!boxFitsInGrid(box, grid)) {
      errors.push(
        `Box ${box.position} (${box.row_start},${box.col_start} ` +
          `size ${box.row_span}×${box.col_span}) ` +
          `extends beyond the ${grid.rows}×${grid.cols} grid.`,
      )
    }
  }

  // Pairwise overlap check
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j])) {
        errors.push(
          `Box ${boxes[i].position} and box ${boxes[j].position} overlap.`,
        )
      }
    }
  }

  // Duplicate position numbers — defensive (shouldn't happen if the editor
  // honors stability, but server-side validation should reject anyway).
  const positions = new Map<number, number>()
  for (const box of boxes) {
    positions.set(box.position, (positions.get(box.position) ?? 0) + 1)
  }
  for (const [pos, count] of positions) {
    if (count > 1) {
      errors.push(`Position number ${pos} is used by ${count} boxes.`)
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// Position helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Next available position number for a new box: `max(existing.position) + 1`,
 * or 1 if there are no boxes.
 *
 * IMPORTANT: this is for new boxes only. Existing boxes keep their position
 * numbers stable across all CRUD ops — we never renumber to fill gaps.
 * Position stability is asserted in the integration tests.
 */
export function nextAvailablePosition(boxes: GridBox[]): number {
  if (boxes.length === 0) return 1
  return Math.max(...boxes.map((b) => b.position)) + 1
}

/**
 * Returns the set of "row,col" cell coordinates currently occupied by any box.
 *
 * Used by the editor's "Add box" handler to pick the next free 1×1 cell.
 */
export function cellsOccupied(boxes: GridBox[]): Set<string> {
  const occupied = new Set<string>()
  for (const box of boxes) {
    for (let r = box.row_start; r < box.row_start + box.row_span; r++) {
      for (let c = box.col_start; c < box.col_start + box.col_span; c++) {
        occupied.add(`${r},${c}`)
      }
    }
  }
  return occupied
}

/**
 * Find the first free cell in row-major order. Returns null if the grid is
 * fully occupied.
 */
export function firstFreeCell(boxes: GridBox[], grid: GridDims): { row: number; col: number } | null {
  const occupied = cellsOccupied(boxes)
  for (let r = 1; r <= grid.rows; r++) {
    for (let c = 1; c <= grid.cols; c++) {
      if (!occupied.has(`${r},${c}`)) return { row: r, col: c }
    }
  }
  return null
}
