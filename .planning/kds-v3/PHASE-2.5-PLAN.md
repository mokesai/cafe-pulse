# KDS v3 — Phase 2.5: Box division (single split per box)

**Spec:** [MOK-154](https://linear.app/mokesai/issue/MOK-154/kds-v3-phase-25-box-division-single-split-per-box)
**Branch:** `kds-v3-p2.5-box-division` → `kds-v3` (integration trunk) → `staging` (post-all-phases) → `main`
**Status:** Planning

## Goal

Each `kds_grid_boxes` row optionally splits into two content slots (top/bottom or left/right). Each slot picks its own `box_type`. 50/50 ratio fixed for v1; max 1 split per box. Editor lets the operator toggle division on the selected box and configure both slots independently; visual preview shows a thin divider. The schema + admin UX land in phase 2.5; the public renderer that consumes the new slot shape lands in phase 6.

## Task breakdown (each task = one commit unless noted)

### T1 — Forward migration: division + slot-B columns
**Files:**
- `supabase/migrations/<CLI-generated-timestamp>_kds_v3_phase_2_5_box_division.sql`

Use `supabase migration new kds_v3_phase_2_5_box_division` to author (per the always-CLI rule). Then write SQL into the generated file and `supabase db push` to apply.

**Scope:**
Add 5 columns to `kds_grid_boxes`:

| Column | Type | CHECK | Nullable |
|---|---|---|---|
| `division` | text | `IN ('none','horizontal','vertical')`, default `'none'` | NOT NULL |
| `box_type_b` | text | `IN ('menu_group','image_only')` | nullable |
| `square_menu_group_id_b` | text | — | nullable |
| `aesthetic_image_id_b` | uuid | — | nullable |
| `header_override_b` | text | — | nullable |

Plus a **cross-column invariant CHECK constraint**:

```sql
CHECK (
  (division = 'none'
   AND box_type_b IS NULL
   AND square_menu_group_id_b IS NULL
   AND aesthetic_image_id_b IS NULL
   AND header_override_b IS NULL)
  OR
  (division IN ('horizontal','vertical')
   AND box_type_b IS NOT NULL)
)
```

Existing rows: `division` backfilled to `'none'` (default), `_b` fields NULL. No data migration needed.

**Acceptance — exhaustive CHECK-corner battery:**

After `supabase db push` against cafe-pulse-dev applies cleanly, run a 6-case acceptance battery via direct SQL (each insert against a throwaway tenant; cleanup after). Every result is asserted before T3 starts:

| # | division | box_type_b | _b extras populated | Expected | Why |
|---|---|---|---|---|---|
| 1 | `'none'` | NULL | none | ✅ pass | undivided + clean |
| 2 | `'none'` | `'menu_group'` | none | ❌ CHECK violation | undivided must clear b-side |
| 3 | `'none'` | NULL | `header_override_b='foo'` | ❌ CHECK violation | any stray _b field is forbidden |
| 4 | `'horizontal'` | `'menu_group'` | none | ✅ pass | divided requires box_type_b |
| 5 | `'vertical'` | NULL | none | ❌ CHECK violation | divided without box_type_b |
| 6 | `'vertical'` | `'image_only'` | `header_override_b='bar'` | ✅ pass | b-side may carry optional fields |

Plus:
- Existing phase 2 rows unchanged (verified via row-count + spot-check `division` defaults to `'none'`).
- `\d+ public.kds_grid_boxes` shows the 5 new columns with the right types/nullability.

### T2 — Rollback SQL
**Files:**
- `.planning/kds-v3/PHASE-2.5-ROLLBACK.sql`

**Scope:**
- `ALTER TABLE public.kds_grid_boxes DROP COLUMN IF EXISTS …` for each of the 5 new columns (CASCADE handles any indexes/constraints attached).
- `DELETE FROM supabase_migrations.schema_migrations WHERE version = '<phase-2.5-version>'`.

**Acceptance:**
- Lives outside `supabase/migrations/`.
- Header documents when to run + what state results.
- Rehearsed in T7.

### T3 — Validation helpers + route validation
**Files:**
- `src/lib/kds/grid-validation.ts` (extend with division-invariant check + min-span-on-divided-axis check)
- `src/lib/kds/__tests__/grid-validation.test.ts` (extend with division cases)
- `src/app/api/admin/kds-v3/screens/[id]/route.ts` (PUT handler: validate the 5 new fields + division invariants)
- `src/app/api/admin/kds-v3/screens/route.ts` — likely unchanged (POST doesn't accept boxes yet)

**Scope:**
- Add `validateBoxDivision(box): { ok: true } | { ok: false, errors: string[] }` helper.
- Extend `validateBoxLayout` to surface division-invariant errors per-box.
- **Min-span-on-divided-axis rule** (avoids visually broken sub-1-row slots):
  - `division = 'horizontal'` requires `row_span >= 2`
  - `division = 'vertical'` requires `col_span >= 2`
  - Enforced at the route layer only (not DB CHECK) because it's a UX guard, not a data-integrity invariant — DB stays permissive in case we relax later.
- Update `PutBoxInput` type + PUT route to accept the 5 new fields and run the division validator alongside the existing layout check.
- Error code: reuse the existing `KDS_SCREEN_LAYOUT_INVALID` (422) — `validation_errors[]` carries the human-readable division-specific messages, which is enough for the editor to surface. (Decision recorded T3 commit: a separate code added complexity without UX benefit.)
- Defense-in-depth: server still relies on the DB CHECK constraint as the source of truth, but surfaces a friendly message for the editor.

**Acceptance:**
- Vitest unit tests cover:
  - undivided+empty-b (valid)
  - divided+full-b (valid)
  - divided+missing-box_type_b (invalid)
  - undivided+stray-b (invalid)
  - division='horizontal' + row_span=1 (invalid — min-span guard)
  - division='vertical' + col_span=1 (invalid — min-span guard)
  - division='horizontal' + row_span=2 (valid — min-span boundary)

### T4 — Editor UI: division control in selected-box panel + visual divider
**Files:**
- `src/components/admin/kds-v3/GridEditor.tsx` (visual divider in the rendered box)
- `src/components/admin/kds-v3/ScreenForm.tsx` (selected-box panel reshape) — possibly extract a small `SelectedBoxPanel` component if it grows past ~60 lines.

**Scope:**
- Add a segmented control to the selected-box panel: **None** | **Top/Bottom** | **Left/Right**.
- When division != 'none', the panel splits into two columns labeled "Top/Left (slot A)" and "Bottom/Right (slot B)". Each column has its own `box_type` selector. Content selectors stay disabled with phase-3/4 hints.
- In the grid preview, divided boxes render a 1px divider line (`border-r` for vertical, `border-b` for horizontal) at the midpoint. Each half labels its position as `1a` / `1b` and shows the half's size hint.
- Toggling from divided → undivided wipes the `_b` fields (sends nulls to the server).
- Toggling from undivided → divided initializes `box_type_b = 'menu_group'` (parity with the existing default for slot A).

**Acceptance:**
- Manual local-dev: toggle division on a selected box; both slot types editable; saving + reloading round-trips the division state.
- Visual divider visible and proportional regardless of box size or grid resolution.
- Invariant violations rejected by server show in the existing error banner above the editor.

### T5 — Vitest integration tests
**Files:**
- `tests/integration/kds-v3-screens-routes.test.ts` (extend; do not duplicate file)

**New cases (1:1 with MOK-154 acceptance criteria):**
1. PUT — divided box round-trips correctly: send `division='vertical'` + `box_type_b='image_only'`, then GET → fields persist.
2. PUT — undivided → divided lifecycle: existing box `division='none'`, update to `division='horizontal'` + slot-B fields → saved.
3. PUT — divided → undivided clears _b fields: send `division='none'` on a previously-divided box; verify all `_b` columns are NULL in the row.
4. PUT — invariant rejection (divided but missing `box_type_b`): expect 422 + `KDS_SCREEN_BOX_DIVISION_INVALID`.
5. PUT — invariant rejection (undivided but stray `_b` set): expect 422.
6. Position stability across division toggle (regression: ensure position number doesn't change when toggling).

**Acceptance:**
- `npm run test:integration -- kds-v3-screens-routes` all green (existing 9 + new 6 = 15 cases).
- `npm run test:unit`, `npm run lint`, `npm run build` clean.

### T6 — Manual end-to-end against bigcafe
Same shape as phase 2 T8.

**Procedure:**
1. Run `supabase db push` to apply T1 migration to cafe-pulse-dev (now that the CLI path is clean post-MOK-153).
2. Sign in to `http://bigcafe.localhost:3000` as a bigcafe admin.
3. Navigate to `/admin/kds-v3/screens`.
4. Open an existing screen from phase 2 (or create new). Click a box → panel appears below.
5. Toggle division to **Top/Bottom**, set slot-B type to `image_only`. Save. Reload. Confirm divider rendered, both halves labeled `Na` / `Nb`, both slot types persisted.
6. Toggle division to **Left/Right**, save, reload. Confirm orientation swapped, content persisted.
7. Toggle back to **None**. Save, reload. Confirm divider gone, `_b` fields nulled (verify via Supabase Studio).
8. Drag the divided box to a different cell. Confirm position number stable + division preserved.
9. Resize the divided box. Confirm divider proportional, no overlap into neighbors.

**Acceptance:**
- All 9 manual steps pass.
- Captured in `.planning/kds-v3/PHASE-2.5-VERIFICATION.md` (T7).

### T7 — Rollback rehearsal + verification report
**Files:**
- `.planning/kds-v3/PHASE-2.5-VERIFICATION.md` (new)

**Procedure:**
1. With T6 data in place, execute `.planning/kds-v3/PHASE-2.5-ROLLBACK.sql` against cafe-pulse-dev.
2. Confirm: 0 phase-2.5 columns on `kds_grid_boxes`, 0 schema_migrations entries for the phase-2.5 version.
3. Confirm phase 2 tables + rows untouched (regression check: `kds_screens` count + `kds_grid_boxes` count unchanged minus the `_b` columns).
4. Re-run `supabase db push` to confirm idempotent re-apply.
5. Document run with timestamps + sign-off in PHASE-2.5-VERIFICATION.md, mirroring phase 2's report shape.

**Acceptance:**
- Rollback SQL produces clean state on first try.
- Migration re-apply is idempotent.
- Verification doc filled in with all checkboxes ✓.

## Dependencies / ordering rationale
- T1 must precede T3, T4, T5 (everything reads/writes the new columns).
- T2 should land alongside T1 (rollback paired with forward migration).
- T3 must precede T4 (UI consumes the validator client-side and the route server-side).
- T4 must precede T6 (manual walk needs the editor).
- T5 needs T3 + T4 (validates the route + editor's round-trip).
- T6 + T7 are end-of-phase, after T1-T5 land.

## Risk areas

### 1. Cross-column CHECK constraint correctness (HIGH — mitigated by exhaustive battery)

Postgres CHECK constraints with multi-column logic are easy to get wrong on NULL semantics. The constraint we're shipping is:

```sql
CHECK (
  (division = 'none'
   AND box_type_b IS NULL
   AND square_menu_group_id_b IS NULL
   AND aesthetic_image_id_b IS NULL
   AND header_override_b IS NULL)
  OR
  (division IN ('horizontal','vertical')
   AND box_type_b IS NOT NULL)
)
```

NULL analysis: `division` is `NOT NULL DEFAULT 'none'`, so the disjuncts evaluate deterministically (TRUE/FALSE; never NULL). The 6-case battery in T1 acceptance hits every corner — gate progress to T3 on all 6 results matching.

### 2. Phase 6 renderer coupling (HIGH — mitigated by writing the spec now)

Phase 2.5 commits to a slot shape that phase 6 inherits. To prevent surprises later:

- **Slot-rectangle algorithm** (frozen here; phase 6 consumes verbatim):

  Given a box at `(row_start, col_start, row_span, col_span)` with `division`:
  - `division = 'none'`: single slot = the whole box.
  - `division = 'horizontal'` (top/bottom split):
    - Slot A: `(row_start, col_start, ceil(row_span/2), col_span)`
    - Slot B: `(row_start + ceil(row_span/2), col_start, floor(row_span/2), col_span)`
  - `division = 'vertical'` (left/right split):
    - Slot A: `(row_start, col_start, row_span, ceil(col_span/2))`
    - Slot B: `(row_start, col_start + ceil(col_span/2), row_span, floor(col_span/2))`

  Slot A uses `box_type / square_menu_group_id / aesthetic_image_id / header_override`. Slot B uses the `_b` variants.

- **Min-span-on-divided-axis guard** (route-layer validation in T3): `division='horizontal'` requires `row_span >= 2`; `division='vertical'` requires `col_span >= 2`. With even spans the split is symmetric; with odd spans slot A gets the bigger half by 1 cell (deterministic via `ceil`). This eliminates the "1-row box split horizontally → both slots vanish" failure mode that would otherwise surface in phase 6.

- **Editor preview matches phase-6 math.** The visual divider in T4 is drawn at the same `ceil(span/2)` boundary as the algorithm above, so what the operator sees in the editor is what the renderer will produce.

If phase 6 needs richer slot metadata (e.g. per-slot styling), it lands as a separate follow-up — phase 2.5 deliberately ships the minimum schema that the renderer needs.

### 3. Editor state machine on division toggle (LOW — pinned by tests)

Switching between division modes needs to keep slot-B fields consistent. React's batched state updates inside a single event handler eliminate the race concern at the React layer; integration test #3 (divided → undivided clears `_b` fields) pins the server-side behavior, which is the actual source of truth. Treat this as routine, not a risk gate.

### 4. CLI path discipline (LOW — enforced by process)

Per the MOK-153 going-forward rule, T1 is authored via `supabase migration new` and applied via `supabase db push`. Not `mcp__supabase-*__apply_migration` or raw SQL. T1 isn't done until `supabase db push --dry-run` reports zero drift.

## Verification checkpoints

| MOK-154 acceptance | Verified by |
|---|---|
| Migration adds 5 columns; existing rows unchanged | T1 manual inspection + post-apply row count |
| Route validation enforces division invariants | T3 unit tests + T5 integration tests #4, #5 |
| Editor lets operator toggle division on selected box | T4 + T6 #5-7 |
| Position stability preserved across division toggle | T5 #6 (auto) + T6 #8 (manual) |
| Save / reload round-trips division state | T5 #1, #2 + T6 #5-7 |
| Integration tests cover lifecycle + invariant rejection | T5 |
| Rollback drops the 5 new columns cleanly | T7 |

## Out of scope (per MOK-154)
- Configurable split ratio (50/50 fixed for v1)
- Nested splits (max 1 per box)
- Phase 3 content binding (menu group)
- Phase 4 aesthetic image library
- Phase 6 public renderer for divided boxes

## Rollback contract
Schema change is column additions only (no data migration, no FK changes). Phase 2.5 rollback drops the 5 columns; phase 2 schema and existing phase 2 data are untouched. Validated by T7 before merge to `kds-v3`.

Rollback window remains open through phases 3-6 (columns exist but aren't user-facing for slot B beyond the schema-and-editor scaffolding here). After phase 7 cutover, rollback becomes a separate decision.

## Done criteria for phase 2.5
- All T1-T7 commits on `kds-v3-p2.5-box-division`, each with green CI.
- `PHASE-2.5-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-p2.5-box-division` → `kds-v3` opened, reviewed, merged.
- Phase 3 spec drafting begins (per just-in-time spec cadence).
