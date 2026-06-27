# KDS v3 — Phase 2 Verification Report

**Spec:** [MOK-152](https://linear.app/mokesai/issue/MOK-152)
**Plan:** [.planning/kds-v3/PHASE-2-PLAN.md](./PHASE-2-PLAN.md)
**Branch:** `kds-v3-p2-screen-designer`
**Verified against:** cafe-pulse-dev (`ettmabcwfhidcpapphgm`), bigcafe tenant
**Verified on:** 2026-05-12 (T8 manual walk) and 2026-05-15 (T9 rollback rehearsal)

---

## Summary

All 10 plan tasks (T1–T9 + T-A) complete. All MOK-152 acceptance criteria pass.

The Path A mid-flight pivot (raising the grid-resolution cap from 12 → 24) landed as T-A and is included in every verification below. Box division (the 3rd capability the operator surfaced after first seeing the rendered editor) is intentionally deferred to phase 2.5 (ticket to be filed).

**Status: READY for PR `kds-v3-p2-screen-designer` → `kds-v3`** when the operator is ready to merge.

Note: the eventual `kds-v3` → `staging` PR opens only after all 7 phases have landed on the integration trunk; phase 2 is the second of seven.

---

## Acceptance walkthrough

Each MOK-152 acceptance criterion mapped to its evidence.

| # | Acceptance criterion | Evidence | Result |
|---|---|---|---|
| 1 | Migration creates 2 tables w/ RLS, FKs, indexes; tenant_id NOT NULL | T1 + T-A post-reapply verification (T9): 2 tables, 8 policies (4 per table × 2), grid_rows/grid_cols CHECK = 1..24, FK kds_grid_boxes.screen_id → kds_screens(id) ON DELETE CASCADE | ✅ |
| 2 | Operator creates screen with name/dims/theme | T8 step 4 (manual on bigcafe): "Drinks" screen created at 4 × 6 / warm theme; persisted across reload | ✅ |
| 3 | Operator edits a screen | T8 step 4–6: name/dim/theme edits round-tripped; box positions preserved across grid resize | ✅ |
| 4 | Operator adds, drags, resizes a box | T8 step 5 + 6 (manual on bigcafe with 12×3 and 16×12 grids); fixed mid-T8 via the editor mechanics commit (drag-anywhere, 16:9 preview, allowOverlap) | ✅ |
| 5 | Box position numbers stable across edits | T7 integration test #5 (PUT preserves position stability auto) + T8 step 8 (manual: deleted middle box, surviving boxes kept positions 1 and 3) | ✅ |
| 6 | Resize/move constrained to grid bounds + no overlap | T7 integration tests #6 (overlap 422) + #7 (out-of-bounds 422); editor UX surfaces validation errors live via `validateBoxLayout` above the editor; server is the source of truth | ✅ |
| 7 | Operator can delete a box; positions unchanged | T7 integration test #5 + T8 step 8 (manual confirmation positions 1 + 3 stayed) | ✅ |
| 8 | Cascade delete on screen → boxes gone | T7 integration test #8 + T8 step 10 (manual via Supabase Studio after screen delete) | ✅ |
| 9 | 3rd screen returns 422 KDS_SCREEN_LIMIT_REACHED | T7 integration test #2 + T8 step 7 (manual: "+ Add Screen" disabled at cap) | ✅ |
| 10 | Tenant isolation | T7 integration test #9 (tenant A cannot mutate tenant B's screens; mirrors MOK-107 class) | ✅ |
| 11 | Integration tests cover the above | `tests/integration/kds-v3-screens-routes.test.ts` — 9/9 passing | ✅ |
| 12 | Box-content fields nullable in phase 2 | T1 schema (`square_menu_group_id`, `aesthetic_image_id`, `header_override` all nullable) + T6 UI hint (controls panel notes "configured in later phases") | ✅ |
| T-A | Grid resolution supports variable column heights / adjustable per-box heights via 24-max | T-A migration applied; CHECK constraints verified at `BETWEEN 1 AND 24`; T8 step 6 (manual: 16×12 grid with variable-height columns simulated successfully) | ✅ |
| 13 | Rollback works cleanly | T9: PHASE-2-ROLLBACK.sql executed; post-rollback shows 0 tables / 0 policies / 0 phase-2 schema_migrations rows; re-applied (T1 + T-A) produces identical schema; idempotent on second re-apply | ✅ |

---

## T9 rollback rehearsal detail

Executed 2026-05-15 against cafe-pulse-dev.

### Starting state (before rollback)
- 5 screens, 3 boxes (T8 leftover data)
- 2 schema_migrations rows for phase 2 (one matching local `20260513023650`, one drift-version `20260512015508` for T1)

### Step 1 — Execute PHASE-2-ROLLBACK.sql
DROP POLICY × 8, DROP TABLE × 2 (kds_grid_boxes → kds_screens), DELETE schema_migrations rows for `20260512015358` and `20260513023650`.

### Step 2 — Manual cleanup of drift artifact
Additional `DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260512015508'` to remove the drift row that the rollback script couldn't target (the script uses the local-file version, not the drift version). This step is **not** required on staging/prod once MOK-153 is resolved — version IDs will match the local file timestamps there.

### Step 3 — Post-rollback verification

| Check | Expected | Actual |
|---|---|---|
| `public.kds_screens` + `public.kds_grid_boxes` exist | 0 | 0 ✅ |
| RLS policies on either table | 0 | 0 ✅ |
| schema_migrations rows for `20260512015358`, `20260512015508`, `20260513023650` | 0 | 0 ✅ |

### Step 4 — Re-apply T1 + T-A

| Check | Expected | Actual |
|---|---|---|
| Tables created | 2 | 2 ✅ |
| RLS policies | 8 | 8 ✅ |
| schema_migrations rows for `20260512015358` + `20260513023650` | 2 | 2 ✅ |
| `kds_screens_grid_rows_check` definition | `CHECK ((grid_rows >= 1) AND (grid_rows <= 24))` | matches ✅ |
| `kds_screens_grid_cols_check` definition | `CHECK ((grid_cols >= 1) AND (grid_cols <= 24))` | matches ✅ |

### Step 5 — Idempotency test (re-run T1 + T-A a second time)

Same verification query produced identical results (2 tables, 8 policies, 2 schema_migrations rows, both CHECK constraints at 1..24). No errors raised. `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` + `CREATE POLICY`, `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`, and `INSERT … ON CONFLICT (version) DO NOTHING` together make both migration files idempotent.

---

## Caveat — `supabase db push` path is currently blocked

T9 step 3 in the plan reads "Re-run `npm run db:migrate` — confirm idempotent re-apply." The rehearsal above instead applied the SQL via direct execution against cafe-pulse-dev. Reason: `supabase db push --dry-run` errors with **"Remote migration versions not found in local migrations directory"** because of pre-existing drift between local file timestamps and the version IDs recorded in remote `supabase_migrations.schema_migrations`. This drift was caused by past sessions applying migrations via the Supabase MCP `apply_migration` tool, which generates its own version at apply-time.

The drift is unrelated to phase 2 — every recent migration (mok121/122/123/139, KDS v3 phase 1, and T1 of phase 2) has the same problem. Phase 2's T-A migration is the lone exception with matching local + remote versions.

Filed as **[MOK-153 — Reconcile migration drift between local files and remote schema_migrations](https://linear.app/mokesai/issue/MOK-153/reconcile-migration-drift-between-local-files-and-remote-schema)** (High priority). Must be resolved **before** the eventual `kds-v3` → `staging` PR opens, so staging's deploy can apply the kds-v3 migrations via `supabase db push`. Not a blocker for the phase 2 sub-PR into `kds-v3`.

Going-forward rule (captured in working-style notes): always author + apply migrations via the Supabase CLI (`supabase migration new` + `supabase db push`). Never use `mcp__supabase-*__apply_migration` or raw `execute_sql` for migration authoring.

---

## Test layer summary

| Layer | Coverage | Result |
|---|---|---|
| Layer 1 — Vitest unit tests (T3) | `grid-validation.test.ts` — boxFitsInGrid, boxesOverlap, validateBoxLayout, nextAvailablePosition, firstFreeCell, cellsOccupied | 25 cases passing within the project-wide 102/102 ✅ |
| Layer 1 — Vitest integration tests (T7) | `tests/integration/kds-v3-screens-routes.test.ts` — 9 cases mapping 1:1 to MOK-152 acceptance criteria | 9/9 ✅ |
| Layer 2 — Manual local-dev (T8) | Create/edit screen, drag-resize box, position stability, cap enforcement (3rd-screen 422), cascade delete | All passed ✅ on 2026-05-12 after editor mechanics fix |
| Layer 3 — Rollback rehearsal (T9) | Full DROP + re-apply against cafe-pulse-dev, plus idempotency re-run | Clean ✅ on 2026-05-15 |
| Layer 4 — Manual staging | Webhook delivery + real Square-authored menu — n/a for phase 2 (no Square integration in this phase) | n/a |

---

## Path A pivot — recorded for posterity

Mid-T8 manual verification (2026-05-11), the operator surfaced three desired editor capabilities after first seeing the rendered grid:

1. Variable column heights (columns with 1, 2, or 3 boxes)
2. Adjustable per-box height resolution
3. Box division (single split, left/right or top/bottom, with each side carrying independent content)

**Decision:** handle (1) + (2) inside phase 2 by raising the grid resolution cap (Path A — landed as task T-A); defer (3) to phase 2.5 because it requires a real schema addition (`division` enum + duplicated content slots) and impacts the phase 6 renderer's data shape. T-A made the bump non-trivially atomic: separate migration file (`20260513023650_kds_v3_phase_2_grid_max_24.sql`) because T1 was already applied to dev; route validators updated to enforce 1..24; ScreenForm rows/cols input `max` bumped to 24. All 9 T7 integration tests stayed green (they use grids within the new range).

The phase 2.5 box-division ticket is **to be filed (next MOK-#)** — MOK-153 was originally placeholder-reserved for this but Linear allocated it to the migration drift issue first.

---

## Commit log on `kds-v3-p2-screen-designer`

Tip:

```
26083c0 docs(kds-v3): drop MOK-153 reservation from phase 2 plan
842da5c fix(kds-v3): MOK-152 T6 — repair drag mechanics + 16:9 preview
f04e4d2 feat(kds-v3): MOK-152 T-A — raise grid_rows/grid_cols cap from 12 to 24
6d6c838 fix(kds-v3): MOK-152 T6 — restore react-grid-layout drag-resize editor
39d0195 fix(kds-v3): MOK-152 T6 — drop react-grid-layout, fall back to form-based editor
ac0d55b fix(kds-v3): MOK-152 — strip @/components/ui + lucide-react from form/editor
…
```

(Earlier T1–T7 commits omitted for brevity; full history is on the branch.)

---

## Sign-off

- **Author:** Jerry McCommas (operator-in-the-loop verification on 2026-05-12)
- **T9 rehearsal executed:** Claude (paired session on 2026-05-15)
- **Status:** Ready for sub-PR to `kds-v3` integration trunk
- **Next:** open PR `kds-v3-p2-screen-designer` → `kds-v3`; begin phase 3 spec when paired bandwidth allows
