# KDS v3 — Phase 2: Screen + grid schema + screen designer admin UI

**Spec:** [MOK-152](https://linear.app/mokesai/issue/MOK-152)
**Branch:** `kds-v3-p2-screen-designer` → `kds-v3` (integration) → `staging` → `main`
**Status:** Planning

## Goal
Operator can author up to 2 KDS screens per tenant. Each screen has a configurable grid; boxes are placed by drag-resize within the grid. Boxes carry a stable position number and a `box_type` discriminator. Box content (menu group binding, aesthetic image) is deferred to phases 3 / 4 — phase 2 ships placeholder boxes only.

## Library decision: `react-grid-layout`

Adopting [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) for the editor surface. Reasons:

- Built for exactly this UX shape (CSS-grid drag-resize editor).
- Built-in collision avoidance, snap-to-grid, bounded resize.
- Stable, widely used (Grafana, others).
- Avoids ~500-1000 lines of custom drag/resize math.

Trade-off: ~50KB gzipped. Acceptable — the editor only ships in admin bundles. Alternatives (react-rnd, custom HTML5 drag) considered and rejected: react-rnd doesn't snap to a grid as cleanly, custom is too much for one phase.

If react-grid-layout proves unsuitable in T6 (e.g. hard to integrate with our position-number stability requirement), fall back to a small custom implementation. Decision point at end of T6 implementation, not earlier.

## Task breakdown (each task = one commit unless noted)

### T1 — Forward migration + RLS
**Files:**
- `supabase/migrations/<timestamp>_kds_v3_phase_2_screen_designer.sql`

**Scope:**
- Create `kds_screens` and `kds_grid_boxes` per the MOK-152 schema.
- CHECK constraints on grid_rows / grid_cols (1..12), theme enum, box_type enum, position ≥ 1, spans ≥ 1.
- UNIQUE (tenant_id, name) on screens; UNIQUE (screen_id, position) on boxes.
- FK (screen_id) → kds_screens(id) ON DELETE CASCADE.
- Indexes per spec: `(tenant_id)` on screens, `(tenant_id, screen_id, position)` on boxes.
- Full RLS pattern: `tenant_staff_select_*`, `tenant_admin_{insert,update,delete}_*`.
- `tenant_id` NOT NULL with no default.

**Acceptance:**
- `npm run db:migrate` against cafe-pulse-dev applies cleanly.
- Schema visible in Supabase Studio with correct columns / constraints / indexes / FK / RLS.
- INSERT without tenant_id raises NOT NULL violation.
- INSERT into kds_screens with grid_rows=20 raises CHECK violation.

### T2 — Rollback SQL
**Files:**
- `.planning/kds-v3/PHASE-2-ROLLBACK.sql` (separate file from phase 1's `ROLLBACK.sql`)

**Scope:**
- DROP POLICY for each policy created in T1 (8 total: 4 per table × 2 tables).
- DROP TABLE in dependency order: `kds_grid_boxes` → `kds_screens`.
- Remove migration entry from `supabase_migrations.schema_migrations`.

**Acceptance:**
- Lives outside `supabase/migrations/`.
- Header documents when to run + what state results.
- Rehearsed in T9.

### T3 — Server-side validation + overlap detection helper
**Files:**
- `src/lib/kds/grid-validation.ts` (new)
- `src/lib/kds/__tests__/grid-validation.test.ts` (new)

**Scope:**
Pure-function helpers:

- `boxFitsInGrid(box, grid): boolean` — box's row_start + row_span ≤ rows + 1; same for cols.
- `boxesOverlap(a, b): boolean` — rectangle overlap on the grid plane.
- `validateBoxLayout(boxes, grid): ValidationResult` — returns `{ ok: true }` or `{ ok: false, errors: string[] }` with one error per offending box.
- `nextAvailablePosition(boxes): number` — `Math.max(...boxes.position) + 1`, or 1 if empty. Position numbers are stable; this is only for new boxes.
- `cellsOccupied(boxes): Set<string>` — set of "row,col" strings, used by the editor to pick the next free 1×1 spot when adding a box.

**Acceptance:**
- Vitest unit tests cover: fits-in-grid (within / overflow row / overflow col), overlap (none / partial / contained), validateBoxLayout aggregate (all-valid / one-overlap / two-overlaps), nextAvailablePosition (empty list / gap-tolerant — explicitly NOT renumbering), cellsOccupied.

### T4 — Admin routes (CRUD)
**Files:**
- `src/app/api/admin/kds-v3/screens/route.ts` (new) — `GET`, `POST`
- `src/app/api/admin/kds-v3/screens/[id]/route.ts` (new) — `GET`, `PUT`, `DELETE`

**Scope:**

- `GET /screens` — list current tenant's screens with `box_count` and `theme`. No box detail.
- `POST /screens` — create. Body: `{ name, grid_rows, grid_cols, theme }`. Validates: name not empty, dims in 1..12, theme in enum, count < `MAX_KDS_SCREENS_PER_TENANT (=2)`. Returns 422 with code `KDS_SCREEN_LIMIT_REACHED` when at cap.
- `GET /screens/[id]` — fetch one screen + all its boxes. 404 if not found or wrong tenant.
- `PUT /screens/[id]` — atomic update of screen + boxes. Body: `{ name, grid_rows, grid_cols, theme, boxes: [{ position?, row_start, col_start, row_span, col_span, box_type, header_override? }, …] }`.
  - For each box: if `position` provided, treat as update of that position; if not, treat as new (assign next available).
  - Server validates layout via T3 helpers BEFORE writing.
  - On error: 422 with structured `validation_errors: string[]`.
  - Implementation: DELETE all boxes for screen, INSERT replacement set, all in one Postgres transaction (via `supabase.rpc` to a stored function, OR via two-step delete-then-insert wrapped in a try/catch with manual cleanup on partial failure).
  - **Stable position numbers across edits**: if the operator just moves an existing box, its `position` stays the same; if they delete one, the surviving boxes keep their numbers. Adding a new box assigns `max(existing.position) + 1`.
- `DELETE /screens/[id]` — deletes the screen; FK cascade removes its boxes.

All routes:
- Require admin auth (`requireAdminAuth`).
- Use `getCurrentTenantId()` for tenant scoping; reject implicit cross-tenant access.

**Acceptance:**
- Routes follow the existing admin route pattern (per `src/app/api/CLAUDE.md`).
- All paths return JSON; errors include both `error` and `code` fields.
- Hand-tested via `curl` in T8.

### T5 — Admin UI scaffold + list page
**Files:**
- `src/app/admin/(kds-v3)/layout.tsx` (new — minimal shell, sidebar nav entry under "KDS v3")
- `src/app/admin/(kds-v3)/screens/page.tsx` (new — list page)
- `src/components/admin/kds-v3/ScreensList.tsx` (new — client component with the actual list rendering + add/edit/delete actions)

**Scope:**
- New route group `(kds-v3)` so v2 (`(kds)`) keeps running undisturbed.
- Sidebar nav entry "KDS v3 (beta)" linking to `/admin/kds-v3/screens`.
- List view: cards or table with `name`, `grid_rows × grid_cols`, `theme`, box count.
- "Add Screen" button (disabled with tooltip when count = 2).
- Per-row actions: Edit (→ edit page), Delete (with confirm).

**Acceptance:**
- Page renders against a tenant with 0 / 1 / 2 screens correctly.
- Delete shows confirm dialog and refetches on success.
- Add button correctly disabled at 2 screens.

### T6 — Create/edit screen page + grid editor
**Files:**
- `src/app/admin/(kds-v3)/screens/new/page.tsx` (new)
- `src/app/admin/(kds-v3)/screens/[id]/edit/page.tsx` (new)
- `src/components/admin/kds-v3/ScreenForm.tsx` (new — client component, shared between new + edit)
- `src/components/admin/kds-v3/GridEditor.tsx` (new — drag-resize editor wrapping react-grid-layout)
- `package.json` — add `react-grid-layout` + types

**Scope:**
- ScreenForm: name input, grid dims (rows + cols 1..12 selectors), theme picker. On dim changes, the editor re-renders and existing boxes outside the new bounds get flagged.
- GridEditor: react-grid-layout with `cols={grid_cols}`, `rowHeight=<computed>`, draggable + resizable, snap to grid.
- Each rendered box shows a prominent **position number** (e.g. "Box 3") and a size badge (small for ≤2 cells, medium ≤6, large >6) — the badge is a UX affordance only, not stored.
- Per-box inline controls: `box_type` dropdown (menu_group | image_only) and a delete button. Content selectors are present but disabled with a "configured in phase 3" / "phase 4" hint.
- Add Box button: places a 1×1 box at the next free cell; uses `nextAvailablePosition` from T3.
- Save button: calls T3's `validateBoxLayout` client-side first; if ok, POSTs to `PUT /api/admin/kds-v3/screens/[id]`. Server validation is the source of truth — client-side is for UX feedback.

**Acceptance:**
- Manual local-dev: create a screen, drag a box, resize, save, reload — state persists.
- Position numbers stable across all edit operations (asserted in T7).
- Invalid layouts (overlap or out-of-bounds) are rejected with a clear error message.
- The library-decision fallback path is documented if react-grid-layout integration proves problematic during implementation.

### T7 — Vitest integration tests
**Files:**
- `tests/integration/kds-v3-screens-routes.test.ts` (new — admin route coverage + tenant isolation)
- `src/lib/kds/__tests__/grid-validation.test.ts` (already from T3)

**Scope (one test per acceptance criterion in MOK-152):**
1. POST /screens — creates a screen for the tenant.
2. POST /screens — returns 422 KDS_SCREEN_LIMIT_REACHED at the cap of 2.
3. GET /screens — lists the tenant's screens with box counts.
4. GET /screens/[id] — returns screen + its boxes; 404 cross-tenant.
5. PUT /screens/[id] — replaces boxes atomically; surviving box positions stable across the edit (regression test for position-stability).
6. PUT /screens/[id] — rejects 422 when boxes overlap.
7. PUT /screens/[id] — rejects 422 when a box exceeds grid bounds.
8. DELETE /screens/[id] — cascade deletes boxes.
9. Tenant isolation — tenant A cannot mutate tenant B's screens (mirror MOK-107 class).

Mirrors the existing `admin-suppliers-isolation.test.ts` integration pattern.

**Acceptance:**
- `npm run test:integration -- kds-v3-screens-routes` all green.
- `npm run lint`, `npm run build`, `npm run test:unit` clean (T3 unit tests run via test:unit).

### T8 — Manual end-to-end against bigcafe
Same shape as phase 1 T8: walk through the spec's acceptance criteria with the dev server.

**Procedure:**
1. Apply migration via `npm run db:migrate`.
2. Sign in to `http://bigcafe.localhost:3000` as a bigcafe admin.
3. Navigate to `/admin/kds-v3/screens`.
4. Create screen "Drinks" (4 rows × 6 cols, warm theme).
5. Add 3 boxes; drag/resize; verify position numbers (1, 2, 3) stable across edits.
6. Save; reload page; confirm state persists with same positions.
7. Try creating a 3rd screen — confirm "Add Screen" is disabled and direct API POST returns 422.
8. Delete a box, confirm surviving boxes keep their position numbers (this is the regression check).
9. Delete a screen — confirm box rows are gone via Supabase Studio.

**Acceptance:**
- All 9 manual steps pass.
- Captured in `.planning/kds-v3/PHASE-2-VERIFICATION.md` (T9).

### T9 — Rollback rehearsal + verification report
**Files:**
- `.planning/kds-v3/PHASE-2-VERIFICATION.md` (new)

**Procedure:**
1. With T8 data in place, execute `.planning/kds-v3/PHASE-2-ROLLBACK.sql` against cafe-pulse-dev.
2. Confirm: 0 phase-2 tables, 0 phase-2 policies, 0 migration entries for the phase-2 timestamp.
3. Re-run `npm run db:migrate` — confirm idempotent re-apply.
4. Re-run a subset of T8 steps to confirm identical end-state.
5. Document run with timestamps + sign-off in PHASE-2-VERIFICATION.md, mirroring phase 1's report shape.

**Acceptance:**
- Rollback SQL produces clean state on first try (or iterate T2 until it does).
- Migration re-apply is idempotent.
- Verification doc filled in with all checkboxes ✓.

## Dependencies / ordering rationale
- T1 must precede T4-T9 (everything reads/writes the new tables).
- T2 should land alongside T1 (rollback paired with forward migration).
- T3 (validation helpers) must precede T4 (routes use them) and T6 (UI uses them client-side).
- T4 must precede T5 + T6 (UI consumes the routes).
- T5 must precede T6 (list page is the entry point to the editor).
- T7 needs T3 + T4 + T6.
- T8 + T9 are end-of-phase, after T1-T7 land.

## Risk areas
- **react-grid-layout integration with stable position numbers.** The library uses a `i` (id) string per item — we'll set `i = position.toString()` and never reassign on resize/move. Risk: an upstream library quirk forces renumbering; if that happens, fall back to a small custom drag-resize layer at the cost of one extra implementation day.
- **Overlap detection consistency between client and server.** Client uses T3 helpers for UX feedback; server uses the same helpers for validation. Single source of truth — but the client could drift if we accidentally fork the logic. Mitigation: import from `src/lib/kds/grid-validation.ts` on both sides; integration test asserts the server's 422 fires for the same shapes the client would block.
- **Transactional update of screen + boxes** in PUT /screens/[id]. If we use plain delete-then-insert, a partial failure leaves the operator's screen with no boxes. Mitigation: prefer a Postgres transaction via `supabase.rpc` to a function that performs the delete + insert atomically. Fall-back: explicit ordering with try/catch and error-state recovery, but flag as a follow-up.
- **CSS grid measurement / responsiveness.** Editor needs to compute `rowHeight` based on container width × grid_cols ratio. Risk: layout looks wrong on first render. Mitigation: use `react-grid-layout`'s `WidthProvider` HOC (already supported); render once on mount with a useResizeObserver fallback.
- **Migration timestamp drift on the long-lived branch.** Shared concern with phase 1 — staging can land migrations while we're working. Mitigation: rebase from `kds-v3` (and indirectly from `staging`) before merging the phase 2 PR.

## Verification checkpoints

| MOK-152 acceptance | Verified by |
|---|---|
| Migration creates 2 tables w/ RLS, FKs, indexes; tenant_id NOT NULL | T1 + manual inspection |
| Operator creates screen with name/dims/theme | T6 + T8 #4 |
| Operator edits a screen | T6 + T8 #4-6 |
| Operator adds, drags, resizes a box | T6 + T8 #5 |
| Box position numbers stable across edits | T7 #5 (auto) + T8 #8 (manual) |
| Resize/move constrained to grid bounds + no overlap | T7 #6, #7 (auto) + react-grid-layout (UX) |
| Operator can delete a box; positions unchanged | T7 #5 + T8 #8 |
| Cascade delete on screen → boxes gone | T7 #8 + T8 #9 |
| 3rd screen returns 422 KDS_SCREEN_LIMIT_REACHED | T7 #2 + T8 #7 |
| Tenant isolation | T7 #9 |
| Integration tests | T7 |
| Box-content fields nullable in phase 2 | T1 schema + T6 UI hint |

## Out of scope (per MOK-152)
- Box content (menu group binding) — phase 3
- Aesthetic image library — phase 4
- Per-item display overrides — phase 5
- Public KDS render — phase 6
- v2 migration / cutover — phase 7
- Freeform canvas editor — possible follow-up after phase 2 review

## Rollback contract
2 isolated tables, no FKs from existing schema, no data migration. Phase 2 rollback SQL at `.planning/kds-v3/PHASE-2-ROLLBACK.sql` (T2). Validated by T9 before merge to `kds-v3`.

Rollback window remains open through phases 3-6 (tables exist but aren't user-facing). After phase 7 cutover, rollback becomes a separate decision.

## Done criteria for phase 2
- All T1-T9 commits on `kds-v3-p2-screen-designer`, each with green CI.
- `PHASE-2-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-p2-screen-designer` → `kds-v3` opened, reviewed, merged.
- Phase 3 spec drafting begins (per just-in-time spec cadence).
