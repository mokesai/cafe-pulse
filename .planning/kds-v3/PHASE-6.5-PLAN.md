# KDS v3 — Phase 6.5: Draft / Published workflow + variation-emphasis polish

**Spec:** [MOK-159](https://linear.app/mokesai/issue/MOK-159)
**Branch:** `kds-v3-p6.5-publish` → `kds-v3` (integration trunk) → `staging` (post-all-phases) → `main`
**Status:** Planning

## Goal

Close the loop between **admin iteration** and **TV display**. Today every save on the edit page is immediately visible to any paired Pi. Phase 6.5 adds an explicit **publish step** so the operator can iterate freely on a draft without affecting any live TVs.

Plus one polish item (operator-pickable variation emphasis — replaces the hardcoded `Grande / Medium` regex from phase 6).

Phase 6.5 is the gate to reviving the **KDS Raspberry Pi Deployment** project.

## Task breakdown (each task = one commit unless noted)

### T0 — Schema migration: snapshot tables + tick columns
**Files:**
- `supabase/migrations/<CLI-timestamp>_kds_v3_phase_6_5_published_snapshots.sql` (via `supabase migration new`)

**Scope:**
Two snapshot tables that mirror the draft tables 1:1 in shape:

```sql
CREATE TABLE public.kds_published_screens (LIKE public.kds_screens INCLUDING ALL);
CREATE TABLE public.kds_published_grid_boxes (LIKE public.kds_grid_boxes INCLUDING ALL);
```

`INCLUDING ALL` copies defaults, constraints (including CHECKs), indexes. RLS policies copied explicitly afterward (RLS isn't inherited by `LIKE`).

Two new timestamp columns for the "has unpublished changes" badge:
- `kds_screens.draft_updated_at timestamptz NOT NULL DEFAULT now()` — ticks on any draft mutation
- `kds_published_screens.published_at timestamptz NOT NULL DEFAULT now()` — ticks on publish

Plus an FK from `kds_published_grid_boxes.screen_id` → `kds_published_screens.id` ON DELETE CASCADE so deleting a published screen takes its boxes with it.

**Backfill (load-bearing):** first-run defensive copy populates the snapshot tables from current draft state for every existing screen. Pi devices keep rendering exactly what they render today — no blank screens during deploy.

```sql
INSERT INTO public.kds_published_screens SELECT * FROM public.kds_screens;
INSERT INTO public.kds_published_grid_boxes SELECT * FROM public.kds_grid_boxes;
```

**Acceptance — corner battery:**
1. Snapshot tables exist with same columns + CHECK constraints as drafts.
2. RLS policies installed on snapshot tables (`tenant_staff_select`, `tenant_admin_{insert,update,delete}` — same pattern as draft tables).
3. FK from published_grid_boxes.screen_id → published_screens.id with ON DELETE CASCADE.
4. After migration: row counts match between draft and published tables for every existing tenant.
5. `draft_updated_at` and `published_at` populated on all rows (default `now()`).

### T1 — Rollback SQL
**Files:**
- `.planning/kds-v3/PHASE-6.5-ROLLBACK.sql`

**Scope:**
Drops both snapshot tables (CASCADE for FK), drops `draft_updated_at` from `kds_screens`, drops `emphasized_variation_name` / `_b` from `kds_grid_boxes` (added in T5), deletes the schema_migrations rows.

**Acceptance:**
- Lives outside `supabase/migrations/`.
- Rehearsed in T8.
- After rollback: phase 6 schema fully intact, Pi keeps reading the original `kds_screens` / `kds_grid_boxes` tables (since render-fetch will default back to those when the snapshot tables are gone).

### T2 — Publish + discard-draft API routes
**Files:**
- `src/app/api/admin/kds-v3/screens/[id]/publish/route.ts` (new — POST)
- `src/app/api/admin/kds-v3/screens/[id]/discard-draft/route.ts` (new — POST)
- `src/lib/kds/publish.ts` (new — shared transactional helper)

**Scope:**

Publish:
- Wrap in a single PL/pgSQL function so the draft snapshot + box replace happen atomically (no half-published state if the connection drops):
  ```sql
  CREATE OR REPLACE FUNCTION publish_kds_screen(p_tenant_id uuid, p_screen_id uuid) RETURNS json AS $$
  -- DELETE existing published rows for screen
  -- INSERT screen + boxes from draft
  -- UPDATE published_at = now() on the screen row
  -- RETURN diff summary as json
  $$;
  ```
- Route validates tenant ownership of the draft screen, calls the RPC, returns:
  ```json
  { "success": true, "data": { "published_at": "...", "diff": { "added": 1, "changed": 2, "removed": 0 } } }
  ```
- Diff summary computed by comparing the just-replaced published rows against what was there before. Approximate but useful for the confirm dialog.

Discard-draft:
- Inverse of publish: copy published → draft (replace draft boxes from published snapshot).
- If no published version exists yet, returns 422 ("nothing to revert to").

Both routes admin-only via `requireAdminAuth` + tenant-scoped via `getCurrentTenantId`.

**Acceptance:**
- Publish returns 200 + diff summary.
- Discard returns 200 when published exists, 422 when not.
- Cross-tenant PUT: tenant A's publish of tenant B's screen returns 404.
- Idempotent: publishing twice in a row produces the second publish with diff `{added: 0, changed: 0, removed: 0}`.

### T3 — `resolveScreenForRender` source-selection
**Files:**
- `src/lib/kds/v3-render.ts` (extend)
- `src/app/kds/v3/[deviceId]/[screenId]/page.tsx` (pass `source: 'published'`)
- `src/app/api/admin/kds-v3/screens/[id]/render/route.ts` (already used by admin preview — switch default to `'draft'`)
- `src/app/admin/(protected)/kds-v3/screens/[id]/preview/page.tsx` (standalone preview reads draft too)

**Scope:**

Add `source: 'published' | 'draft'` parameter to `resolveScreenForRender` (default `'published'`). The function selects from the matching set of tables (`kds_published_*` for published, original draft tables for draft).

All other resolution logic — override precedence, hidden-from-KDS filtering, signed URLs, sort order — is unchanged.

Box + box content (categories, items, variations, overrides, images) are all draft-side. Only the box LAYOUT (which menu group is bound, layout_mode, formatting columns) snapshots. This is a deliberate choice: Square data + overrides + images are always live; only the screen composition is versioned.

**Acceptance:**
- Pi-equivalent call returns boxes from the published snapshot.
- Admin-equivalent call returns boxes from the draft.
- Same screen with different draft vs published states returns different `ResolvedBox[]` for the two sources.

### T4 — Editor: publish button + discard + badge
**Files:**
- `src/components/admin/kds-v3/ScreenForm.tsx` (or a sibling component for the toolbar — TBD)
- `src/app/admin/(protected)/kds-v3/screens/[id]/edit/page.tsx`
- `src/components/admin/kds-v3/PublishStatusBadge.tsx` (new — small reusable pill)

**Scope:**

Publish button:
- Primary button in the edit page header, next to the Edit/Preview tab strip.
- Disabled when no unpublished changes.
- Confirm dialog: "Publish 3 changes? +1 box, ~2 edited, -0 removed. Visible on Pi within ~30s."
- On success: refresh badge to "Up to date", refresh preview source if currently viewing preview tab.

Discard button:
- Less prominent affordance (text-link / outlined button) next to publish.
- Disabled when no unpublished changes.
- Confirm dialog: "Discard your unpublished changes? Draft will revert to the last-published version."
- On success: reload the form's `initial` from the new draft state (which is now == published).

PublishStatusBadge component:
- Reusable pill — accepts `unpublished: boolean`.
- "Unpublished changes" (amber pill) vs "Up to date" (gray pill).

**Acceptance:**
- Publish + discard buttons work end-to-end.
- Badge updates after save / publish / discard.
- Manual walk on bigcafe (T8).

### T5 — Variation emphasis: column + editor + renderer
**Files:**
- Migration (added to T0's migration file): `ADD COLUMN emphasized_variation_name text, emphasized_variation_name_b text` on `kds_grid_boxes`
- `src/components/admin/kds-v3/GridEditor.tsx` (per-slot dropdown)
- `src/components/kds/v3/VariationColumnHeaderRenderer.tsx` (consume the column instead of regex)
- `src/lib/kds/v3-render.ts` (fetch + pass through new fields)
- `src/app/api/admin/kds-v3/screens/[id]/route.ts` (route validation + persistence)
- `src/app/admin/(protected)/kds-v3/screens/[id]/edit/page.tsx` (ApiBox + hydration)

**Scope:**

New nullable text column `emphasized_variation_name` + `_b` mirror. No CHECK constraint on values — operator picks from the canonical set the bound group produces, and the value is the variation `display_name` string. A stale value (variation renamed in Square) just produces no-match → no emphasis → graceful fallback.

Editor: per-slot dropdown surfaces only when `layout_mode === 'variation_column_header'`. Options:
- "Auto (match Grande / Medium / M)" → null in DB → existing regex heuristic fires
- "None" → magic value, e.g. `__none__` mapped to a sentinel
- Each variation name in the canonical set the bound group currently produces

Wait — "None" needs a sentinel since the absence-of-value (null) already means "Auto". Two ways:
1. Two-column design: `emphasized_variation_name text NULL` + `emphasized_variation_explicit_none boolean NOT NULL DEFAULT false`. Clean but two columns.
2. Special string sentinel `'__none__'` in the column. Ugly but compact.
3. Single column with a third state via a CHECK constraint pattern.

**Lean: option 1 (two columns).** Cleaner; explicit.

Renderer (T7's existing `VariationColumnHeaderRenderer`):
- If `emphasized_variation_explicit_none` → no emphasis
- Else if `emphasized_variation_name` is set → emphasize that column (case-insensitive name match)
- Else (auto) → existing regex heuristic

**Acceptance:**
- Editor dropdown populated from canonical set + "Auto" + "None".
- Picked variation persists round-trip.
- Renderer honors the picked variation; falls back to regex when "Auto"; emphasizes nothing when "None".

### T6 — Screens list: per-screen unpublished pill
**Files:**
- `src/app/admin/(protected)/kds-v3/screens/page.tsx`
- `src/app/api/admin/kds-v3/screens/route.ts` (GET list — add `unpublished` per row)

**Scope:**

GET list endpoint returns `unpublished: boolean` per screen alongside the existing fields. Compute via:
```sql
SELECT s.*, (
  NOT EXISTS (SELECT 1 FROM kds_published_screens WHERE id = s.id)
  OR s.draft_updated_at > (SELECT published_at FROM kds_published_screens WHERE id = s.id)
) AS unpublished
FROM kds_screens s
WHERE tenant_id = $1
```

Or batch-fetch published_at into a Map in JS — equivalent perf, simpler SQL.

Screens list page renders the badge in each row.

**Acceptance:**
- Newly-created screens (no published row yet) show "Unpublished changes".
- After publish: badge shows "Up to date".
- After edit-and-save (without publish): badge flips back to "Unpublished changes".

### T7 — Integration tests
**Files:**
- `tests/integration/kds-v3-publish-route.test.ts` (new — ~6 cases)
- `tests/integration/kds-v3-render-fetch.test.ts` (extend — 2 new cases for source-selection)
- `tests/integration/kds-v3-screens-routes.test.ts` (extend — 1-2 cases for emphasized_variation round-trip)

**Scope:**

Publish-route cases:
1. Publish creates published rows when none exist; diff = `{added: <box_count>, changed: 0, removed: 0}`.
2. Publish replaces existing published rows; diff reflects added/changed/removed since last publish.
3. Discard-draft replaces draft from published when published exists; 422 when not.
4. Cross-tenant publish: tenant A publishing tenant B's screen returns 404.
5. Publish updates `kds_published_screens.published_at` to now().
6. Idempotent publish: second publish with no draft changes returns diff `{0, 0, 0}`.

Render-fetch cases:
7. `resolveScreenForRender(..., { source: 'published' })` returns the published boxes, not the draft boxes (verified by editing draft, NOT publishing, then asserting old boxes).
8. `resolveScreenForRender(..., { source: 'draft' })` returns the draft boxes (asserted by checking the edited box's properties match the draft state).

Emphasized-variation cases:
9. PUT `emphasized_variation_name='Grande'` on a slot persists + round-trips on GET.
10. PUT `emphasized_variation_explicit_none=true` overrides any emphasis.

**Acceptance:** All cases pass. Existing kds-v3 integration suite still green (no regressions).

### T8 — Rollback rehearsal + verification report
**Files:**
- `.planning/kds-v3/PHASE-6.5-VERIFICATION.md`

**Scope:**
1. Snapshot dev state (kds_screens count, kds_grid_boxes count, kds_published_screens count, etc.).
2. Execute PHASE-6.5-ROLLBACK.sql against cafe-pulse-dev.
3. Confirm: snapshot tables dropped, `draft_updated_at` removed, `emphasized_variation_*` columns removed.
4. Re-apply via `supabase db push`; confirm clean + idempotent.
5. Manual walk on bigcafe with steps + sign-off block.

## Dependencies / ordering rationale

- T0 must precede everything else (schema is the foundation).
- T1 paired with T0.
- T2 needs T0 (the snapshot tables).
- T3 needs T0 (source-selection reads from snapshot tables).
- T4 needs T2 + T3 (UI calls publish/discard routes; reads source via existing render endpoint).
- T5 needs T0 (the migration also adds the emphasized_variation columns).
- T6 needs T2 (compute unpublished from `published_at`).
- T7 needs all prior tasks.
- T8 last.

## Risk areas

### 1. Atomicity of publish (LOW — handled by RPC)

Publishing is a 2-step operation (delete existing snapshot, copy from draft). Without a transaction, a crash mid-publish leaves a half-snapshot. Mitigation: PL/pgSQL function so the whole thing happens in one DB transaction.

### 2. First-run defensive copy semantics (LOW — explicit acceptance criterion)

If the migration's defensive `INSERT INTO snapshot SELECT * FROM draft` fails (e.g. constraint violation we didn't think of), Pi devices that point at v3 would see blank screens on next render. Mitigation: T0 acceptance #4 (count match) catches this before the migration commits.

### 3. Render-fetch source-selection regression (MEDIUM — covered by T7 #7, #8)

If `resolveScreenForRender` ever silently falls back to draft when source='published' is requested (e.g. due to a typo in the SELECT), Pi devices would render the draft. T7's source-selection assertions catch this.

### 4. "Unpublished" badge accuracy (LOW — straightforward timestamp compare)

The compare is `draft_updated_at > published_at`. If `published_at` isn't updated on every publish (or is updated wrong), the badge lies. T7 #5 + T6 acceptance catch this.

### 5. Variation-emphasis Auto/None tri-state (LOW — design choice)

Two-column design (`emphasized_variation_name` + `emphasized_variation_explicit_none`) avoids magic-string sentinels. Slight schema noise but clean semantics.

## Verification checkpoints

| MOK-159 acceptance | Verified by |
|---|---|
| Snapshot tables + constraints + defensive copy | T0 + acceptance battery |
| `draft_updated_at` / `published_at` tick correctly | T0 + T7 #5 |
| Publish route + diff summary | T2 + T7 #1, #2, #6 |
| Discard-draft route | T2 + T7 #3 |
| Render-fetch source-selection | T3 + T7 #7, #8 |
| Pi route reads published; admin reads draft | T3 + T7 #7, #8 |
| Publish button + confirm + diff | T4 + T8 manual walk |
| Discard button + confirm | T4 + T8 manual walk |
| Per-screen "Unpublished changes" pill | T6 + T8 manual walk |
| Emphasized-variation column + dropdown + renderer | T5 + T7 #9, #10 |
| Cross-tenant guards | T7 #4 |
| Rollback clean | T8 |

## Out of scope (per MOK-159 + phase-6 carry-overs)

- Combo group rendering → its own phase
- Header/footer subsystem → its own phase
- Operator-defined canonical variation set → 6.5+
- In-menu-group sub-headers → 6.5+
- Advanced typography → 6.5+
- Real-time Supabase subscriptions → 6.5+
- More layout modes → 6.5+
- Operator-customizable bullet palette → 6.5+
- Publish-time scheduling → 6.5+
- Multi-step undo across publishes (current undo is form-scoped only)
- Sidebar rename `KDS v3 (beta)` → `KDS Setup` (phase 7 checklist)

## Rollback contract

Drops both snapshot tables + `draft_updated_at` + `emphasized_variation_*` columns. Phase 1-6 schema preserved. Pi keeps rendering via the original `kds_screens` / `kds_grid_boxes` tables when render-fetch's source-selection falls back to draft (the only available source after rollback).

## Done criteria for phase 6.5
- All T0–T8 commits on `kds-v3-p6.5-publish`, each with green CI.
- `PHASE-6.5-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-p6.5-publish` → `kds-v3` opened, reviewed, merged.
- Phase 7 spec drafting begins (v2 cutover + Little Cafe migration + sidebar rename).
