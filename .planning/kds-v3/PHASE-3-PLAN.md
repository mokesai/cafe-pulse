# KDS v3 — Phase 3: Menu group assignment

**Spec:** [MOK-155](https://linear.app/mokesai/issue/MOK-155/kds-v3-phase-3-menu-group-assignment)
**Branch:** `kds-v3-p3-menu-group-assignment` → `kds-v3` (integration trunk) → `staging` (post-all-phases) → `main`
**Status:** Planning

## Goal

Bind each `menu_group`-typed slot (slot A on any box; slot B on a divided box where `box_type_b='menu_group'`) to one of the tenant's mirrored Square menu groups, plus an optional header override. Phase 6 will consume the binding to render the group's items on the public KDS screen.

**No DB changes.** Phase 2 + 2.5 already added the columns (`square_menu_group_id`, `square_menu_group_id_b`, `header_override`, `header_override_b`). This phase is admin-route + editor UX + validation only — no migration, no rollback rehearsal needed.

## Task breakdown (each task = one commit unless noted)

### T1 — Admin route: GET /api/admin/kds-v3/menu-groups
**Files:**
- `src/app/api/admin/kds-v3/menu-groups/route.ts` (new)

**Scope:**
Returns the current tenant's mirrored MENU_CATEGORY menu groups (the table is already MENU_CATEGORY-scoped — filter `is_top_level=false`). Shape:

```json
{
  "success": true,
  "data": [
    {
      "id": "<square_id>",
      "name": "Hot Drinks",
      "ordinal": 0,
      "item_count": 3,
      "is_deleted": false,
      "parent_menu_id": "<square_id>",
      "parent_menu_name": "KDS Test Menu"
    }
  ]
}
```

- Include rows where `is_deleted=true` so the editor can surface stale bindings as `(deleted) <name>`.
- `item_count` derived from `square_menu_item_categories` (count non-deleted item rows joined on `category_id` for the tenant).
- `parent_menu_name` joined from the parent row in `square_menu_categories` where `id = parent_id AND is_top_level=true`.
- Sort by `parent_menu_id, ordinal, name` so the editor renders a deterministic order.

**Auth:** `requireAdminAuth` + `getCurrentTenantId()` (same pattern as the screens routes).

**Acceptance:**
- Hand-test via `curl` against bigcafe after seeding + sync — returns 3 menu groups.
- Returns 401 without admin auth.
- Tenant-isolated: tenant A's request never sees tenant B's groups (covered by T4 integration test).

### T2 — Server-side validation for menu-group binding in PUT /screens/[id]
**Files:**
- `src/app/api/admin/kds-v3/screens/[id]/route.ts` (extend per-field + cross-row validation)

**Scope:**
Inside the existing `validatedBoxes` loop (after the division checks):

1. If a slot's `box_type === 'image_only'` and `square_menu_group_id` (or `_b`) is non-null → push `fieldErrors`: "image_only slot cannot bind to a menu group."
2. After the per-field shape checks pass, collect all non-null `square_menu_group_id` values from the incoming boxes (both slots). Run **one** query against `square_menu_categories` filtering `tenant_id = current_tenant AND id IN (collected_ids)`. Compare returned set vs requested set — any missing IDs are either cross-tenant or simply nonexistent. Either way → push to `validation_errors` with 422 + `KDS_SCREEN_LAYOUT_INVALID`.

The single-query batching matters: the existing PUT replaces boxes atomically; we don't want N+1 round-trips per box.

**Acceptance:**
- Existing 15 integration tests still pass.
- New T4 cases (cross-tenant, image_only-with-group, nonexistent-group) all 422.

### T3 — Editor UI: menu-group picker + header-override input
**Files:**
- `src/components/admin/kds-v3/GridEditor.tsx` (extend the selected-box panel)
- `src/components/admin/kds-v3/ScreenForm.tsx` (likely unchanged — boxes prop already plumbs everything)
- `src/app/admin/(protected)/kds-v3/screens/[id]/edit/page.tsx` (ensure `square_menu_group_id` + `header_override` flow through hydration — they may need to be added to `ApiBox` mapping like the phase 2.5 fields)

**Scope:**

In `GridEditor`, fetch the menu groups list on mount (one client-side fetch to `/api/admin/kds-v3/menu-groups`). Stash in state. Add to the selected-box panel:

For each slot whose `box_type === 'menu_group'`:
- **Menu group dropdown.** Options: `— Unbound —` (value=`''`, sends NULL to server), then one option per fetched group. Deleted groups render as `(deleted) <name>` with a small ⚠ icon; keep them selectable so a stale binding stays visible until the operator re-binds.
- **Header override input** (text, max ~60 chars). Empty = use the group's actual name; non-empty = override.

For slots where `box_type === 'image_only'`, the picker is hidden entirely (phase 4 will replace it with an image picker).

Helper functions added to `GridEditor`:
- `updateBoxMenuGroup(position: number, slot: 'a' | 'b', square_menu_group_id: string | null)`
- `updateBoxHeaderOverride(position: number, slot: 'a' | 'b', header_override: string | null)`

`EditableBox` type already has these fields (added speculatively in phase 2 + 2.5); just need to wire the UI.

**Acceptance:**
- Manual: pick a group, save, reload — binding round-trips.
- Manual: clear (set to `— Unbound —`), save, reload — NULL persisted.
- Manual: type a header override, save, reload — text persisted.
- Manual: bind, then run `mutate-square-test-menu.ts delete-pastries-group` + re-sync → editor reload shows `(deleted) Pastries` for the affected box.

### T4 — Integration tests
**Files:**
- `tests/integration/kds-v3-screens-routes.test.ts` (extend; do not duplicate file)
- `tests/integration/kds-v3-menu-groups-route.test.ts` (new — small file just for T1's route)

**New cases (1:1 with MOK-155 acceptance criteria):**

For the menu-groups route (T1):
- M1. `GET /menu-groups` returns the tenant's mirrored groups with `item_count` + `parent_menu_name`.
- M2. Tenant isolation: tenant A's request doesn't return tenant B's groups (each tenant gets its own seeded mini-menu via direct fixture inserts to `square_menu_categories` since the seed script runs against the live sandbox).

For screens-routes (T2):
- 16. PUT — bind `square_menu_group_id` on a `menu_group` slot persists; GET returns the bound id.
- 17. PUT — unbind (send `null`) clears the column to NULL.
- 18. PUT — set both `box_type` and `square_menu_group_id` on slot A, plus same on slot B of a divided box, plus a header_override on slot A → round-trip clean.
- 19. PUT — cross-tenant rejection: tenant A binds to tenant B's `square_menu_group_id` → 422 with structured `validation_errors`.
- 20. PUT — image_only-with-group rejection: slot `box_type='image_only'` + non-null `square_menu_group_id` → 422.
- 21. PUT — nonexistent-group rejection: bind to a fabricated `square_menu_group_id` not in the mirror → 422.
- 22. PUT — bound group with `is_deleted=true` accepted (the column update lands; renderer surfaces missing-reference separately).
- 23. Position stability across menu-group binding changes (regression).

**Fixture approach:** the integration test suite uses `createTenantForTest` + direct DB inserts, not the live Square sandbox. T4 helper: a small `seedTestMenuGroup(tenantId, name, opts?)` that inserts a row into `square_menu_categories` so the validator + route have something to read. Keeps the tests deterministic + isolated from the actual Square sandbox state.

**Acceptance:**
- `npm run test:integration -- kds-v3` covers both files; all green.
- `npm run test:unit`, `npm run lint`, `npm run build` clean.

### T5 — Manual end-to-end against bigcafe
Mirrors phase 2's T8 + phase 2.5's T6.

**Prerequisites:**
1. Ensure the seed script has populated bigcafe's Square sandbox: `npx tsx scripts/seed-square-test-menu.ts`.
2. Trigger a menu sync: `POST http://bigcafe.localhost:3000/api/admin/square/menu-sync` with `{ "fullResync": true }` (curl or admin UI).
3. Verify the mirror picked up 1 menu + 3 menu groups + 6 items via the existing menu-sync diagnostic or a direct query.

**Procedure:**
1. Sign in to `http://bigcafe.localhost:3000` as a bigcafe admin.
2. Navigate to `/admin/kds-v3/screens`. Open an existing screen (or create a new 4×6 warm one).
3. Click a box → selected-box panel shows the new Menu-group dropdown (since `box_type='menu_group'`).
4. Pick **Hot Drinks** from the dropdown. Optionally type a header override like "☕ Brewed Hot".
5. Save. Reload. Confirm the dropdown shows "Hot Drinks" selected and the header override field shows the typed text.
6. Toggle the box to divided (Top/Bottom) — set slot B's type to `menu_group`. Slot B gets its own Menu-group dropdown. Pick **Cold Drinks** there. Save, reload. Both bindings persist independently.
7. Add another box with `box_type='image_only'` — the Menu-group dropdown should be **hidden** for that slot (it's an image slot; binding waits for phase 4).
8. Run `npx tsx scripts/mutate-square-test-menu.ts delete-pastries-group` + re-sync. Reload the screen → if any box was bound to Pastries, the dropdown shows `(deleted) Pastries` with the warning badge.
9. On a divided box bound to a deleted group, re-bind slot B to a non-deleted group. Save, reload, confirm clean state.
10. Drag a bound box to a different cell. Confirm position stable + binding preserved.

**Acceptance:**
- All 10 manual steps pass.
- Captured in `.planning/kds-v3/PHASE-3-VERIFICATION.md` (T6).

### T6 — Verification report
**Files:**
- `.planning/kds-v3/PHASE-3-VERIFICATION.md` (new)

**Procedure:**
1. Map each MOK-155 acceptance criterion to its evidence (T1 route inspection, T2/T4 tests, T3+T5 editor, T4 integration cases).
2. Note the test-data prerequisites for T5 (seed + sync commands actually run + their output).
3. Note the no-schema-change → no-rollback-rehearsal stance: code rollback = revert the merge commit.
4. Document any deviations from the plan.
5. Sign-off line.

**Acceptance:**
- All MOK-155 acceptance criteria checked off with evidence pointers.
- Doc filled in with timestamps + sign-off.

## Dependencies / ordering rationale
- T1 must precede T2 (route is what the validator consults — actually no, T2 reads `square_menu_categories` directly, not the route). T1 + T2 can land in either order; doing T1 first lets us hand-test the route in isolation.
- T3 must follow T1 (editor fetches from it) and T2 (editor relies on server-side validation for save errors).
- T4 needs T1 + T2 + T3.
- T5 + T6 are end-of-phase.

## Risk areas

### 1. Tenant isolation on cross-row validation (HIGH — mitigated by integration tests)

The cross-tenant check in T2 is the load-bearing security boundary. If a malicious request sends a `square_menu_group_id` belonging to tenant B, the validator MUST reject — otherwise tenant A's screen could render tenant B's menu items in phase 6.

Mitigation: T4 case 19 explicitly seeds two tenants' menu groups via fixture and asserts that tenant A's PUT with tenant B's `square_menu_group_id` returns 422. The validator implementation queries `WHERE tenant_id = current_tenant AND id IN (collected_ids)` — Postgres handles the filter; we just verify the test fires.

### 2. Deleted-group display vs auto-clear (LOW — explicit design choice)

When the operator binds a box to "Hot Drinks", then Hot Drinks is deleted in Square (sync mirrors `is_deleted=true`), the binding stays on `kds_grid_boxes` until the operator re-binds. This is intentional:
- Auto-clearing on sync would silently drop operator intent. Operator might not notice for days.
- Surfacing as `(deleted) Hot Drinks` in the editor flags the issue without losing intent.
- Phase 6 renderer treats `is_deleted=true` bindings as "render nothing" or "render placeholder" — that's phase 6's call.

No mitigation needed beyond the editor surfacing it.

### 3. N+1 query risk in validation (LOW — explicit batching)

If the validator queries `square_menu_categories` once per box, a screen with 12 boxes triggers 12 round-trips. T2 explicitly batches: collect all referenced `square_menu_group_id` values across all boxes, run one `SELECT id WHERE tenant_id=? AND id IN (...)`, compare sets.

### 4. Menu-sync staleness during editing (LOW — accepted)

If the operator opens the editor, Square fires a webhook that adds a new menu group, the editor's dropdown won't show it until reload. Acceptable — the dropdown is loaded once on mount. A "refresh" button is possible but not in scope.

## Verification checkpoints

| MOK-155 acceptance | Verified by |
|---|---|
| GET /menu-groups returns tenant-scoped rows with item_count + parent_menu_name | T1 + T4 case M1 |
| Picker surfaces for menu_group slots; clear sends NULL; saving persists | T3 + T5 #4-5 |
| Header override round-trips per slot | T4 #18 + T5 #5 |
| Divided box has independent picker + override per slot | T3 + T5 #6 |
| Cross-tenant rejection (422) | T2 + T4 #19 |
| image_only-with-group rejection (422) | T2 + T4 #20 |
| Nonexistent-group rejection (422) | T2 + T4 #21 |
| Deleted group renders as (deleted) <name> | T3 + T5 #8 |
| Position stability across binding changes | T4 #23 + T5 #10 |
| Integration tests | T4 (8 new cases) |

## Out of scope (per MOK-155)
- Image_only binding → Phase 4
- Aesthetic image library → Phase 4
- Per-item display overrides → Phase 5
- Public renderer for the bound group → Phase 6
- Price-display admin controls (lowest / range / per-variation table) → Phase 6
- Combo menu group rendering → Phase 6
- Drag-reordering menu groups in the picker — honor Square's `ordinal`

## Rollback contract
**No DB schema changes.** Rollback = revert the merge commit (or open a follow-up PR that removes the route, validation, and editor sections). No rollback SQL file; no T7-style rehearsal needed.

If a critical bug ships, follow-up steps: revert PR, redeploy. The `square_menu_group_id` data on `kds_grid_boxes` remains intact — no destructive change to clean up. Operators on KDS v3 phases 1/2/2.5 keep working uninterrupted.

## Done criteria for phase 3
- All T1-T6 commits on `kds-v3-p3-menu-group-assignment`, each with green CI.
- `PHASE-3-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-p3-menu-group-assignment` → `kds-v3` opened, reviewed, merged.
- Phase 4 spec drafting begins.
