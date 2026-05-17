# KDS v3 — Phase 4 Verification Report

**Spec:** [MOK-156](https://linear.app/mokesai/issue/MOK-156/kds-v3-phase-4-aesthetic-image-library-image-only-binding)
**Plan:** [.planning/kds-v3/PHASE-4-PLAN.md](./PHASE-4-PLAN.md)
**Branch:** `kds-v3-p4-aesthetic-images`
**Verified against:** cafe-pulse-dev (`ettmabcwfhidcpapphgm`), bigcafe tenant
**Verified on:** 2026-05-17

---

## Summary

All 10 plan tasks (T1–T10) complete. Phase 4 ships:

- New `kds_aesthetic_images` table with a cross-column CHECK invariant (`source_kind` ↔ `storage_path` vs `external_url`).
- `ON DELETE SET NULL` FKs from `kds_grid_boxes.aesthetic_image_id(_b)` to the new table.
- Private Supabase Storage bucket `kds-v3-aesthetic-images` with tenant-scoped RLS (path-prefix policies).
- Five admin routes — `GET list`, `POST /external`, `POST /upload`, `PATCH /[id]`, `DELETE /[id]`.
- A library admin page at `/admin/kds-v3/aesthetic-images` with thumbnail grid, upload button, inline rename, soft-delete, and a "Recently deleted" collapsed section.
- Editor image picker for `image_only` slots, mirroring the phase-3 menu-group picker shape.
- Server-side validation: cross-tenant image-binding rejection (422) and menu_group-with-image rejection (400), symmetric to the phase-3 menu-group checks.

Also closes out the `image_only` binding work deferred from MOK-155.

**Status: READY for PR `kds-v3-p4-aesthetic-images` → `kds-v3`** when the operator approves.

---

## Acceptance walkthrough

Each MOK-156 acceptance criterion mapped to its evidence.

| # | Acceptance criterion | Evidence | Result |
|---|---|---|---|
| 1 | Migration creates table + cross-column CHECK + FKs from kds_grid_boxes(aesthetic_image_id(_b)) | T1 + 6-case CHECK corner battery + FK SET NULL test (see T1 commit) | ✅ |
| 2 | Storage bucket exists with tenant-scoped RLS (admin upload, staff read, no cross-tenant access) | T3 — bucket created private, 3 storage policies (select/insert/delete) path-prefix scoped to tenant_id | ✅ |
| 3 | Library admin page lists, uploads, adds external, renames, soft-deletes | T6 + T9 #2-7 (manual) | ✅ |
| 4 | Editor's image_only slots surface picker; bind/unbind round-trip persists | T7 + T9 #8-10 (manual: bound on real screen, saved, reloaded) | ✅ |
| 5 | Cross-tenant rejection (422) | T2 (validator) + T8 case #25 (auto: explicit two-tenant fixture) | ✅ |
| 6 | menu_group-with-image rejection (400) | T7 (validator) + T8 case #26 (auto) | ✅ |
| 7 | Soft-deleted image surfaces as ⚠ (deleted) in editor; binding stays | T7 + T9 #11 (manual: bound, soft-deleted, editor reload showed warning) | ✅ |
| 8 | Integration tests cover the full surface | T8: 10 cases in kds-v3-aesthetic-images-route.test.ts + 6 cases extending kds-v3-screens-routes (16 total new) | 52/52 ✅ across all kds-v3 integration files |
| 9 | Rollback drops table + FKs cleanly; bucket persists | T10 (this section) | ✅ |

---

## 6-case CHECK corner battery (T1)

Executed against cafe-pulse-dev 2026-05-17 during T1 commit. Each case inserted a single test row into a throwaway tenant; outcome verifies the cross-column invariant fires (or stays out of the way) per design.

| # | source_kind | storage_path | external_url | Expected | Result |
|---|---|---|---|---|---|
| 1 | `'uploaded'` | `'tenant/x.png'` | NULL | PASS | ✅ PASS |
| 2 | `'uploaded'` | NULL | NULL | CHECK_VIOLATION | ✅ CHECK_VIOLATION |
| 3 | `'uploaded'` | `'tenant/x.png'` | `'https://x'` | CHECK_VIOLATION | ✅ CHECK_VIOLATION |
| 4 | `'external'` | NULL | `'https://x'` | PASS | ✅ PASS |
| 5 | `'external'` | `'tenant/x.png'` | NULL | CHECK_VIOLATION | ✅ CHECK_VIOLATION |
| 6 | `'external'` | NULL | NULL | CHECK_VIOLATION | ✅ CHECK_VIOLATION |

**Plus FK SET NULL test:** bound a `kds_grid_boxes` row to a test `aesthetic_image_id`, hard-deleted the image, verified the box stayed in place with `aesthetic_image_id = NULL` (not cascade-deleted).

---

## T10 rollback rehearsal detail

Executed 2026-05-17 against cafe-pulse-dev.

### Starting state (before rollback)
- 0 images currently in dev (T9-walk content cleaned up via the integration test `beforeEach` cycles during T8)
- 0 boxes with image bindings
- 4 screens + 14 boxes preserved from prior phases
- T1 table present with 4 RLS policies, 2 FKs on `kds_grid_boxes`, 2 phase-4 schema_migrations rows (T1 + T3)
- Bucket `kds-v3-aesthetic-images` present

### Step 1 — Execute PHASE-4-ROLLBACK.sql

Three logical steps in one transaction:
1. `DROP CONSTRAINT IF EXISTS` × 2 — the FKs on `kds_grid_boxes`
2. `DROP POLICY IF EXISTS` × 4 — the RLS policies on `kds_aesthetic_images`
3. `DROP TABLE IF EXISTS kds_aesthetic_images` + `DELETE FROM schema_migrations WHERE version = T1`

### Step 2 — Post-rollback verification

| Check | Expected | Actual |
|---|---|---|
| `kds_aesthetic_images` table dropped | 0 | 0 ✅ |
| FKs on `kds_grid_boxes` dropped | 0 | 0 ✅ |
| T1 schema_migrations row removed | 0 | 0 ✅ |
| Bucket persists (per design) | 1 | 1 ✅ |
| Bucket schema_migrations row kept (T3 untouched) | 1 | 1 ✅ |
| Phase 2/3 `kds_screens` preserved | 4 | 4 ✅ |
| Phase 2/3 `kds_grid_boxes` preserved | 14 | 14 ✅ |

### Step 3 — Re-apply via `supabase db push`

CLI surfaced an out-of-order warning because T1 (`20260517025818`) is earlier than T3 (`20260517030056`) which is still in remote:

```
Found local migration files to be inserted before the last migration on remote database.
Rerun the command with --include-all flag to apply these migrations:
supabase/migrations/20260517025818_kds_v3_phase_4_aesthetic_images.sql
```

Resolved with `supabase db push --include-all --yes`. Re-apply produced the expected idempotency-pattern NOTICEs — the migration is intentionally idempotent so it cleanly handles "table doesn't yet exist" state.

Post-reapply verification:

| Check | Expected | Actual |
|---|---|---|
| `kds_aesthetic_images` table present | 1 | 1 ✅ |
| FKs on `kds_grid_boxes` present | 2 | 2 ✅ |
| RLS policies | 4 | 4 ✅ |
| `kds_aesthetic_images_source_invariant` CHECK present | 1 | 1 ✅ |
| schema_migrations rows for both phase-4 versions | 2 | 2 ✅ |

### Step 4 — Idempotency test

Re-executed the T1 migration SQL a second time on top of the just-applied state (via direct SQL — `supabase db push` would no-op as "remote up to date").

The migration's pattern is:
- `CREATE TABLE IF NOT EXISTS …` — no-op when present
- `ALTER TABLE … DROP CONSTRAINT IF EXISTS … ADD CONSTRAINT …` — drops + re-adds identical
- `ALTER TABLE … DROP CONSTRAINT IF EXISTS …` (per-FK) + ADD CONSTRAINT (per-FK)

Result: zero errors, identical post-state (table=1, fks=2, cross-column check=1). Migration is genuinely idempotent.

### Storage bucket persistence

Bucket `kds-v3-aesthetic-images` was **NOT** touched by the rollback — per the MOK-156 decision. Confirmed via `SELECT count(*) FROM storage.buckets WHERE id='kds-v3-aesthetic-images'` returning 1 throughout the rehearsal. Any uploaded objects (none in dev at the time) would have been preserved across rollback.

---

## Test layer summary

| Layer | Coverage | Result |
|---|---|---|
| Layer 1 — Vitest unit tests | grid-validation suite unchanged (no schema/validation primitives added in phase 4) | 115/115 ✅ |
| Layer 1 — Vitest integration tests | 4 kds-v3 test files: phase-2 screens (15 cases extended by phase-3 to 23, then phase-4 to 29), phase-3 menu-groups-route (3), phase-4 aesthetic-images-route (10) | 52/52 ✅ |
| Layer 2 — Manual local-dev (T9) | 12 steps on bigcafe: library page (empty / upload / external add / rename / alt-text edit / delete), editor picker (bind / round-trip / deleted-display / re-bind) | All passed ✅ |
| Layer 3 — Rollback rehearsal (T10) | Full table+FK drop + re-apply + idempotency re-run | Clean ✅ |
| Layer 4 — Manual staging | n/a — KDS v3 ships as a single staging PR after all 7 phases | n/a |

---

## Phase 4 design contracts (frozen for phase 6)

The phase 6 renderer will consume two new shapes from phase 4:

1. **Image record** (`kds_aesthetic_images`): each row is either `source_kind='uploaded'` with `storage_path` or `source_kind='external'` with `external_url`. Renderer must accept both — fetch signed URL for uploaded, pass-through for external. `is_deleted=true` rows render as missing-reference (same convention as menu groups in phase 3).
2. **Slot binding**: `kds_grid_boxes.aesthetic_image_id` (slot A) or `aesthetic_image_id_b` (slot B, when divided) carries the FK. `ON DELETE SET NULL` means hard-deletes leave bindings cleared automatically; soft-delete is the operator path and doesn't fire the SET NULL.

Captured here so phase 6 spec drafting can pick them up without re-deriving.

---

## Commit log on `kds-v3-p4-aesthetic-images`

Tip (T10 verification commit added by this doc):

```
<verification commit>
faa7b2e test(kds-v3): MOK-156 T8 — integration tests for aesthetic images
8c42880 feat(kds-v3): MOK-156 T7 — editor image picker + server validation
efd2f5c feat(kds-v3): MOK-156 T6 — aesthetic image library admin page
0eccf1b feat(kds-v3): MOK-156 T5 — multipart upload route
e1caa99 feat(kds-v3): MOK-156 T4 — aesthetic-images list / external / PATCH / DELETE
118ac3c feat(kds-v3): MOK-156 T3 — kds-v3-aesthetic-images storage bucket + RLS
b6dab5b chore(kds-v3): MOK-156 T2 — phase 4 rollback SQL
9f3fe8a feat(kds-v3): MOK-156 T1 — kds_aesthetic_images schema + FKs
1ae86e2 plan(kds-v3): MOK-156 phase 4 — aesthetic image library + image_only binding
```

---

## Sign-off

- **Author:** Jerry McCommas (operator-in-the-loop verification on 2026-05-17)
- **Paired session:** Claude (T1-T8 implementation, T9 walk facilitation, T10 rehearsal + report)
- **Status:** Ready for sub-PR to `kds-v3` integration trunk
- **Next:** open PR `kds-v3-p4-aesthetic-images` → `kds-v3`; phase 5 (per-item display overrides) spec drafting when paired bandwidth allows.
