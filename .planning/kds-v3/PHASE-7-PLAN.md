# KDS v3 — Phase 7: v2 cutover (sidebar consolidation + dead-code removal)

**Spec:** [MOK-160](https://linear.app/mokesai/issue/MOK-160)
**Branch:** `kds-v3-p7-cutover` → `kds-v3` (integration trunk) → `staging` (final v3 ship PR) → `main`
**Status:** Planning

## Goal

v2 has no production tenants — only set up once in dev. Phase 7 treats v2 as **dead code** and cleans it out so v3 is the single canonical KDS surface.

After phase 7:
- Sidebar has one `KDS Setup` entry pointing at v3 admin.
- v2 admin paths return 404 (code deleted).
- v2 public routes return 404 (code deleted; v3 routes intact).
- v2 schema preserved with a `DEPRECATED` comment annotation. Drop is phase 7.5.

## T0 — Audit findings (complete)

Concrete file list captured ahead of plan-write so each subsequent task is mechanical.

**v3 → v2 imports (must be moved before deletion):**
```
src/app/kds/v3/[deviceId]/[screenId]/page.tsx
  ├─ import KDSDisplayWrapper from '@/app/kds/display/[deviceId]/[screen]/KDSDisplayWrapper'
  └─ import KDSHeartbeat       from '@/app/kds/display/[deviceId]/[screen]/KDSHeartbeat'
```
Both components live in a v2-shaped path but are tiny and infrastructure-shaped (the 1920×1080 canvas wrapper + the device-heartbeat side-effect component). Move them under `src/components/kds/v3/` and the v2 path becomes pure-v2 and deletable.

**v2-only `src/lib/kds/*` files (no v3 imports):**
- `access.ts`, `group-items.ts`, `layout-types.ts`, `photos.ts`, `queries.ts`, `types.ts`
- `index.ts` may re-export some of these — audit before delete.

**v3-owned `src/lib/kds/*` files (preserve):**
- `v3-render.ts`, `v3-render-helpers.ts`, `publish.ts`, `display-overrides.ts`, `grid-validation.ts`

**v2 admin paths (delete):**
- `src/app/admin/(kds)/...` (top-level v2 admin shell + drinks/food preview pages)
- `src/app/admin/(protected)/kds-config/...` (settings / sheets / deploy / preview / editor)
- `src/app/api/admin/kds/...` (v2-specific admin API routes)

**v2 public paths (delete):**
- `src/app/kds/drinks/page.tsx`, `src/app/kds/food/page.tsx` (top-level redirects to v2 admin)
- `src/app/kds/display/...` (v2 Pi route — after T1 extracts the two v3-used components)
- `src/app/kds/components/*` (v2 magazine / drinks / panel / etc. components)
- `src/app/kds/page.tsx` (v2 redirect)

**Shared infrastructure to keep (used by both v2 + v3, or v3 + Pi project):**
- `src/app/api/kds/heartbeat/`, `register/`, `sd-image/`, `kiosk-script/`, `setup/`, `device/[deviceId]/config/`
- `kds_devices` table

**CSS files:**
- `kds-themes.css`, `kds-theme-warm.css`, `kds-theme-dark.css`, `kds-theme-wps.css`, `kds-base.css` — keep (v3 uses)
- `kds-warm.css`, `kds.css` — delete (already documented deprecated in `src/app/kds/CLAUDE.md`)

**`src/app/kds/layout.tsx` and `page.tsx`:**
- `layout.tsx` currently imports `KDSThemeWrapper` from `./components/`. v3 sets its own theme class inside `KDSv3GridCanvas`, so the wrapper is redundant for v3. Simplify the layout to just `<Suspense>{children}` + the `kds-themes.css` import. Drop the `getSetting()` call (v2 settings table).
- `page.tsx` is a redirect to `/admin/kds`. Once v2 admin is gone, that target 404s — replace with a redirect to `/admin/kds-v3/screens` for accidental hits.

## Task breakdown (each task = one commit unless noted)

### T1 — Move shared infrastructure into v3 location
**Files moved:**
- `src/app/kds/display/[deviceId]/[screen]/KDSHeartbeat.tsx` → `src/components/kds/v3/KDSHeartbeat.tsx`
- `src/app/kds/display/[deviceId]/[screen]/KDSDisplayWrapper.tsx` → `src/components/kds/v3/KDSDisplayWrapper.tsx`

**Files updated:**
- `src/app/kds/v3/[deviceId]/[screenId]/page.tsx` — import paths point to new locations.
- `src/app/kds/layout.tsx` — drop `KDSThemeWrapper` dependency; minimal `<Suspense>{children}` shell + the `kds-themes.css` import.
- `src/app/kds/page.tsx` — redirect to `/admin/kds-v3/screens` (v3 home) instead of `/admin/kds`.

**Acceptance:** v3 Pi route still renders end-to-end. `grep` confirms no remaining v3 → v2 imports.

### T2 — Delete v2 admin code
**Files deleted:**
- `src/app/admin/(kds)/` (entire subtree)
- `src/app/admin/(protected)/kds-config/` (entire subtree)
- `src/app/api/admin/kds/` (entire subtree if all v2-only — re-audit before delete)

**Acceptance:** Build still compiles; no stale imports surface.

### T3 — Delete v2 public routes + components + CSS
**Files deleted:**
- `src/app/kds/drinks/`
- `src/app/kds/food/`
- `src/app/kds/display/` (entire subtree — empty after T1's moves except for v2 page.tsx)
- `src/app/kds/components/` (entire subtree)
- `src/app/kds/kds-warm.css`, `src/app/kds/kds.css`

**Acceptance:** Build compiles; v3 routes still resolve.

### T4 — Delete v2 lib helpers + tests
**Files deleted:**
- `src/lib/kds/access.ts`, `group-items.ts`, `layout-types.ts`, `photos.ts`, `queries.ts`, `types.ts`
- Any v2-only files inside `src/lib/kds/__tests__/`
- `src/lib/kds/index.ts` — audit + slim down to only re-export v3 helpers (or delete if no callers).

**Acceptance:** Type-check + build compile; v3 unit tests + integration tests still pass.

### T5 — Sidebar consolidation
**File:** `src/components/admin/AdminNavigation.tsx`

```diff
-  { name: 'KDS Setup',     href: '/admin/kds-config',         icon: Monitor },
-  { name: 'KDS v3 (beta)', href: '/admin/kds-v3/screens',     icon: Monitor },
+  { name: 'KDS Setup',     href: '/admin/kds-v3/screens',     icon: Monitor },
```

**Acceptance:** Visual + grep confirms one `KDS Setup` entry; no `KDS v3 (beta)`.

### T6 — v2 schema deprecation comment
**New migration:** `<CLI-timestamp>_kds_v2_schema_deprecation_comment.sql`

```sql
COMMENT ON TABLE public.kds_categories  IS 'DEPRECATED — v2 (phase 7); drop in phase 7.5';
COMMENT ON TABLE public.kds_menu_items  IS 'DEPRECATED — v2 (phase 7); drop in phase 7.5';
COMMENT ON TABLE public.kds_settings    IS 'DEPRECATED — v2 (phase 7); drop in phase 7.5';
COMMENT ON TABLE public.kds_images      IS 'DEPRECATED — v2 (phase 7); drop in phase 7.5';
```

No structural change; rollback is trivial (re-set comment to empty). No rollback SQL artifact needed.

### T7 — Full test sweep
```
npm run lint
npm run build
npm run test:unit
npm run test:integration
```

**Acceptance:** all green. Any failure fixed in place (most likely failure mode: a v2 test file we missed; delete it).

### T8 — Verification report
**File:** `.planning/kds-v3/PHASE-7-VERIFICATION.md`

Captures:
- Pre/post file counts (v2 deletions tallied)
- Acceptance-criteria map (each MOK-160 item → commit / evidence)
- Test sweep results
- Sign-off block

**No rollback rehearsal** — no schema changes (just a comment); `git revert` of the branch is the rollback.

## Dependencies / ordering rationale

- T0 done before plan-write (audit findings inform everything else).
- T1 must precede T2/T3 (extracts v3-needed code from the v2 path).
- T2/T3/T4 can run in any order after T1 — each independently safe given the audit.
- T5 can run any time.
- T6 stand-alone.
- T7 last (gates everything; commits before T7 should each individually build/test clean, but T7 is the integration gate).
- T8 documents.

## Risk areas

### 1. Hidden v3 → v2 import (LOW — caught by audit + T7)

The T0 audit only finds explicit `@/app/kds/...` imports. Indirect or runtime references (e.g. dynamic imports, Next.js routing implicitly hitting v2 pages) could be missed. T7's full build + test sweep is the safety net.

### 2. Shared CSS class collisions (LOW — kds-themes.css preserved)

v3 uses `theme-warm` / `theme-dark` / `theme-wps` classes from `kds-themes.css`. T3 keeps that file. The two deleted CSS files (`kds.css`, `kds-warm.css`) are explicitly documented deprecated in `src/app/kds/CLAUDE.md` and import-checked before deletion.

### 3. `src/lib/kds/index.ts` barrel re-exports (LOW — audited in T4)

If the barrel re-exports v2 helpers AND v3 helpers, deleting v2 sources breaks the barrel. T4 audits the barrel before file deletes.

### 4. v2 schema-comment migration vs `supabase db push` strictness (LOW)

`COMMENT ON TABLE` is a metadata-only change — no rollback needed. CLI applies it like any other migration.

### 5. /api/kds routes the Pi project depends on (LOW — kept intact)

Heartbeat, register, setup, sd-image, device/config — all v2/v3-shared infrastructure for the Pi side. The audit confirms these stay. The KDS Raspberry Pi Deployment project (which resumes post-phase-7) will own further evolution there.

## Verification checkpoints

| MOK-160 acceptance | Evidence |
|---|---|
| 1. Sidebar has one `KDS Setup` entry pointing at `/admin/kds-v3/screens` | T5 commit + visual |
| 2. v3 imports nothing from v2-shaped paths | T1 commit + post-T7 grep |
| 3. v2 admin paths return 404 — code deleted | T2 commit + manual hit |
| 4. v2 public routes return 404 — code deleted | T3 commit + manual hit |
| 5. v2 tables annotated DEPRECATED; otherwise unchanged | T6 migration + `\dt+` probe |
| 6. lint / build / unit / integration all green | T7 sweep |
| 7. Rollback path documented | T8 verification |

## Out of scope (per MOK-160)

- Dropping v2 tables (phase 7.5).
- Pi deployment self-service (the **KDS Raspberry Pi Deployment** Linear project, post-phase-7).

## Done criteria for phase 7

- All T1–T8 commits on `kds-v3-p7-cutover`, each with green CI per step.
- `PHASE-7-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-p7-cutover` → `kds-v3` opened, reviewed, merged.
- Single `kds-v3` → `staging` PR opens immediately after — this is when the entire v3 rollout ships through to production.
