# KDS v3 — Phase 2.5 Verification Report

**Spec:** [MOK-154](https://linear.app/mokesai/issue/MOK-154/kds-v3-phase-25-box-division-single-split-per-box)
**Plan:** [.planning/kds-v3/PHASE-2.5-PLAN.md](./PHASE-2.5-PLAN.md)
**Branch:** `kds-v3-p2.5-box-division`
**Verified against:** cafe-pulse-dev (`ettmabcwfhidcpapphgm`), bigcafe tenant
**Verified on:** 2026-05-16

---

## Summary

All 7 plan tasks (T1–T7) complete. Box division (single split per box, 50/50 ratio, max one split) lands as a schema + admin-UX layer on top of phase 2. Phase 6 will consume the slot-rectangle algorithm frozen in the plan.

**Status: READY for PR `kds-v3-p2.5-box-division` → `kds-v3`** when the operator is ready to merge.

Note: the eventual `kds-v3` → `staging` PR opens only after all 7 phases land on the integration trunk; phase 2.5 is a sub-addition under phase 2 of seven.

---

## Acceptance walkthrough

Each MOK-154 acceptance criterion mapped to its evidence.

| # | Acceptance criterion | Evidence | Result |
|---|---|---|---|
| 1 | Migration adds 5 columns; existing rows unchanged (division='none', _b NULL) | T1 schema verification + 6-case CHECK corner battery + 8 existing phase-2 rows backfilled to `division='none'` with 0 stray `_b` | ✅ |
| 2 | Route validation enforces division invariants (POST + PUT) | T3 unit tests (10 division cases) + T5 integration tests #13, #14 (both 422 KDS_SCREEN_LAYOUT_INVALID with structured validation_errors) | ✅ |
| 3 | Editor lets operator toggle division on selected box | T4 + T6 #5-7 (manual on bigcafe — segmented control surfaces, min-span guard disables modes when span < 2) | ✅ |
| 4 | Position stability preserved across division toggle | T5 #15 (auto regression) + T6 #11 (manual drag-while-divided) | ✅ |
| 5 | Save and reload round-trip division state | T5 #10, #11 (auto round-trip) + T6 #8, #9 (manual reload after Top/Bottom and Left/Right) | ✅ |
| 6 | Integration tests cover lifecycle + invariant rejection | T5: 6 new cases extending the phase-2 suite (15/15 passing) | ✅ |
| 7 | Rollback drops the 5 new columns cleanly | T7 — see detail below | ✅ |

---

## CHECK-invariant 6-case corner battery (T1)

Executed against cafe-pulse-dev 2026-05-15 (during T1 commit). Each case inserts a single test row into a throwaway screen; outcome verifies the cross-column invariant fires (or stays out of the way) per design.

| # | division | box_type_b | _b extras populated | Expected | Result |
|---|---|---|---|---|---|
| 1 | `'none'` | NULL | none | PASS | ✅ PASS |
| 2 | `'none'` | `'menu_group'` | none | CHECK_VIOLATION | ✅ CHECK_VIOLATION |
| 3 | `'none'` | NULL | `header_override_b='foo'` | CHECK_VIOLATION | ✅ CHECK_VIOLATION |
| 4 | `'horizontal'` | `'menu_group'` | none | PASS | ✅ PASS |
| 5 | `'vertical'` | NULL | none | CHECK_VIOLATION | ✅ CHECK_VIOLATION |
| 6 | `'vertical'` | `'image_only'` | `header_override_b='bar'` | PASS | ✅ PASS |

NULL-semantics check holds because `division` is `NOT NULL DEFAULT 'none'` — disjuncts evaluate to TRUE/FALSE, never NULL.

---

## T7 rollback rehearsal detail

Executed 2026-05-16 against cafe-pulse-dev.

### Starting state (before rollback)
- 3 screens, 11 boxes (including 1 divided box from T6 manual walk)
- 5 phase-2.5 columns on `kds_grid_boxes`
- 3 phase-2.5 CHECK constraints
- 1 schema_migrations row for version `20260516025537`

### Step 1 — Execute PHASE-2.5-ROLLBACK.sql

`DROP CONSTRAINT IF EXISTS` × 3 (the cross-column invariant + 2 per-column enum checks), `DROP COLUMN IF EXISTS` × 5 (the new columns), `DELETE FROM schema_migrations` for our version. All in one transaction.

### Step 2 — Post-rollback verification

| Check | Expected | Actual |
|---|---|---|
| Phase-2.5 columns on `kds_grid_boxes` | 0 | 0 ✅ |
| Phase-2.5 CHECK constraints | 0 | 0 ✅ |
| `schema_migrations` row for `20260516025537` | 0 | 0 ✅ |
| Screen count preserved | 3 | 3 ✅ |
| Box count preserved | 11 | 11 ✅ |

Phase 2 schema and rows untouched. The 1 divided box's `division`/`_b` data was wiped along with the columns — expected and called out before execution; the rollback contract preserves geometry, not phase-2.5 specific state.

### Step 3 — Re-apply via `supabase db push`

```
Would push: 20260516025537_kds_v3_phase_2_5_box_division.sql
Applying migration 20260516025537_kds_v3_phase_2_5_box_division.sql...
NOTICE: constraint "kds_grid_boxes_division_check" does not exist, skipping
NOTICE: constraint "kds_grid_boxes_box_type_b_check" does not exist, skipping
NOTICE: constraint "kds_grid_boxes_division_slot_b_invariant" does not exist, skipping
Finished supabase db push.
```

| Check | Expected | Actual |
|---|---|---|
| Phase-2.5 columns | 5 | 5 ✅ |
| Phase-2.5 CHECK constraints | 3 | 3 ✅ |
| `schema_migrations` row for `20260516025537` | 1 | 1 ✅ |
| All boxes' `division` after re-apply | `'none'` | 11/11 = `'none'` ✅ |
| Rows with stray `_b` | 0 | 0 ✅ |

### Step 4 — Idempotency test

Re-executed the migration SQL a second time on top of the just-applied state (via direct SQL — `supabase db push` would have refused as "remote up to date" since the schema_migrations row already exists).

The migration's pattern is:
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`  → no-op when column already exists
- `ALTER TABLE … DROP CONSTRAINT IF EXISTS … ADD CONSTRAINT …` → drops the just-added constraint and re-adds an identical one

Result: zero errors, identical post-state (5 cols, 3 CHECKs, 11 rows with `division='none'`, 0 stray `_b`). Migration is genuinely idempotent.

---

## Test layer summary

| Layer | Coverage | Result |
|---|---|---|
| Layer 1 — Vitest unit tests (T3) | grid-validation: 13 new cases (validateBoxDivision corners + min-span guard + integrated validateBoxLayout) | 115/115 ✅ |
| Layer 1 — Vitest integration tests (T5) | tests/integration/kds-v3-screens-routes.test.ts extended with 6 cases mapping 1:1 to MOK-154 acceptance criteria | 15/15 ✅ |
| Layer 2 — Manual local-dev (T6) | Division toggle on selected box, both modes (Top/Bottom + Left/Right), save/reload round-trips, divided-box drag, divided-box resize, switch-to-none clears slot B | All 9 manual steps pass ✅ |
| Layer 3 — Rollback rehearsal (T7) | Full DROP + re-apply against cafe-pulse-dev + idempotency re-run | Clean ✅ |
| Layer 4 — Manual staging | n/a — KDS v3 isn't on staging yet (single staging PR after all 7 phases land per the branch model) | n/a |

---

## Slot-rectangle algorithm (frozen for phase 6)

Repeated from the plan for posterity — phase 6's public renderer consumes this verbatim:

Given a box at `(row_start, col_start, row_span, col_span)` with `division`:
- `division = 'none'` → single slot = the whole box.
- `division = 'horizontal'` (top/bottom split):
  - Slot A: `(row_start, col_start, ceil(row_span/2), col_span)`
  - Slot B: `(row_start + ceil(row_span/2), col_start, floor(row_span/2), col_span)`
- `division = 'vertical'` (left/right split):
  - Slot A: `(row_start, col_start, row_span, ceil(col_span/2))`
  - Slot B: `(row_start, col_start + ceil(col_span/2), row_span, floor(col_span/2))`

Slot A uses `box_type / square_menu_group_id / aesthetic_image_id / header_override`. Slot B uses the `_b` variants.

Min-span guard (route-layer): `'horizontal'` requires `row_span >= 2`; `'vertical'` requires `col_span >= 2`. Ensures both slots are at least 1 cell tall/wide.

---

## Commit log on `kds-v3-p2.5-box-division`

Tip:

```
<verification commit added by this doc>
71891ae test(kds-v3): MOK-154 T5 — integration tests for box division
b8dfe14 feat(kds-v3): MOK-154 T4 — editor UI for box division
5f236dc feat(kds-v3): MOK-154 T3 — validation + PUT route for box division
ea98d65 chore(kds-v3): MOK-154 T2 — phase 2.5 rollback SQL
f6fa57e feat(kds-v3): MOK-154 T1 — phase 2.5 schema (box division)
bac69f9 plan(kds-v3): MOK-154 phase 2.5 — box division (single split per box)
```

---

## Sign-off

- **Author:** Jerry McCommas (operator-in-the-loop verification on 2026-05-16)
- **T7 rehearsal executed:** Claude (paired session on 2026-05-16)
- **Status:** Ready for sub-PR to `kds-v3` integration trunk
- **Next:** open PR `kds-v3-p2.5-box-division` → `kds-v3`; begin phase 3 spec when paired bandwidth allows.
