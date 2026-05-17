# KDS v3 — Phase 5: Per-item / per-variation display overrides

**Spec:** [MOK-157](https://linear.app/mokesai/issue/MOK-157/kds-v3-phase-5-per-item-per-variation-display-overrides)
**Branch:** `kds-v3-p5-item-overrides` → `kds-v3` (integration trunk) → `staging` (post-all-phases) → `main`
**Status:** Planning

## Goal

Schema + admin page + routes so operators can override how individual Square items / variations display on KDS screens — alt display name, alt image (from phase 4's library), hidden flag. Phase 6's renderer applies the overrides on `/kds/*`; phase 5 ships the data layer + admin surface only.

## Task breakdown (each task = one commit unless noted)

### T1 — Forward migration: `kds_display_overrides`
**Files:**
- `supabase/migrations/<CLI-timestamp>_kds_v3_phase_5_display_overrides.sql` (authored via `supabase migration new` per the always-CLI rule)

**Scope:**
Create `kds_display_overrides`:

```sql
CREATE TABLE public.kds_display_overrides (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     uuid        NOT NULL,
  target_kind                   text        NOT NULL CHECK (target_kind IN ('item','variation')),
  target_id                     text        NOT NULL,
  alt_display_name              text        CHECK (alt_display_name IS NULL OR length(alt_display_name) <= 120),
  alt_image_aesthetic_image_id  uuid        REFERENCES public.kds_aesthetic_images(id) ON DELETE SET NULL,
  hidden_from_kds               boolean     NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, target_kind, target_id)
);

CREATE INDEX kds_display_overrides_tenant_target_idx
  ON public.kds_display_overrides (tenant_id, target_kind);
```

Add a "not all defaults" cross-column CHECK to enforce that any row actually carries an override (defense against orphan empty rows even though the route auto-deletes):

```sql
ALTER TABLE public.kds_display_overrides
  ADD CONSTRAINT kds_display_overrides_not_empty CHECK (
    alt_display_name IS NOT NULL
    OR alt_image_aesthetic_image_id IS NOT NULL
    OR hidden_from_kds = true
  );
```

Plus RLS:
- `tenant_staff_select_kds_display_overrides` — SELECT
- `tenant_admin_{insert,update,delete}_kds_display_overrides` — write trio

`tenant_id` NOT NULL with no default per the MOK-107-class defense.

**Acceptance — 5-case battery:**

| # | target_kind | target_id | alt_display_name | alt_image | hidden | Expected |
|---|---|---|---|---|---|---|
| 1 | `'item'` | `'sq_item_1'` | `'Strong Espresso'` | NULL | false | PASS |
| 2 | `'variation'` | `'sq_var_1'` | NULL | NULL | true | PASS |
| 3 | `'item'` | `'sq_item_2'` | NULL | NULL | false | CHECK_VIOLATION (not_empty) |
| 4 | `'sandwich'` | `'sq_item_3'` | `'foo'` | NULL | false | CHECK_VIOLATION (target_kind enum) |
| 5 | duplicate of case 1 (same tenant + kind + target_id) | | | | | UNIQUE_VIOLATION |

Plus FK-on-image: setting `alt_image_aesthetic_image_id` to a non-existent uuid → FK violation; setting to a real image then hard-deleting the image → row's `alt_image_aesthetic_image_id` becomes NULL (SET NULL behavior).

### T2 — Rollback SQL
**Files:**
- `.planning/kds-v3/PHASE-5-ROLLBACK.sql`

**Scope:**
- DROP POLICY × 4
- DROP TABLE `kds_display_overrides`
- DELETE the schema_migrations row

No FK from any other table to this one (phase 6 renderer reads it but doesn't reference it via FK), so DROP is clean.

### T3 — List / item PUT/DELETE / variation PUT/DELETE routes
**Files:**
- `src/app/api/admin/kds-v3/display-overrides/route.ts` (new — GET list)
- `src/app/api/admin/kds-v3/display-overrides/items/[id]/route.ts` (new — PUT / DELETE)
- `src/app/api/admin/kds-v3/display-overrides/variations/[id]/route.ts` (new — PUT / DELETE)

**Scope:**

`GET /api/admin/kds-v3/display-overrides` — returns every override row for the tenant.

```json
{
  "success": true,
  "data": [
    { "id": "...", "target_kind": "item", "target_id": "sq_item_...",
      "alt_display_name": "...", "alt_image_aesthetic_image_id": "uuid",
      "alt_image_thumbnail_url": "<signed or external>",
      "hidden_from_kds": false, "created_at": "...", "updated_at": "..." },
    ...
  ]
}
```

`alt_image_thumbnail_url` is computed server-side same way as phase 4's image list (signed URL for uploaded, pass-through for external). Single batched `createSignedUrls()` for uploaded images.

`PUT /api/admin/kds-v3/display-overrides/items/[square_item_id]` — upsert. Body:
```json
{ "alt_display_name": "..." | null, "alt_image_aesthetic_image_id": "uuid" | null, "hidden_from_kds": boolean }
```

Validation:
1. `square_item_id` exists in `square_menu_items` for the current tenant (cross-tenant + nonexistent rejection 422 `KDS_DISPLAY_OVERRIDE_TARGET_NOT_FOUND`).
2. `alt_image_aesthetic_image_id` (if set) exists in `kds_aesthetic_images` for the current tenant (cross-tenant rejection 422 — same pattern as phases 3/4).
3. `alt_display_name` length ≤ 120 chars.
4. **Auto-delete-on-defaults**: if the resulting state would be `alt_display_name IS NULL AND alt_image_aesthetic_image_id IS NULL AND hidden_from_kds = false`, DELETE the row instead of upserting. Return 200 with `{ success: true, deleted: true }`.

`PUT /api/admin/kds-v3/display-overrides/variations/[square_variation_id]` — same shape, `target_kind='variation'`, validates against `square_menu_item_variations`.

`DELETE /api/admin/kds-v3/display-overrides/items/[square_item_id]` — explicit drop. Returns 200 even if no row exists (idempotent).
`DELETE /api/admin/kds-v3/display-overrides/variations/[square_variation_id]` — same.

**Acceptance:**
- Hand-test each route via curl against bigcafe after seeding test menu data.
- Auto-delete works (PUT with all defaults → row gone).
- Tenant-isolated (covered by T5 integration tests).

### T4 — Admin page: menu-group selector + nested item-variation table
**Files:**
- `src/app/admin/(protected)/kds-v3/display-overrides/page.tsx` (new — thin client wrapper)
- `src/components/admin/kds-v3/DisplayOverridesPage.tsx` (new — actual UI)
- `src/components/admin/AdminNavigation.tsx` (add sidebar entry "KDS v3 — Overrides")

**Scope:**

The page fetches three things on mount:
1. Menu groups list (reuse `GET /api/admin/kds-v3/menu-groups`).
2. Aesthetic images list (reuse `GET /api/admin/kds-v3/aesthetic-images`) — feeds the alt-image dropdowns.
3. Existing overrides list (`GET /api/admin/kds-v3/display-overrides`) — keyed by `(target_kind, target_id)` for quick lookup as the operator scrolls items.

When the operator picks a menu group, fetch items + variations in that group via a new helper endpoint OR an inline Supabase select (TBD in T4 implementation — leaning toward a small helper endpoint `GET /api/admin/kds-v3/menu-groups/[id]/items` for clean tenant-scoping).

Render the nested table:
```
Espresso          [alt name: ___] [alt image: ___▾] [hide ☐]
  ├ Single        [alt name: ___] [alt image: ___▾] [hide ☐]
  └ Double        [alt name: ___] [alt image: ___▾] [hide ☐]

Croissant         [alt name: ___] [alt image: ___▾] [hide ☐]
```

Each row's three controls are populated from the overrides map (if present) or defaults. Changes debounce ~500 ms then PUT to the appropriate route. Failure surfaces in a small inline error per row; success silently updates the local state.

Inlined plain-HTML + Tailwind per the webpack-dev gotcha.

**New helper endpoint:**
- `GET /api/admin/kds-v3/menu-groups/[id]/items` — returns items + variations for the given group, tenant-scoped. Lives at the same routes path as `GET /menu-groups`.

**Acceptance:**
- Manual: pick a menu group → see items + variations → toggle hide on one variation → save (auto) → verify row in DB.
- Set alt name + alt image on an item → save → verify.
- Clear all three on a row → row auto-deletes.

### T5 — Integration tests
**Files:**
- `tests/integration/kds-v3-display-overrides-route.test.ts` (new)
- `tests/integration/helpers/tenant.ts` (extend with `seedTestSquareItem` + `seedTestSquareVariation` fixtures — if the existing menu-group fixture doesn't cover them, add wrappers)

**New cases (~10):**
1. PUT item override creates the row with `target_kind='item'`.
2. PUT variation override creates the row with `target_kind='variation'`.
3. PUT with all defaults → auto-delete (returns `{ deleted: true }`).
4. PUT to a `square_item_id` that doesn't exist for the tenant → 422 `KDS_DISPLAY_OVERRIDE_TARGET_NOT_FOUND`.
5. PUT to a `square_variation_id` that doesn't exist for the tenant → 422.
6. PUT with cross-tenant `alt_image_aesthetic_image_id` → 422.
7. PUT round-trip: set, GET list, see the row with `alt_image_thumbnail_url` populated for the bound image.
8. Re-PUT updates the existing row (idempotent upsert, same UNIQUE key).
9. DELETE removes the row; DELETE again returns 200 (idempotent).
10. Tenant isolation on GET — tenant A doesn't see tenant B's overrides.

**Fixture additions:**
- `seedTestSquareItem(tenant, opts?)` — inserts a row into `square_menu_items` (and updates a parent category if needed for the group helper).
- `seedTestSquareVariation(tenant, opts?)` — inserts into `square_menu_item_variations`.

Both bypass the live Square sandbox — direct DB inserts, same approach as phase 3's `seedTestMenuGroup`.

**Acceptance:**
- `npm run test:integration -- kds-v3` covers all four kds-v3 test files; all green.
- `npm run test:unit`, `npm run lint`, `npm run build` clean.

### T6 — Manual walk on bigcafe
Same shape as previous phases' manual walks.

**Prerequisites:**
- T1 migration applied via `supabase db push` (during T1 commit).
- Test menu seeded on bigcafe + synced (same as phase-3 prereqs; reuses the existing `scripts/seed-square-test-menu.ts` output).
- At least one aesthetic image in the library (uploaded or external — easy to add via phase 4's library page).

**Procedure:**
1. Sign in to `http://bigcafe.localhost:3000` as a bigcafe admin.
2. Navigate to `/admin/kds-v3/display-overrides`. Sidebar entry surfaces under KDS v3.
3. Menu-group dropdown shows the tenant's groups. Pick **Hot Drinks**.
4. Nested table renders Espresso + its variations (Single, Double).
5. Set an alt name on Espresso (item level) — e.g. "Strong Espresso". Debounce save fires; reload the page; alt name is still there.
6. Set an alt image on Single (variation level) — pick one from the dropdown. Save → reload → still bound.
7. Toggle hide on Double. Save → reload → still hidden.
8. Clear all three on Espresso (delete alt name, leave hide off, alt image at default). Auto-delete fires → row gone in DB.
9. Cross-page consistency: switch to Cold Drinks → only Cold Drinks items shown. Switch back to Hot Drinks → Espresso row reflects current state (no override since step 8).
10. Try to override an item whose menu group has been deleted in Square (use the `is_deleted` flip we documented in MOK-155 if needed). The override page should still let you bind to the item (override targets the item, not the group).

**Acceptance:**
- All 10 manual steps pass.
- Captured in `.planning/kds-v3/PHASE-5-VERIFICATION.md` (T7).

### T7 — Rollback rehearsal + verification report
**Files:**
- `.planning/kds-v3/PHASE-5-VERIFICATION.md` (new)

**Procedure:**
1. Pre-snapshot dev state (override count, screens count, boxes count).
2. Execute `PHASE-5-ROLLBACK.sql` against cafe-pulse-dev.
3. Confirm: 0 `kds_display_overrides` table, 0 phase-5 schema_migrations rows. Phase 4 schema (including `kds_aesthetic_images`) untouched.
4. Re-apply via `supabase db push`. Confirm clean.
5. Idempotency test: re-execute the T1 migration SQL once more; verify no errors, no schema changes.
6. Document run + sign-off in PHASE-5-VERIFICATION.md.

**Acceptance:**
- Rollback SQL produces clean state on first try.
- Migration re-apply is idempotent.
- Verification doc filled in with all checkboxes ✓.

## Dependencies / ordering rationale
- T1 must precede T3-T7 (everything reads/writes the new table).
- T2 should land alongside T1.
- T3 must precede T4 (page consumes the routes) and T5 (tests hit the routes).
- T4 must precede T6 (manual walk uses the page).
- T5 needs T3.
- T6 + T7 end-of-phase.

## Risk areas

### 1. Auto-delete-on-defaults race (LOW — single transaction)

The PUT route's logic: "compute the resulting state; if all defaults, DELETE; else UPSERT." Done as a single Supabase transaction with the same `(tenant_id, target_kind, target_id)` predicate — no TOCTOU window between the check and the action.

### 2. Polymorphic target with no FK (LOW — tolerable orphans)

`target_id` doesn't FK to Square mirror tables because the target is conditional on `target_kind`. Route-layer validation catches new orphans on PUT. Existing rows can become orphans if Square hard-deletes the target post-creation — phase 6's renderer skips overrides whose `target_id` doesn't resolve, so no display breakage. A cleanup job for stale orphan rows is a future enhancement.

### 3. Render-time precedence ambiguity (LOW — frozen in spec)

Variation override > item override > Square default. Frozen in MOK-157 + this plan; phase 6's renderer consumes the precedence rule verbatim.

### 4. CLI discipline (LOW — enforced by process)

T1 authored via `supabase migration new` + applied via `supabase db push`, per the always-CLI rule.

## Verification checkpoints

| MOK-157 acceptance | Verified by |
|---|---|
| Migration + CHECK + UNIQUE + FK | T1 + 5-case battery + FK SET NULL test |
| New admin page lists items + variations with inline override controls | T4 + T6 #2-9 |
| PUT item override persists | T5 #1 (auto) + T6 #5 (manual) |
| PUT variation override persists | T5 #2 + T6 #6-7 |
| Cross-tenant target rejection | T5 #4, #5 |
| Cross-tenant image rejection | T5 #6 |
| Auto-delete-on-defaults | T5 #3 + T6 #8 |
| DELETE is idempotent | T5 #9 |
| Soft-deleted aesthetic image still acceptable | T5 (add a case) — bind to is_deleted=true image; PUT succeeds |
| Integration tests + tenant isolation | T5 |

## Out of scope (per MOK-157)
- Phase 6 renderer that applies the overrides → Phase 6.
- Bulk operations.
- Override management inside the screen editor (overrides have their own page).
- Per-variation pricing display controls → Phase 6.
- Square channel-visibility integration → captured as v2 forward-looking note in MOK-157.

## Rollback contract
Drops the `kds_display_overrides` table + 4 RLS policies. Phase 1-4 schema is untouched. The FK from `alt_image_aesthetic_image_id` to `kds_aesthetic_images(id)` goes with the table — no cleanup needed on the aesthetic images side.

Rollback window remains open through phases 6-7 (the table can be re-created at any time as long as no other artifact has been built on top).

## Done criteria for phase 5
- All T1-T7 commits on `kds-v3-p5-item-overrides`, each with green CI.
- `PHASE-5-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-p5-item-overrides` → `kds-v3` opened, reviewed, merged.
- Phase 6 spec drafting begins.
