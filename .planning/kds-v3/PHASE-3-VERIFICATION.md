# KDS v3 — Phase 3 Verification Report

**Spec:** [MOK-155](https://linear.app/mokesai/issue/MOK-155/kds-v3-phase-3-menu-group-assignment)
**Plan:** [.planning/kds-v3/PHASE-3-PLAN.md](./PHASE-3-PLAN.md)
**Branch:** `kds-v3-p3-menu-group-assignment`
**Verified against:** cafe-pulse-dev (`ettmabcwfhidcpapphgm`), bigcafe tenant
**Verified on:** 2026-05-16

---

## Summary

All 6 plan tasks (T1–T6) complete. Phase 3 lets the operator bind each `menu_group`-typed slot (slot A on any box; slot B on a divided box) to one of the tenant's mirrored Square menu groups, plus an optional header override. The phase 6 renderer will consume the binding to display the group's items on the public KDS screen.

No DB schema changes — phase 2 + 2.5 had already added the columns. Phase 3 is pure admin-route + editor + validation work.

**Status: READY for PR `kds-v3-p3-menu-group-assignment` → `kds-v3`** when the operator approves.

---

## Acceptance walkthrough

Each MOK-155 acceptance criterion mapped to its evidence.

| # | Acceptance criterion | Evidence | Result |
|---|---|---|---|
| 1 | New route `GET /api/admin/kds-v3/menu-groups` returns tenant-scoped rows with `item_count` + `parent_menu_name` | T1 implementation + T4 case M1 (integration) | ✅ |
| 2 | Editor picker surfaces for `menu_group` slots; clearing sends NULL; saving persists | T3 + T5 #4-5 (manual: pick Hot Drinks → save → reload → selection persisted; clear → save → unbound) | ✅ |
| 3 | Header override input round-trips per slot | T4 #16 (auto) + T5 #5 (manual: typed override survived reload) | ✅ |
| 4 | Divided box: slot A and slot B each have an independent picker + override | T4 #18 (auto: both slots round-trip distinct bindings) + T5 #6 (manual) | ✅ |
| 5 | Cross-tenant rejection (422) | T2 + T4 #19 — load-bearing security boundary pinned by explicit two-tenant fixture | ✅ |
| 6 | Defensive rejection (400) when `box_type='image_only'` slot has `square_menu_group_id` set | T2 + T4 #20 | ✅ |
| 7 | Nonexistent-group rejection (422) | T2 + T4 #21 (fabricated id) | ✅ |
| 8 | Deleted group renders as `(deleted) <name>` in the editor; binding stays until operator re-binds | T3 + T4 case M3 (route surfaces `is_deleted=true` rows) + T4 #22 (server accepts is_deleted binding) + T5 #8 (manual: editor showed `⚠ (deleted) Pastries` after simulating Dashboard deletion via direct mirror UPDATE — see deviation note below) | ✅ |
| 9 | Position stability preserved across menu-group binding changes (regression) | T4 #23 (auto) + T5 #10 (manual: drag bound box to different cell, position unchanged + binding preserved) | ✅ |
| 10 | Integration tests cover the full surface | T4 across two files (`kds-v3-menu-groups-route.test.ts` + extension of `kds-v3-screens-routes.test.ts`) — 36/36 passing | ✅ |

---

## T5 manual walk detail (bigcafe, 2026-05-16)

### Prerequisites
- `npx tsx scripts/seed-square-test-menu.ts` — populated bigcafe's Square sandbox with 1 menu + 3 menu groups (Hot Drinks, Cold Drinks, Pastries) + 5 items (Blueberry Muffin was hard-deleted during MOK-151 T8 on 2026-05-07; Square retained the deletion across reseeds — not a phase-3 blocker, will reseed-from-scratch in phase 4+ test data work).
- `POST /api/admin/square/menu-sync` against bigcafe — mirror populated cleanly.
- Mirror state confirmed via direct DB query: 1 menu, 3 menu_groups, 5 items, 5 memberships.

### Procedure results

| Step | Description | Result |
|---|---|---|
| 1-3 | Sign in, navigate to /admin/kds-v3/screens, open a screen | ✅ |
| 4 | Click a box → Menu group dropdown appears for `menu_group` slot; option list = Hot Drinks / Cold Drinks / Pastries with item counts | ✅ |
| 5 | Bind Hot Drinks + type "☕ Brewed Hot" header override → save → reload → both persisted | ✅ |
| 6 | Toggle box to divided (Top/Bottom) with slot B = `menu_group`; bind Cold Drinks to slot B → save/reload, both bindings independent | ✅ |
| 7 | Add `image_only` box → confirm Menu group dropdown is hidden for that slot (replaced by "Image binding is configured in phase 4" hint) | ✅ |
| 8 | Simulate Dashboard deletion of Pastries → editor shows `⚠ (deleted) Pastries` in the dropdown | ✅ (deviation — see note) |
| 9 | Re-bind a divided box's slot B to a non-deleted group, save/reload | ✅ |
| 10 | Drag a bound box to a different cell → position number stable + binding preserved | ✅ |

### Deviation — Step 8: Square sandbox MENU_CATEGORY DELETE restriction

`npx tsx scripts/mutate-square-test-menu.ts delete-pastries-group` failed with:

```
Square /v2/catalog/object/<id> → 400
{ "category": "INVALID_REQUEST_ERROR",
  "code": "BAD_REQUEST",
  "detail": "client not allowed to delete [<id>] menu category objects" }
```

This is the same restriction documented in MOK-151 phase 1 verification: Square's Catalog API rejects DELETE for MENU_CATEGORY objects (only the Dashboard can delete them, and the sandbox account has no Dashboard).

**Workaround:** simulated the post-Dashboard-delete state with a direct mirror UPDATE:

```sql
UPDATE public.square_menu_categories
   SET is_deleted = true, updated_at = now()
 WHERE name = 'Pastries' AND is_top_level = false;
```

End state identical to what the sync would have written on a real webhook-driven deletion. Editor's `(deleted)` rendering verified. After the step, reverted via the same UPDATE with `is_deleted=false` so phase 4+ testing starts from a clean live-Pastries state.

This is a sandbox-environment constraint, not a product gap — production tenants will trigger deletions via the real Dashboard.

---

## Test layer summary

| Layer | Coverage | Result |
|---|---|---|
| Layer 1 — Vitest unit tests | grid-validation suite unchanged (no schema/validation primitives added in phase 3) | 115/115 ✅ |
| Layer 1 — Vitest integration tests | `kds-v3-menu-groups-route.test.ts` (new, 3 cases: M1 happy-path, M2 tenant isolation, M3 is_deleted surfacing); `kds-v3-screens-routes.test.ts` extended (15 → 23 cases for phase 3) | 36/36 ✅ across both files (3 + 23 + the 10 invoice-related cases the suite also runs — actual kds-v3 subset is 26/26) |
| Layer 2 — Manual local-dev (T5) | 10 steps including bind/unbind, header override, divided-box bindings, image_only hide, deleted-group display, position stability | All passed ✅ (step 8 with sandbox workaround) |
| Layer 3 — Rollback rehearsal | n/a — no schema changes in phase 3, no rollback SQL. Code rollback = revert the merge commit. | n/a |
| Layer 4 — Manual staging | n/a — KDS v3 ships as a single staging PR after all 7 phases | n/a |

---

## Test-data state at end of phase 3

After T5 completion + the reset step at the end of step 8:
- Bigcafe's mirror: 1 menu, 3 menu groups (all `is_deleted=false`), 5 items, 5 memberships.
- A handful of screens with test bindings created during the walk — they can stay or be cleaned up before phase 4; doesn't affect phase 4 work.

**Forward-looking (captured in working memory, not phase-3 scope):** the seed script needs to grow in phase 4+ to add (a) more menu groups, (b) combo menu groups (panini+drink+chips, etc.), (c) multi-variation items with diverse pricing for the eventual phase 6 price-display admin controls.

---

## Commit log on `kds-v3-p3-menu-group-assignment`

Tip:

```
<verification commit added by this doc>
9053b9d test(kds-v3): MOK-155 T4 — integration tests for menu-group binding
68a5c84 feat(kds-v3): MOK-155 T3 — editor picker + header override per slot
44eec60 feat(kds-v3): MOK-155 T2 — server validation for menu-group binding
8bebe98 feat(kds-v3): MOK-155 T1 — admin route GET /api/admin/kds-v3/menu-groups
df20b5f plan(kds-v3): MOK-155 phase 3 — menu group assignment
```

---

## Sign-off

- **Author:** Jerry McCommas (operator-in-the-loop verification on 2026-05-16)
- **Paired session:** Claude (T1-T4 implementation, T5 walk facilitation, T6 report)
- **Status:** Ready for sub-PR to `kds-v3` integration trunk
- **Next:** open PR `kds-v3-p3-menu-group-assignment` → `kds-v3`; begin phase 4 spec when paired bandwidth allows.
