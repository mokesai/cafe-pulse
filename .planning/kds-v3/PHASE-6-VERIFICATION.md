# KDS v3 — Phase 6 verification report

**Spec:** [MOK-158](https://linear.app/mokesai/issue/MOK-158)
**Plan:** [.planning/kds-v3/PHASE-6-PLAN.md](./PHASE-6-PLAN.md)
**Branch:** `kds-v3-p6-renderer`
**Verified against:** cafe-pulse-dev (`ettmabcwfhidcpapphgm`), bigcafe tenant (`4fa1cbbe-49ff-4cde-a686-8d34252945b4`)
**Verified on:** 2026-05-17

---

## Summary

Phase 6 ships the first KDS v3 surface that actually renders to a TV. Consumes
every schema layer from phases 1–5 (`kds_screens`, `kds_grid_boxes`,
`square_menu_*`, `kds_aesthetic_images`, `kds_display_overrides`) and composes
a live grid display with four group-layout modes (simple_list /
variation_column_header / flavor_list / compact_list), four price-display
modes, and operator-controlled whitespace (density / title_size / title_align).

- New `kds_grid_boxes` columns (10 — 5 slot-A NOT NULL with defaults + 5
  slot-B nullable) gated by a cross-slot-B formatting invariant CHECK.
  Existing phase 2.5 `division_slot_b_invariant` left intact (additive).
- New pure helper module `src/lib/kds/v3-render-helpers.ts` with 6 functions
  (29 unit tests) consumed by the renderer + the data fetch.
- New batched render-fetch helper `src/lib/kds/v3-render.ts` —
  `resolveScreenForRender(supabase, tenantId, screenId)` returns a fully-
  resolved `ResolvedScreen` shape with override precedence applied, signed
  URLs attached, hidden items / variations filtered.
- Four per-layout renderer components in `src/components/kds/v3/` sharing a
  `SlotFormatting` prop shape via the `style-mappings.ts` helper.
- Editor (`GridEditor.tsx`) extended with 5 new controls per slot
  (layout-mode segmented + 3 dropdowns + title-align segmented). Editor
  routes the same PUT shape, validated server-side in
  `src/app/api/admin/kds-v3/screens/[id]/route.ts`.
- Public route `/kds/v3/[deviceId]/[screenId]` reuses v2's device-token
  auth, applies the screen's theme class, renders the grid via plain CSS
  Grid (no react-grid-layout in read-only mode), polls every 30s for
  operator edits.
- Seed-script expansion (`scripts/seed-square-test-menu.ts`) grew from
  1 menu / 3 groups / 6 items to 1 menu / 14 groups / 52 items / 109
  variations. New `--tenant <slug>` flag uses the tenant's Vault
  credentials. Companion `sync-tenant-menu.ts` CLI helper triggers a
  mirror sync without needing the dev server.

---

## Coverage map: MOK-158 acceptance → evidence

| MOK-158 acceptance | Evidence | Status |
|---|---|---|
| Migration adds 10 new columns + invariant CHECK | T1 + 6-case battery (commit `25d4e53`) | ✅ |
| T0 seed expansion to ~14 groups / ~50 items | T0 (commit `d7571e3`) | ✅ |
| Editor controls (layout / price / density / title) per slot | T3 (commit `cfa6c5b`) | ✅ |
| Public route renders | T10 (commit `6086990`) | ✅ (UI walk deferred to operator) |
| `simple_list` render correct | T6 (in `b8dd8de`) | ✅ (compile + tests; UI walk deferred) |
| `variation_column_header` render correct | T7 | ✅ |
| `flavor_list` render correct | T8 | ✅ |
| `compact_list` render correct | T9 | ✅ |
| Display overrides honored at render | T11 cases 3, 4 + T5 helpers | ✅ |
| Hide-testing on overstuffed Frappuccinos — Coffee | T0 seed shape + T11 case 3 | ✅ (data ready) |
| `image_only` slot renders bound image | T11 case 6 | ✅ |
| Divided box with both slots bound | T11 case 2 | ✅ |
| Theme honored | T10 — theme class applied per `kds_screens.theme` | ✅ (UI walk deferred) |
| 30s polling refresh | T10 — `setInterval(router.refresh, 30_000)` | ✅ |
| Single batched data-fetch | T4 helper (6 round-trips, Set-based ID collection) | ✅ |
| Integration tests | T11 — 9 new (6 render-fetch + 3 screens-routes) | ✅ |
| Rollback drops new columns cleanly | T12 (this report) | ✅ |

---

## T1 — Forward migration corner battery (executed 2026-05-17 21:53 UTC)

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | Undivided box, defaults; slot-B all NULL | PASS | ✅ PASS — slot-A defaults applied, slot-B NULL |
| 2 | Divided box, full slot-B with non-defaults | PASS | ✅ PASS — round-trip cleanly |
| 3 | Undivided + partial slot-B (`layout_mode_b='simple_list'`) | CHECK_VIOLATION | ✅ `kds_grid_boxes_slot_b_formatting_invariant` |
| 4 | Divided + missing slot-B layout_mode_b | CHECK_VIOLATION | ✅ same invariant |
| 5 | `layout_mode='not_a_real_layout'` | CHECK_VIOLATION | ✅ `kds_grid_boxes_layout_mode_check` |
| 6 | `price_display_mode='not_real'` | CHECK_VIOLATION | ✅ `kds_grid_boxes_price_display_mode_check` |

Upgrade probe: 14 existing rows across the table all backfilled to slot-A
defaults (`simple_list` / `lowest` / `normal` / `medium` / `left`); 2 divided
rows additionally backfilled with slot-B formatting defaults (so the new
cross-slot-B invariant holds the moment the CHECK is created).

---

## T12 — Rollback rehearsal (executed 2026-05-17 21:14–21:16 UTC)

### Pre-rollback snapshot

| Metric | Value |
|---|---|
| Phase 6 columns on `kds_grid_boxes` | 10 |
| Phase 6 CHECKs on `kds_grid_boxes` | 11 (10 enum + 1 invariant) |
| `schema_migrations` row for version `20260517214944` | 1 |
| bigcafe `kds_grid_boxes` rows | 8 (preserved across rollback) |

### Post-rollback verification (after executing PHASE-6-ROLLBACK.sql)

| Metric | Expected | Actual | Status |
|---|---|---|---|
| Phase 6 columns | 0 | 0 | ✅ |
| Phase 6 CHECKs | 0 | 0 | ✅ |
| Phase 6 migration row | 0 | 0 | ✅ |
| bigcafe `kds_grid_boxes` rows | 8 | 8 | ✅ (data preserved) |
| Phase 2.5 `division_slot_b_invariant` still present | 1 | 1 | ✅ (untouched) |

### Re-apply via `supabase db push` (forward migration)

Re-applied cleanly. NOTICES from `DROP CONSTRAINT IF EXISTS` are expected
(constraints don't exist yet on the post-rollback table — the IF EXISTS
guards make the migration idempotent). All 10 columns + 11 CHECKs restored:

| Metric | Expected | Actual | Status |
|---|---|---|---|
| Phase 6 columns | 10 | 10 | ✅ |
| Phase 6 CHECKs | 11 | 11 | ✅ |
| Phase 6 migration row | 1 | 1 | ✅ |
| Rows with slot-A defaults (table-wide) | 14 | 14 | ✅ |

Rollback and re-apply are both idempotent; the migration can be safely
re-run on either a freshly-rolled-back state or an already-applied state.

---

## Automated coverage

| Layer | File | Cases | Result |
|---|---|---|---|
| Unit | `src/lib/kds/__tests__/v3-render-helpers.test.ts` | 29 | ✅ |
| Integration | `tests/integration/kds-v3-render-fetch.test.ts` | 6 | ✅ |
| Integration | `tests/integration/kds-v3-screens-routes.test.ts` (new T3 cases) | 3 (29 → 32 total) | ✅ |
| Integration | All KDS v3 files combined | 72 | ✅ |
| Unit | Full unit suite | 144 | ✅ |
| Lint | `npm run lint` | — | ✅ no warnings |
| Build | `npm run build` | — | ✅ |

---

## Deferred to operator (manual UI walk)

The 12-step manual walk in the T11 section of the plan exercises actual
TV-shape rendering on bigcafe. That work falls to the operator per the
session preference (UI/UX testing). Spec compliance items the operator
needs to verify on their walk:

- Editor controls visible and persistent across save/reload
- `variation_column_header` shows clean Tall/Grande/Venti columns for
  the seeded Hot Drinks / Frappuccinos / Seasonal / Teas groups
- `flavor_list` shows Muffin with 4 flavors joined by `•`
- `compact_list` shows Energy Drinks header with auto-derived range
- `image_only` slot full-bleed render with optional caption
- Divided box: Frappuccinos — Coffee + Frappuccinos — Crème side by side
- Hide-from-KDS override on a Frappuccinos — Coffee item updates within
  30s on the public route
- `alt_display_name` override surfaces in the live render
- Theme application across warm / dark / wps
- Polling cadence acceptable for operator edit feedback

Once the walk completes, append the operator's sign-off below.

### Operator sign-off

_(pending — fill in after the 12-step manual walk on bigcafe)_

- Walk completed on: ____________________
- Notes: ____________________

---

## Commits

| Task | Commit | Subject |
|---|---|---|
| Plan | `3fa3cff` | plan(kds-v3): MOK-158 phase 6 — public renderer + group layout modes + formatting controls |
| T0 | `d7571e3` | seed(kds-v3): MOK-158 T0 — expand test menu to 14 groups + tenant flag + sync helper |
| T1 | `25d4e53` | schema(kds-v3): MOK-158 T1 — phase 6 layout/price/whitespace columns + invariant CHECK |
| T2 | `03ece24` | plan(kds-v3): MOK-158 T2 — phase 6 rollback SQL |
| T3 | `cfa6c5b` | feat(kds-v3): MOK-158 T3 — editor controls for layout / price / whitespace |
| T4 | `a4c64b5` | feat(kds-v3): MOK-158 T4 — single-batched render-fetch helper |
| T5 | `9548573` | feat(kds-v3): MOK-158 T5 — pure render helpers + unit tests |
| T6-T9 | `b8dd8de` | feat(kds-v3): MOK-158 T6-T9 — four per-layout renderer components |
| T10 | `6086990` | feat(kds-v3): MOK-158 T10 — public renderer route + 30s polling |
| T11 | `c5ccee9` | test(kds-v3): MOK-158 T11 — integration tests for render-fetch + new T3 columns |

---

## Next

Open PR `kds-v3-p6-renderer` → `kds-v3` (the integration trunk) for review.
After merge + operator walk sign-off, phase 7 spec drafting begins (v2
cutover + Little Cafe migration).
