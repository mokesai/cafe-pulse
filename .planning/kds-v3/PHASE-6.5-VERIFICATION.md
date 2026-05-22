# KDS v3 — Phase 6.5 verification report

**Spec:** [MOK-159](https://linear.app/mokesai/issue/MOK-159)
**Plan:** [.planning/kds-v3/PHASE-6.5-PLAN.md](./PHASE-6.5-PLAN.md)
**Branch:** `kds-v3-p6.5-publish`
**Verified against:** cafe-pulse-dev (`ettmabcwfhidcpapphgm`)
**Verified on:** 2026-05-20

---

## Summary

Phase 6.5 ships the draft / published workflow that closes the loop between admin iteration and TV display. Today the operator can iterate freely on a draft, preview to their satisfaction, and explicitly publish when ready. Pi devices read only the published snapshot — the wall is never affected by an in-progress edit.

Plus: operator-pickable variation emphasis (replacing the hardcoded `Grande/Medium` regex) and the screens-list "Unpublished changes" pill so the operator can see at a glance which screens have pending changes.

- Two snapshot tables (`kds_published_screens` + `kds_published_grid_boxes`) created via `CREATE TABLE LIKE (INCLUDING ALL)`, with RLS + FKs applied explicitly. screen_id → published_screens ON DELETE CASCADE; aesthetic_image refs → live image library SET NULL.
- Two PL/pgSQL functions for atomic publish + discard. Publish returns a `{added, changed, removed}` diff summary for the confirm dialog.
- `resolveScreenForRender(supabase, tenantId, screenId, { source: 'published' | 'draft' })`. Pi route reads `'published'`, admin preview reads `'draft'`. All downstream resolution (overrides, hidden-from-KDS, signed URLs, sort order, Square data) unchanged across sources.
- Editor header: PublishStatusBadge (amber "Unpublished changes" / gray "Up to date"), Publish button (primary, confirm dialog with diff), Discard button (outlined, confirm dialog). Both disabled appropriately on state.
- Screens-list: same PublishStatusBadge per row, computed via batched `published_at` query joined in JS.
- Variation emphasis: two-column tri-state design (`emphasized_variation_name` text NULL + `emphasized_variation_explicit_none` boolean). Auto / Picked / None. Slot-B mirrors gated by `kds_grid_boxes_emphasized_variation_b_gated` CHECK.

---

## Coverage map: MOK-159 acceptance → evidence

| MOK-159 acceptance | Evidence | Status |
|---|---|---|
| Migration creates snapshot tables + constraints + RLS + defensive copy | T0 (commit `59c40a9`) | ✅ |
| `draft_updated_at` ticks on save; `published_at` ticks on publish | T0 + T2 + T4 (commits `59c40a9`, `db4d7c5`, `dacc736`) | ✅ |
| Publish route + diff summary | T2 (commit `db4d7c5`) | ✅ |
| Discard-draft route | T2 (commit `db4d7c5`) | ✅ |
| `resolveScreenForRender` source-selection | T3 (commit `1b7c7c0`) | ✅ |
| Pi reads published; admin reads draft | T3 (commit `1b7c7c0`) | ✅ |
| Publish button + confirm + diff | T4 (commit `dacc736`) | ✅ |
| Discard button + confirm | T4 (commit `dacc736`) | ✅ |
| Per-screen "Unpublished changes" pill | T4 + T6 (commits `dacc736`, `d442bcb`) | ✅ |
| Emphasized-variation columns + editor + renderer | T0 + T5 (commits `59c40a9`, `e3f8eec`) | ✅ |
| Integration tests | T7 (commit `952edef`) | ✅ |
| Render-fetch source-selection tested | T7 case #6 | ✅ |
| Rollback clean | T8 (this report) | ✅ |

---

## T8 — Rollback rehearsal (executed 2026-05-20)

### Pre-rollback snapshot

| Metric | Value |
|---|---|
| Snapshot tables (kds_published_screens, kds_published_grid_boxes) | 2 |
| `kds_screens.draft_updated_at` column | 1 |
| Emphasis columns on `kds_grid_boxes` | 4 |
| `schema_migrations` rows for phase 6.5 (20260520125705, 20260520130424) | 2 |
| PL/pgSQL functions (publish_kds_screen, discard_kds_screen_draft) | 2 |
| `kds_screens` rows (draft) | 4 |
| `kds_published_screens` rows | 7 (4 from initial defensive copy + 3 from T7 test publishes) |

### Post-rollback verification (PHASE-6.5-ROLLBACK.sql executed)

| Metric | Expected | Actual | Status |
|---|---|---|---|
| Snapshot tables | 0 | 0 | ✅ |
| `draft_updated_at` column | 0 | 0 | ✅ |
| Emphasis columns | 0 | 0 | ✅ |
| schema_migrations rows | 0 | 0 | ✅ |
| Publish / discard functions | 0 | 0 | ✅ |
| Slot-B gate CHECK | 0 | 0 | ✅ |
| `kds_screens` rows preserved | 4 | 4 | ✅ |
| `kds_grid_boxes` rows preserved | 15 | 15 | ✅ |

### Re-apply via `supabase db push`

Both migrations re-applied cleanly. NOTICEs from `DROP POLICY IF EXISTS` are expected (policies don't exist yet on the freshly-rolled-back snapshot tables — IF EXISTS guards make the migration idempotent). Defensive first-run copy fired: 4 published_screens populated from the 4 draft screens.

| Metric | Expected | Actual | Status |
|---|---|---|---|
| Snapshot tables | 2 | 2 | ✅ |
| Emphasis columns | 4 | 4 | ✅ |
| schema_migrations rows | 2 | 2 | ✅ |
| Publish / discard functions | 2 | 2 | ✅ |
| Published snapshot rows after re-apply | 4 | 4 | ✅ |

Rollback + re-apply are both idempotent.

---

## Automated coverage

| Layer | File | Cases | Result |
|---|---|---|---|
| Integration | `tests/integration/kds-v3-publish-route.test.ts` (new) | 6 | ✅ |
| Integration | All kds-v3 files combined | 81 (was 75 in phase 6) | ✅ |
| Lint | `npm run lint` | — | ✅ no warnings |
| Build | `npm run build` | — | ✅ |

---

## Deferred to operator (manual UI walk)

The operator's UI walk on bigcafe exercises the end-to-end flow:

- Open a screen → see "Up to date" badge initially
- Edit a box (any layout change) → save → see "Unpublished changes" pill flip on
- Click Publish → confirm dialog with diff summary shows added/changed/removed counts → confirm → pill returns to "Up to date"
- Make another edit → save → "Unpublished changes" → click Discard → confirm → form remounts with the discarded values from published; pill returns to "Up to date"
- Variation emphasis: switch a `variation_column_header` slot's emphasized variation by typing a name; verify the column accent moves on save. Toggle "No emphasis" checkbox; verify accent disappears.
- Pi-side check (if a paired Pi is reachable): edit without publishing → Pi keeps showing the previously-published version. Publish → Pi reflects the change within ~30s.

### Operator sign-off

_(pending — fill in after the manual walk)_

- Walk completed on: ____________________
- Notes: ____________________

---

## Commits

| Task | Commit | Subject |
|---|---|---|
| Plan | `e515aa2` | plan(kds-v3): MOK-159 phase 6.5 — draft/published workflow + variation emphasis |
| T0 | `59c40a9` | schema(kds-v3): MOK-159 T0 — published snapshot tables + tick cols + emphasis cols |
| T1 | `52da9d4` | plan(kds-v3): MOK-159 T1 — phase 6.5 rollback SQL |
| T2 | `db4d7c5` | feat(kds-v3): MOK-159 T2 — publish + discard-draft routes + atomic functions |
| T3 | `1b7c7c0` | feat(kds-v3): MOK-159 T3 — render-fetch source selection (published vs draft) |
| T4 | `dacc736` | feat(kds-v3): MOK-159 T4 — publish + discard buttons + status badge in editor |
| T6 | `d442bcb` | feat(kds-v3): MOK-159 T6 — per-screen unpublished pill on screens list |
| T5 | `e3f8eec` | feat(kds-v3): MOK-159 T5 — operator-pickable variation emphasis |
| T7 | `952edef` | test(kds-v3): MOK-159 T7 — publish + discard + source-selection integration |

---

## Next

Open PR `kds-v3-p6.5-publish` → `kds-v3` for review. After merge + operator walk sign-off, phase 7 spec drafting begins (v2 cutover + Little Cafe migration + sidebar rename to "KDS Setup"). After phase 7, the **KDS Raspberry Pi Deployment** Linear project comes off the shelf.
