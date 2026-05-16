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

/**
 * MOK-154 / phase 2.5 — division mode for an optional second content slot.
 * `'horizontal'` = top/bottom split, `'vertical'` = left/right split.
 */
export type DivisionMode = 'none' | 'horizontal' | 'vertical'

/**
 * Phase 2.5 second-slot fields. Always optional at the type level — phase 2
 * boxes don't carry them, and the validator interprets `division === undefined`
 * the same as `'none'` (matching the DB's NOT NULL DEFAULT).
 */
export interface BoxDivisionFields {
  division?: DivisionMode | null
  box_type_b?: string | null
  square_menu_group_id_b?: string | null
  aesthetic_image_id_b?: string | null
  header_override_b?: string | null
}

/**
 * Minimum span on the divided axis. Set to 2 so we never produce a slot
 * smaller than 1 grid cell along the split direction — the phase 6 renderer
 * uses `ceil(span / 2)` / `floor(span / 2)` to compute each slot's rectangle,
 * which would produce a 0-cell slot for span=1.
 */
export const MIN_SPAN_FOR_DIVISION = 2

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
// Division validation (phase 2.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate the division-related fields of a single box. Returns an error list
 * per box; aggregated by `validateBoxLayout` below.
 *
 * Two invariants enforced here:
 *   1. Cross-column: when `division = 'none'` (or undefined), all `_b` fields
 *      must be null/undefined; when `division` is `'horizontal'` or `'vertical'`,
 *      `box_type_b` must be set. (Mirrors the DB CHECK constraint
 *      `kds_grid_boxes_division_slot_b_invariant`.)
 *   2. Min span on the divided axis: `'horizontal'` requires `row_span >= 2`,
 *      `'vertical'` requires `col_span >= 2`. Enforced only at the route
 *      layer (not in the DB) because it's a UX guard — the DB stays
 *      permissive in case we relax later.
 */
export function validateBoxDivision(box: GridBox & BoxDivisionFields): ValidationResult {
  const errors: string[] = []
  const division = box.division ?? 'none'

  const hasStrayB =
    box.box_type_b != null ||
    box.square_menu_group_id_b != null ||
    box.aesthetic_image_id_b != null ||
    box.header_override_b != null

  if (division === 'none') {
    if (hasStrayB) {
      errors.push(
        `Box ${box.position} has division='none' but slot-B fields are populated. ` +
          `When a box is undivided, box_type_b / square_menu_group_id_b / aesthetic_image_id_b / header_override_b must all be null.`,
      )
    }
  } else if (division === 'horizontal' || division === 'vertical') {
    if (box.box_type_b == null) {
      errors.push(
        `Box ${box.position} has division='${division}' but box_type_b is not set. ` +
          `Divided boxes must specify a box_type for slot B.`,
      )
    }
    if (division === 'horizontal' && box.row_span < MIN_SPAN_FOR_DIVISION) {
      errors.push(
        `Box ${box.position} cannot be split horizontally with row_span=${box.row_span}. ` +
          `Horizontal division requires row_span >= ${MIN_SPAN_FOR_DIVISION}.`,
      )
    }
    if (division === 'vertical' && box.col_span < MIN_SPAN_FOR_DIVISION) {
      errors.push(
        `Box ${box.position} cannot be split vertically with col_span=${box.col_span}. ` +
          `Vertical division requires col_span >= ${MIN_SPAN_FOR_DIVISION}.`,
      )
    }
  } else {
    errors.push(
      `Box ${box.position} has invalid division='${String(division)}'. ` +
        `Must be one of: none, horizontal, vertical.`,
    )
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a full set of boxes against the grid. Returns one error string per
 * offending box (or pair, for overlaps, or per division-invariant violation).
 * Returns `{ ok: true }` only when the entire layout is valid.
 *
 * Why a list of errors rather than a single boolean: the editor surfaces the
 * messages back to the operator so they can fix all violations at once.
 *
 * Backward-compatible with phase 2 callers: `BoxDivisionFields` fields are
 * optional, so a caller passing plain `GridBox[]` continues to work — division
 * is treated as `'none'` and no `_b` fields are checked.
 */
export function validateBoxLayout(
  boxes: Array<GridBox & BoxDivisionFields>,
  grid: GridDims,
): ValidationResult {
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

  // Division-invariant + min-span guard (phase 2.5)
  for (const box of boxes) {
    const result = validateBoxDivision(box)
    if (!result.ok) errors.push(...result.errors)
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
