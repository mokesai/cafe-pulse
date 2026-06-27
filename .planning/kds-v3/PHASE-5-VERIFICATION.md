# KDS v3 — Phase 5 Verification Report

**Spec:** [MOK-157](https://linear.app/mokesai/issue/MOK-157/kds-v3-phase-5-per-item-per-variation-display-overrides)
**Plan:** [.planning/kds-v3/PHASE-5-PLAN.md](./PHASE-5-PLAN.md)
**Branch:** `kds-v3-p5-item-overrides`
**Verified against:** cafe-pulse-dev (`ettmabcwfhidcpapphgm`), bigcafe tenant
**Verified on:** 2026-05-17

---

## Summary

All 7 plan tasks (T1–T7) complete. Phase 5 ships:

- New `kds_display_overrides` table with a `target_kind` discriminator ('item' | 'variation') + UNIQUE on (tenant_id, target_kind, target_id) + a not_empty CHECK as DB-level defense in case the route's auto-delete logic ever has a bug + FK from `alt_image_aesthetic_image_id` to phase 4's `kds_aesthetic_images` with `ON DELETE SET NULL`.
- One shared helper (`src/lib/kds/display-overrides.ts`) + four admin routes (`GET /display-overrides`, `PUT/DELETE /display-overrides/items/[id]`, `PUT/DELETE /display-overrides/variations/[id]`) with cross-tenant validation on both the target and the alt_image binding.
- One new helper endpoint `GET /api/admin/kds-v3/menu-groups/[id]/items` returning items + variations for a group, tenant-scoped.
- New admin page at `/admin/kds-v3/display-overrides` with menu-group selector + nested item-variation table + debounced PUT on inline change + auto-delete-on-defaults semantics.
- 11 new integration tests covering both target kinds, auto-delete, cross-tenant rejections, idempotent DELETE, and tenant isolation.

Override precedence at render time (frozen for phase 6 to inherit): **variation override > item override > Square default.**

**Status: READY for PR `kds-v3-p5-item-overrides` → `kds-v3`** when the operator approves.

---

## Acceptance walkthrough

Each MOK-157 acceptance criterion mapped to its evidence.

| # | Acceptance criterion | Evidence | Result |
|---|---|---|---|
| 1 | Migration creates table + CHECK + UNIQUE + FK | T1 + 5-case battery + FK SET NULL probe | ✅ |
| 2 | Admin page lists items + variations with inline override controls | T4 + T6 manual walk steps 2-9 | ✅ |
| 3 | PUT item override persists | T5 case #1 (auto) + T6 step 5 (manual) | ✅ |
| 4 | PUT variation override persists | T5 case #2 (auto) + T6 steps 6-7 (manual) | ✅ |
| 5 | Cross-tenant target rejection (422) | T5 cases #4, #5 | ✅ |
| 6 | Cross-tenant alt_image rejection (422) | T5 case #6 | ✅ |
| 7 | PUT-with-defaults auto-deletes | T5 case #3 + T6 step 8 (manual) | ✅ |
| 8 | DELETE removes; idempotent on second call | T5 case #9 | ✅ |
| 9 | Soft-deleted aesthetic image still acceptable as alt_image | T5 case #11 | ✅ |
| 10 | Integration tests cover the surface + tenant isolation on GET | T5 (11 cases) + case #10 for GET isolation | ✅ |

---

## 5-case CHECK / UNIQUE corner battery (T1)

Executed against cafe-pulse-dev 2026-05-17 during T1 commit. Plus an FK SET NULL probe.

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | item override with alt_display_name set | PASS | ✅ |
| 2 | variation override with only hidden=true | PASS | ✅ |
| 3 | all-defaults insert | not_empty CHECK_VIOLATION | ✅ |
| 4 | invalid target_kind ('sandwich') | target_kind CHECK_VIOLATION | ✅ |
| 5 | duplicate of case 1 (same tenant + kind + target_id) | UNIQUE_VIOLATION | ✅ |
| FK | bound alt_image → hard-delete the image → override row's alt_image_aesthetic_image_id becomes NULL, alt_display_name still set | SET NULL fires; not_empty satisfied by remaining alt_display_name | ✅ |

---

## T6 manual walk on bigcafe — 2026-05-17

10-step procedure. **Step 10 deliberately skipped** — that case required a `is_deleted=true` menu group, which requires the same workaround we used in MOK-155 phase 3 verification (direct mirror UPDATE simulating Dashboard deletion, since the Square sandbox API rejects MENU_CATEGORY DELETE). Operator chose to defer rather than re-set the workaround state. The override-on-deleted-group path is covered indirectly by T5's tenant-isolation + target-existence logic (an item that's been soft-deleted via mirror UPDATE still exists in the mirror; overrides target items, not groups, so deleting the group has no direct effect on the override's validity).

| Step | Description | Result |
|---|---|---|
| 1 | Sign in to bigcafe admin | ✅ |
| 2 | Navigate to /admin/kds-v3/display-overrides; sidebar entry visible | ✅ |
| 3 | Menu-group dropdown shows tenant's groups; select Hot Drinks | ✅ |
| 4 | Nested table renders items + indented variations | ✅ |
| 5 | Set alt name on an item (e.g. "Caffè Latte"); save → reload → persists | ✅ |
| 6 | Set alt image on a variation; save → reload → persists | ✅ |
| 7 | Toggle hide on a variation; save → reload → still hidden | ✅ |
| 8 | Clear all three on a row → auto-delete fires → row gone in DB | ✅ |
| 9 | Switch menu groups → only selected group's items shown | ✅ |
| 10 | Override an item from a deleted menu group | ⏭ skipped — see note above |

### Bug found + fixed during T6

Operator surfaced an input-mangling bug while typing "Caffè Latte" in the alt-display-name field. Two combined causes:

1. **Local state being clobbered by stale server response.** The `OverrideRowControl`'s `useEffect` re-synced local state from `initialOverride` on every parent re-render. When the debounced PUT response landed, the parent's overrides map updated with the new row, which re-fired the useEffect, which **overwrote characters typed between the debounce firing and the response landing.**
2. **Browser autocorrect / autocapitalize.** Default `<input>` behavior on Safari / iOS was capitalizing leading letters and "fixing" doubled characters (e.g. "ff" in Caffe).

Fixed in commit `fde5812`:
- Removed the useEffect; local state initializes ONCE at mount via `useState`'s lazy initializer. The row's local state is the source of truth during editing; server response updates the parent map but no longer touches the row's state.
- Added `spellCheck={false}`, `autoComplete="off"`, `autoCapitalize="off"`, `autoCorrect="off"` to the alt-name input.

Operator re-verified the input flow post-fix; typing now works cleanly.

---

## T7 rollback rehearsal detail

Executed 2026-05-17 against cafe-pulse-dev.

### Starting state (before rollback)
- 1 override row (item-level, with alt_image bound) from T6 testing
- 4 RLS policies + 1 FK + 3 CHECK constraints + 1 schema_migrations row
- Phase 1-4 data: 4 screens, 14 boxes, 10 aesthetic images

### Step 1 — Execute PHASE-5-ROLLBACK.sql

One transaction: DROP POLICY × 4, DROP TABLE `kds_display_overrides`, DELETE from `schema_migrations` for our version.

### Step 2 — Post-rollback verification

| Check | Expected | Actual |
|---|---|---|
| `kds_display_overrides` table dropped | 0 | 0 ✅ |
| T1 schema_migrations row removed | 0 | 0 ✅ |
| Phase 1-4 `kds_screens` preserved | 4 | 4 ✅ |
| Phase 1-4 `kds_grid_boxes` preserved | 14 | 14 ✅ |
| Phase 4 `kds_aesthetic_images` preserved | 10 | 10 ✅ |

The 1 override row from T6 was wiped along with the table — expected and called out before execution.

### Step 3 — Re-apply via `supabase db push`

```
Applying migration 20260517164558_kds_v3_phase_5_display_overrides.sql...
NOTICE: constraint "kds_display_overrides_alt_image_fk" does not exist, skipping
NOTICE: constraint "kds_display_overrides_not_empty" does not exist, skipping
NOTICE: policy "..." does not exist, skipping × 4
Finished supabase db push.
```

Post-reapply verification:

| Check | Expected | Actual |
|---|---|---|
| Table present | 1 | 1 ✅ |
| RLS policies | 4 | 4 ✅ |
| schema_migrations row for T1 | 1 | 1 ✅ |
| not_empty CHECK present | 1 | 1 ✅ |
| alt_image FK present | 1 | 1 ✅ |

### Step 4 — Idempotency test

Re-executed the T1 migration SQL a second time on top of the just-applied state. Migration uses `CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` for both the FK and the not_empty CHECK.

Result: zero errors, identical post-state — table present, 3 check constraints (target_kind enum, alt_display_name length, not_empty), 1 FK constraint. Migration is genuinely idempotent.

---

## Test layer summary

| Layer | Coverage | Result |
|---|---|---|
| Layer 1 — Vitest unit tests | grid-validation suite unchanged (no schema/validation primitives added in phase 5) | 115/115 ✅ |
| Layer 1 — Vitest integration tests | 5 kds-v3 test files: phase-2 screens (29 cases incl. phase-3 + phase-4 extensions), phase-3 menu-groups-route (3), phase-4 aesthetic-images-route (10), phase-5 display-overrides-route (11) | 63/63 ✅ |
| Layer 2 — Manual local-dev (T6) | 9 of 10 steps on bigcafe: menu-group selector, items + variations table, alt-name + alt-image + hide round-trip on both target kinds, auto-delete, group switching | All passed ✅ (1 deferred) |
| Layer 3 — Rollback rehearsal (T7) | DROP table + re-apply + idempotency re-run | Clean ✅ |
| Layer 4 — Manual staging | n/a — KDS v3 ships as single staging PR after all 7 phases | n/a |

---

## Forward-looking notes for phase 6

Phase 6's renderer consumes the override table per the precedence rule:

```
For each item + its variations in the bound menu group:
  - look up display_overrides for (target_kind='item', target_id=item.id)
  - for each variation, look up (target_kind='variation', target_id=variation.id)
  - apply: variation override → item override → Square default
  - hidden_from_kds=true at item-level hides all variations; at
    variation-level hides only that variation
  - alt_display_name and alt_image_aesthetic_image_id are independent
    fields; either may be NULL (use Square default for that aspect)
```

A renderer-side helper `resolveDisplayForVariation(item, variation, overrides)` neatly encapsulates this. Phase 6 spec will design the SQL query shape (probably one batched fetch of all override rows for the bound menu groups on a screen, then in-memory lookup).

---

## Commit log on `kds-v3-p5-item-overrides`

Tip (T7 verification commit added by this doc):

```
<verification commit>
fde5812 fix(kds-v3): MOK-157 — fix alt display name input getting mangled
d2a32b0 test(kds-v3): MOK-157 T5 — integration tests for display overrides
7a0edb7 feat(kds-v3): MOK-157 T4 — display overrides admin page
1650c23 feat(kds-v3): MOK-157 T3 — display-overrides CRUD routes
c497ce7 chore(kds-v3): MOK-157 T2 — phase 5 rollback SQL
497a650 feat(kds-v3): MOK-157 T1 — kds_display_overrides schema
7045da6 plan(kds-v3): MOK-157 phase 5 — per-item / per-variation display overrides
```

---

## Sign-off

- **Author:** Jerry McCommas (operator-in-the-loop verification on 2026-05-17)
- **Paired session:** Claude (T1-T5 implementation, T6 walk facilitation + input-mangling fix, T7 rehearsal + report)
- **Status:** Ready for sub-PR to `kds-v3` integration trunk
- **Next:** open PR `kds-v3-p5-item-overrides` → `kds-v3`; phase 6 spec drafting (live renderer + price-display admin controls + combo rendering) when paired bandwidth allows.
