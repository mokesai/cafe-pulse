# KDS v3 — Phase 4: Aesthetic image library + image_only binding

**Spec:** [MOK-156](https://linear.app/mokesai/issue/MOK-156/kds-v3-phase-4-aesthetic-image-library-image-only-binding)
**Branch:** `kds-v3-p4-aesthetic-images` → `kds-v3` (integration trunk) → `staging` (post-all-phases) → `main`
**Status:** Planning

## Goal

Tenant-scoped library of aesthetic images that operators bind to `image_only`-typed slots on KDS screens. Two source modes (uploaded to Supabase Storage; external hot-linked URL), one library. Also closes out the image_only binding work deferred from MOK-155.

## Task breakdown (each task = one commit unless noted)

### T1 — Forward migration: `kds_aesthetic_images` + FKs from `kds_grid_boxes`
**Files:**
- `supabase/migrations/<CLI-generated-timestamp>_kds_v3_phase_4_aesthetic_images.sql` (authored via `supabase migration new` per the always-CLI rule)

**Scope:**
Create `kds_aesthetic_images` with the columns specified in MOK-156 (id, tenant_id, name, source_kind, storage_path, external_url, alt_text, mime_type, width_px, height_px, bytes, is_deleted, created_at, updated_at).

Constraints + indexes:
- `source_kind text NOT NULL CHECK (source_kind IN ('uploaded','external'))`
- Cross-column invariant `CHECK ((source_kind='uploaded' AND storage_path IS NOT NULL AND external_url IS NULL) OR (source_kind='external' AND external_url IS NOT NULL AND storage_path IS NULL))`
- Per-column non-empty CHECKs on `name` (`length(name) > 0`)
- `is_deleted boolean NOT NULL DEFAULT false`
- Index on `(tenant_id, is_deleted, updated_at DESC)` for the library list query

Add FKs on the existing `kds_grid_boxes.aesthetic_image_id` and `aesthetic_image_id_b` columns:

```sql
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_aesthetic_image_fk
    FOREIGN KEY (aesthetic_image_id) REFERENCES public.kds_aesthetic_images(id) ON DELETE SET NULL,
  ADD CONSTRAINT kds_grid_boxes_aesthetic_image_b_fk
    FOREIGN KEY (aesthetic_image_id_b) REFERENCES public.kds_aesthetic_images(id) ON DELETE SET NULL;
```

RLS:
- `tenant_staff_select_kds_aesthetic_images` — SELECT
- `tenant_admin_{insert,update,delete}_kds_aesthetic_images` — the three write policies

Same pattern as phase 2's screens / boxes tables. `tenant_id` is NOT NULL with no default per the MOK-107-class defense.

**Acceptance — 6-case CHECK corner battery:**

Run a SQL battery (via mcp execute_sql) inserting each case below into a throwaway tenant; assert PASS / CHECK_VIOLATION outcomes. Mirror of phase 2.5's T1 acceptance shape:

| # | source_kind | storage_path | external_url | Expected |
|---|---|---|---|---|
| 1 | `'uploaded'` | `'tenant/id.png'` | NULL | PASS |
| 2 | `'uploaded'` | NULL | NULL | CHECK_VIOLATION |
| 3 | `'uploaded'` | `'tenant/id.png'` | `'https://x'` | CHECK_VIOLATION |
| 4 | `'external'` | NULL | `'https://x'` | PASS |
| 5 | `'external'` | `'tenant/id.png'` | NULL | CHECK_VIOLATION |
| 6 | `'external'` | NULL | NULL | CHECK_VIOLATION |

Plus FK acceptance: bind a `kds_grid_boxes` row to an `aesthetic_image_id`, hard-delete the image → box row's `aesthetic_image_id` should be `SET NULL` (not cascade-delete the box).

### T2 — Rollback SQL
**Files:**
- `.planning/kds-v3/PHASE-4-ROLLBACK.sql`

**Scope:**
- DROP FKs on `kds_grid_boxes` (the two new ones).
- DROP POLICY for each new RLS policy (4 total).
- DROP TABLE `kds_aesthetic_images`.
- DELETE the schema_migrations row for this version.
- **Storage bucket NOT dropped** — per the MOK-156 decision, the bucket persists even on rollback (it's free until populated, and any uploaded content is preserved for recovery).

**Acceptance:**
- Lives outside `supabase/migrations/`.
- Header documents when to run + what state results.
- Rehearsed in T10.

### T3 — Storage bucket setup
**Files:**
- New migration (separate from T1): `supabase/migrations/<timestamp>_kds_v3_phase_4_aesthetic_images_bucket.sql`

**Scope:**
Create the `kds-v3-aesthetic-images` bucket via SQL (Supabase exposes `storage.create_bucket()` or direct INSERT into `storage.buckets`). Set up storage RLS policies:

- SELECT on storage.objects: allow `tenant_id::text = (storage.foldername(name))[1]` (i.e. the first path segment matches the user's tenant) AND `public.is_tenant_member(ARRAY['owner','admin','staff'])`
- INSERT/DELETE on storage.objects: same scope check + admin role only
- The bucket itself is **private** (no public access). The app proxies image fetches via signed URLs when serving to KDS screens.

**Why separate migration:** the bucket policies live in the `storage` schema; keeping them in a dedicated migration makes the rollback path independent of the table migration. T2's rollback drops the table but leaves the bucket policies in place (matching the "leave the bucket" decision).

**Acceptance:**
- Bucket `kds-v3-aesthetic-images` exists, private.
- Tenant A's admin can upload to `<tenant_a_id>/...`; cannot upload to `<tenant_b_id>/...`.
- Tenant A's staff can read from `<tenant_a_id>/...`; cannot read `<tenant_b_id>/...`.
- Cross-tenant probes return 403 / not authorized.

### T4 — List / external-URL / PATCH / DELETE routes
**Files:**
- `src/app/api/admin/kds-v3/aesthetic-images/route.ts` (new — `GET` list, `POST /external` for external-URL add)
- `src/app/api/admin/kds-v3/aesthetic-images/[id]/route.ts` (new — `PATCH` rename/alt-text, `DELETE` soft-delete)

**Scope:**

`GET /api/admin/kds-v3/aesthetic-images` — list shape:

```json
{
  "success": true,
  "data": [
    {
      "id": "<uuid>",
      "name": "Seasonal banner",
      "source_kind": "uploaded" | "external",
      "storage_path": "<tenant_id>/<image_id>.png" | null,
      "external_url": "https://..." | null,
      "alt_text": "..." | null,
      "mime_type": "image/png" | null,
      "width_px": 1920 | null, "height_px": 1080 | null, "bytes": 245678 | null,
      "is_deleted": false,
      "thumbnail_url": "<signed url for uploaded; same as external_url for external>",
      "created_at": "...", "updated_at": "..."
    }
  ]
}
```

`thumbnail_url` is computed server-side: for `uploaded`, generate a signed URL with short TTL (~1 hour) so the library page can render without exposing the bucket. For `external`, pass `external_url` straight through.

Filter: include `is_deleted=true` rows so editor can flag stale bindings (same pattern as menu-groups).

`POST /api/admin/kds-v3/aesthetic-images/external` — body `{ name, external_url, alt_text? }`. Validations:
- `name` non-empty, ≤ 80 chars
- `external_url` parses via `new URL()` AND `protocol === 'https:'`
- `alt_text` ≤ 200 chars when set

`PATCH /api/admin/kds-v3/aesthetic-images/[id]` — body `{ name?, alt_text? }`. Cannot change `source_kind` / `storage_path` / `external_url` (immutable after create).

`DELETE /api/admin/kds-v3/aesthetic-images/[id]` — soft-delete: `UPDATE … SET is_deleted = true, updated_at = now()`. Returns the soft-deleted row. The Storage object is left in place.

All routes:
- `requireAdminAuth` + `getCurrentTenantId()`
- Return `{ success, data, code? }` shape consistent with the screens routes
- Tenant-scoped via `tenant_id = current_tenant` filters

**Acceptance:**
- Hand-test each route via curl against bigcafe.
- Tenant-isolated (covered by T8 integration tests).
- Soft-delete is reversible by hand (UPDATE back to false) for the editor's deleted-display testing.

### T5 — Upload route
**Files:**
- `src/app/api/admin/kds-v3/aesthetic-images/upload/route.ts` (new)

**Scope:**

`POST /api/admin/kds-v3/aesthetic-images/upload` — multipart form data:
- `file` (the image file)
- `name` (operator-facing label)
- `alt_text` (optional)

Server flow:
1. `requireAdminAuth` + `getCurrentTenantId()`.
2. Parse multipart via `request.formData()`.
3. Validate `file`: present, `file.size <= 5 * 1024 * 1024` (5 MB), `file.type` in the mime whitelist (`image/png`, `image/jpeg`, `image/webp`, `image/gif`).
4. Validate `name`: non-empty, ≤ 80 chars.
5. Generate `id = uuid`; `storage_path = <tenant_id>/<id>.<ext>` (extension derived from mime type).
6. Upload the file blob to Storage via the service client (service-role bypass for the write — we've already enforced the auth + tenant scope at the route layer).
7. INSERT the `kds_aesthetic_images` row with `source_kind='uploaded'`, the computed path, mime, size, optional width/height (we won't extract dimensions in v1 — would require an image-decoding lib; leave width/height NULL on upload, fill in later if needed).
8. On any step failure after the storage upload succeeded, delete the storage object so we don't leak orphans.

Errors:
- 400 KDS_AESTHETIC_IMAGE_BAD_REQUEST — invalid file shape / oversized / wrong mime / missing name
- 500 KDS_AESTHETIC_IMAGE_UPLOAD_FAILED — storage error

**Acceptance:**
- Hand-test upload via curl with a sample 1 MB PNG.
- Upload of 6 MB PNG → 400.
- Upload of an `application/pdf` → 400.
- Failed insert after successful storage upload → storage object cleaned up (verify via Studio).

### T6 — Library admin page
**Files:**
- `src/app/admin/(protected)/kds-v3/aesthetic-images/page.tsx` (new — `'use client'` thin wrapper around the library client component)
- `src/components/admin/kds-v3/AestheticImageLibrary.tsx` (new — the actual UI)
- `src/components/admin/AdminNavigation.tsx` (add a sidebar entry under the existing KDS v3 menu group)

**Scope:**
- Layout: responsive grid (`grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4`). Each card = thumbnail (using `next/image` with `unoptimized` for external; signed URL `<img>` for uploaded since `next/image` doesn't play nice with signed URLs in static-generated routes — actually it does, but `unoptimized` is simpler), name (click-to-edit inline), source-kind badge, alt-text caption, Delete button.
- Two action buttons at top: **Upload image** (file input, opens native picker, posts to `/upload`) and **Add external URL** (inline mini-form with name + URL + alt-text fields, posts to `/external`).
- Inline rename: click name → input becomes editable → blur or Enter triggers PATCH.
- Optimistic UI: new upload/external add appends immediately with a "Saving…" badge; replaced with the server-returned row on success, or rolled back on error.
- Soft-deleted images shown in a separate "Recently deleted" section at the bottom (collapsed by default) — operator can see what's been removed without re-adding it. (Optional polish — if it's too much, just hide deleted entirely and let the editor surface them via the picker.)
- Per the v2 list-page lesson from phase 2: keep this page inlined with plain HTML elements / Tailwind. No `@/components/ui` barrel imports, no `lucide-react`. The webpack-dev gotcha from MOK-152 still applies.

**Acceptance:**
- Page renders with 0 images (empty state message).
- Upload a PNG → card appears with thumbnail.
- Add an external URL → card appears.
- Click name → rename inline → blur → PATCH fires, name updates.
- Delete → card disappears (or moves to Recently deleted section).
- Lint / build clean.

### T7 — Editor image picker + server-side validation
**Files:**
- `src/components/admin/kds-v3/GridEditor.tsx` (extend `renderSlotControls` for `image_only` slots)
- `src/app/api/admin/kds-v3/screens/[id]/route.ts` (extend the existing menu-group cross-row + per-slot validation with the symmetric image-binding checks)

**Scope:**

In `renderSlotControls`: when `boxType === 'image_only'`, replace the current "configured in phase 4" placeholder with:
- A dropdown of the tenant's images (fetched once on editor mount, like the menu-groups list). `— Unbound —` at top, each image labeled by `name + source-kind badge`. Deleted images show `⚠ (deleted) <name>`.
- A small thumbnail preview of the currently-selected image (uses the same `thumbnail_url` from the route's response).
- The existing Header override input is reused (operator can caption the image).

PUT validation (mirrors phase 3's menu-group checks):
- Collect unique non-null `aesthetic_image_id` + `aesthetic_image_id_b` values, run one batched `SELECT id WHERE tenant_id=? AND id IN (...)` against `kds_aesthetic_images`. Missing → 422 KDS_SCREEN_LAYOUT_INVALID.
- Per-slot in the field-error loop: if `box_type='menu_group'` and `aesthetic_image_id` non-null → 400 (symmetric to the existing image_only-with-group rejection).

`EditableBox` types in GridEditor already include `aesthetic_image_id` (slot A from phase 3) and `aesthetic_image_id_b` (slot B from phase 2.5) — just need to thread them through `renderSlotControls` props + helpers (`updateImageBinding(position, slot, id)`).

**Acceptance:**
- Editor: bind an image to an `image_only` slot, save, reload — binding persists.
- Toggle slot type from `image_only` → `menu_group` → confirm `aesthetic_image_id` gets cleared on save (same pattern as the existing slot-B cleanup helper).
- Manual cross-tenant probe via curl → 422.

### T8 — Integration tests
**Files:**
- `tests/integration/kds-v3-aesthetic-images-route.test.ts` (new — library route coverage)
- `tests/integration/kds-v3-screens-routes.test.ts` (extend with image-binding cases)
- `tests/integration/helpers/tenant.ts` (extend with `seedTestAestheticImage(tenant, opts?)` fixture)

**Library route cases (new file):**

1. POST /external — creates an `source_kind='external'` row with the provided URL.
2. POST /external — rejects 400 on non-HTTPS URL.
3. POST /external — rejects 400 on empty name.
4. POST /upload — accepts a small PNG blob, creates `source_kind='uploaded'` row, storage object exists.
5. POST /upload — rejects 400 on oversize file (synthesize a 6 MB blob).
6. POST /upload — rejects 400 on non-image mime type.
7. GET / — lists tenant's images; cross-tenant rows not visible.
8. PATCH /[id] — renames name + updates alt_text; doesn't allow changing source_kind or path/URL.
9. DELETE /[id] — soft-deletes (is_deleted=true, row still present).
10. POST /upload — on simulated DB insert failure after successful storage write, the storage object gets cleaned up (orphan prevention).

**Screens-routes additions (extend existing file from 23 → ~28 cases):**

11. PUT — bind `aesthetic_image_id` on an `image_only` slot persists; reload returns the bound id.
12. PUT — cross-tenant rejection (422): tenant A binds to tenant B's `aesthetic_image_id`.
13. PUT — menu_group-with-image rejection (400): `box_type='menu_group'` slot with `aesthetic_image_id` set.
14. PUT — fabricated `aesthetic_image_id` rejection (422).
15. PUT — bound image with `is_deleted=true` accepted (binding stays; renderer surfaces missing-reference separately).
16. PUT — position stability across image-binding changes (regression).

**Fixture helper:**
```ts
seedTestAestheticImage(tenant, {
  source_kind?: 'uploaded' | 'external',  // default 'external'
  name?: string,
  external_url?: string,
  storage_path?: string,
  is_deleted?: boolean,
})
```
For `source_kind='uploaded'` in tests, we just write the DB row with a synthetic `storage_path` — no actual upload to Storage (tests don't hit the bucket since route-level upload validation is the boundary we care about).

**Acceptance:**
- `npm run test:integration -- kds-v3` covers all three files; all green.
- `npm run test:unit`, `npm run lint`, `npm run build` clean.

### T9 — Manual end-to-end against bigcafe
Same shape as prior phases' manual walks.

**Prerequisites:**
- T1 migration applied via `supabase db push` (already, if executed during T1 commit).
- Bucket exists (T3 migration applied).
- Routes deployed (`npm run dev:webpack` reload after T4 + T5).

**Procedure:**
1. Sign in to `http://bigcafe.localhost:3000` as a bigcafe admin.
2. Navigate to `/admin/kds-v3/aesthetic-images` — the new sidebar entry. Empty-state shown.
3. Click **Upload image** → pick a small PNG / JPEG. Card appears with thumbnail.
4. Click **Add external URL** → enter name + an `https://` URL pointing at a publicly accessible image (e.g. a Unsplash placeholder). Card appears with the external thumbnail.
5. Click on a card's name → edit inline → blur → name updates.
6. Click an alt-text — same inline edit flow.
7. Delete one of the cards → it disappears (or moves to Recently deleted).
8. Navigate to `/admin/kds-v3/screens` → open a screen → click an `image_only` box (or change a slot's type to `image_only`).
9. Image picker dropdown shows both the uploaded + external images. Bind one.
10. Save, reload. Confirm the picker still shows the bound image.
11. Soft-delete the image via the library page. Return to the editor → bound box shows `⚠ (deleted) <name>` in the picker.
12. Re-bind to a non-deleted image. Save / reload — clean state.

**Acceptance:**
- All 12 steps pass.
- Captured in `.planning/kds-v3/PHASE-4-VERIFICATION.md` (T10).

### T10 — Rollback rehearsal + verification report
**Files:**
- `.planning/kds-v3/PHASE-4-VERIFICATION.md` (new)

**Procedure:**
1. Pre-snapshot dev state (image count, box bindings, storage object count if reachable).
2. Execute `PHASE-4-ROLLBACK.sql` against cafe-pulse-dev.
3. Confirm: 0 `kds_aesthetic_images` table, 0 FKs from `kds_grid_boxes` to it, 0 phase-4 schema_migrations rows.
4. Confirm storage bucket `kds-v3-aesthetic-images` still exists (per the decision).
5. Re-apply via `supabase db push` (both T1 and T3 migrations re-run cleanly).
6. Idempotency test: re-execute migration SQL once more directly via mcp; verify no errors, no schema changes.
7. Document run with timestamps + sign-off in PHASE-4-VERIFICATION.md.

**Acceptance:**
- Rollback SQL produces clean state on first try.
- Migration re-apply is idempotent.
- Bucket persists across rollback as designed.
- Verification doc filled in with all checkboxes ✓.

## Dependencies / ordering rationale
- T1 must precede T4, T5, T7, T8, T9 (everything reads/writes the new table).
- T2 should land alongside T1 (rollback paired with forward migration).
- T3 (bucket) must precede T5 (upload route writes to it). Can land between T1 and T4.
- T4 must precede T6 (library page consumes the routes) and T7 (editor fetches the list route).
- T5 must precede T6 (upload UI in the library page consumes /upload).
- T6 should precede T9 (need a UI to seed test images for the manual walk).
- T7 needs T1 + T4. Can run in parallel with T6 in theory but easier to do T6 first.
- T8 needs T1 + T4 + T5 + T7.
- T9 + T10 end-of-phase.

## Risk areas

### 1. Storage bucket RLS correctness (HIGH — mitigated by explicit cross-tenant probes)

Bucket policies are written in the `storage` schema using `storage.foldername(name)` to extract the path prefix. Easy to get the policy expression wrong and accidentally allow cross-tenant reads.

Mitigation: T3 acceptance includes a cross-tenant probe — manually log in as tenant A's admin and try to read `<tenant_b_id>/...` paths via the Supabase client; must return 403. Same probe in T8 integration tests.

### 2. Orphan storage objects on upload failure (LOW — mitigated by post-upload cleanup)

If the upload to Storage succeeds but the subsequent INSERT into `kds_aesthetic_images` fails (e.g. tenant_id constraint), we'd leak a storage object with no DB row pointing to it. T5's flow includes an explicit cleanup step in the catch block. Pinned by T8 case 10 ("simulated DB insert failure → storage object cleaned up").

### 3. Signed-URL TTL for thumbnails (LOW — accepted)

Library page renders thumbnails via signed URLs with ~1 hour TTL. If an admin keeps the page open for 90 minutes, thumbnails 404. Editor page similarly. Mitigation: refresh on focus (re-fetch the list to get new signed URLs) — small UX polish, can ship without it in v1 and let the operator reload manually.

### 4. External URL still pointing somewhere unsafe (LOW — operator responsibility, no fetch verification)

Per the MOK-156 "skip fetch" decision, we accept any well-formed HTTPS URL. If the operator pastes a URL that 404s, returns HTML, or hot-links a copyrighted image, we don't catch it. Acceptable for v1; the operator visually verifies via the thumbnail.

### 5. CLI discipline (LOW — enforced by process)

T1 + T3 are both new migrations. Per the always-CLI rule (post-MOK-153), both authored via `supabase migration new` and applied via `supabase db push`. Verify `supabase db push --dry-run` reports zero drift after each apply.

## Verification checkpoints

| MOK-156 acceptance | Verified by |
|---|---|
| Migration creates table + invariant + FKs | T1 + 6-case CHECK battery + FK SET NULL test |
| Storage bucket exists with tenant-scoped RLS | T3 + cross-tenant probe (T3 + T8) |
| Library admin page lists / uploads / adds external / renames / deletes | T6 + T9 #2-7 |
| Editor image_only slots surface picker; bind/unbind persists | T7 + T9 #8-10 |
| Cross-tenant binding rejection (422) | T8 #12 |
| menu_group-with-image rejection (400) | T8 #13 |
| Soft-deleted image surfaces as ⚠ (deleted) | T7 + T9 #11 |
| Integration tests cover full surface | T8 (10 lib + 6 screens = 16 new cases) |
| Rollback drops the table + FKs cleanly; bucket persists | T2 + T10 |

## Out of scope (per MOK-156)
- Image transformations / AI generation / video content
- Hard-delete UI for storage objects → future cleanup job
- Image rendering on `/kds/*` → Phase 6
- Combo menu group rendering + price-display controls → Phase 6

## Rollback contract
Drops the `kds_aesthetic_images` table + the 2 FKs on `kds_grid_boxes`. **Storage bucket is NOT dropped** (operator decision: leave the bucket, since it's free until populated and preserves any uploaded content if rollback is for a transient issue). The `aesthetic_image_id` and `aesthetic_image_id_b` columns on `kds_grid_boxes` were added in phase 2 + 2.5; phase 4's rollback only removes the FKs, not the columns themselves. Existing phase 2 / 2.5 / 3 schema is otherwise untouched.

Rollback window remains open through phases 5-6 (the table + bucket exist but only feed phase 7's eventual public renderer). After phase 7 cutover, rollback is a separate decision.

## Done criteria for phase 4
- All T1-T10 commits on `kds-v3-p4-aesthetic-images`, each with green CI.
- `PHASE-4-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-p4-aesthetic-images` → `kds-v3` opened, reviewed, merged.
- Phase 5 spec drafting begins.
