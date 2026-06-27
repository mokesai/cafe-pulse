# KDS v3 — Phase 1: Square Menu Mirror

**Spec:** [MOK-151](https://linear.app/mokesai/issue/MOK-151)
**Branch:** `kds-v3-p1-square-mirror` → `kds-v3` (integration) → `staging` → `main`
**Status:** Planning

## Goal
Build a tenant-scoped, eventually-consistent local mirror of Square menus, menu groups, items, variations, and item↔group memberships. Subsequent KDS v3 phases (grid schema, screen designer, render) read exclusively from this mirror — no direct Square API calls in the request path.

## Task breakdown (each task = one commit)

Tasks are ordered. Earlier tasks unblock later ones; merging out of order is not supported.

### T1 — Forward migration + RLS
**Files:**
- `supabase/migrations/<timestamp>_kds_v3_phase_1_square_menu_mirror.sql`

**Scope:**
- 5 tables per the MOK-151 schema: `square_menu_categories`, `square_menu_items`, `square_menu_item_variations`, `square_menu_item_categories`, `square_menu_sync_state`.
- Indexes per spec: `(tenant_id, parent_id)`, `(tenant_id, is_top_level) WHERE is_top_level`, `(tenant_id, category_id, ordinal)`.
- FK on variations → items via `(tenant_id, item_id)` with `ON DELETE CASCADE`.
- RLS enabled on all 5 tables. Policies:
  - `tenant_staff_select_*`: SELECT allowed when `tenant_id = current_tenant_id()`.
  - `tenant_admin_write_*`: INSERT / UPDATE / DELETE for admin role only (writes happen via service-role from sync code, but RLS policies exist for safety + future client-side reads).
- `tenant_id NOT NULL` with no defaults (per CLAUDE.md tenant-isolation invariant).

**Acceptance:**
- `npm run db:migrate` against cafe-pulse-dev applies cleanly.
- Tables visible in Supabase Studio with the expected columns / indexes / FKs / RLS policies.
- Inserting a row without `tenant_id` raises NOT NULL error (defends against MOK-107 class of bug).

### T2 — Rollback SQL
**Files:**
- `.planning/kds-v3/ROLLBACK.sql`

**Scope:**
- DROP TABLE IF EXISTS in dependency order: variations → item_categories → items → categories → sync_state.
- DROP POLICY for each RLS policy created in T1.
- Update `supabase_migrations.schema_migrations` to remove the migration entry, so a re-applied migration runs cleanly.

**Acceptance:**
- Living outside `supabase/migrations/` (won't auto-run).
- Inline SQL header comments document when to run + what state results.
- Tested via T9 below.

### T3 — Square menu seed script (dev convenience, not shipped)
**Files:**
- `scripts/seed-square-test-menu.ts` (new)
- `package.json` — add `seed-square-test-menu` script entry

**Scope:**
- Standalone TS script invoked via `npx tsx scripts/seed-square-test-menu.ts`. Uses tenant's stored Square credentials from cafe-pulse-dev.
- Creates a deterministic test menu via `POST /v2/catalog/object`:
  - 1 menu ("KDS Test Menu", MENU_CATEGORY top-level).
  - 3 menu groups under the menu ("Hot Drinks", "Cold Drinks", "Pastries").
  - 6 items distributed across the groups, each with 1-2 variations + an image.
- Idempotent: re-running with the same idempotency keys updates instead of duplicating.
- Optional `--cleanup` flag deletes the test menu objects (for resetting).

**Acceptance:**
- One-shot run produces the test menu in the configured Square sandbox.
- Square dashboard (limited as it is in sandbox) OR `POST /v2/catalog/search` confirms the objects exist.

### T4 — Sync service (`syncMenusFromSquare`)
**Files:**
- `src/lib/square/menu-sync.ts` (new)
- `src/lib/square/types.ts` — extend with `SquareMenuCategory`, `SquareMenuItemCategoryRef`, etc., as needed

**Scope:**
- Single exported function: `syncMenusFromSquare(supabase, tenantId, opts?: { fullResync?: boolean }): Promise<SyncResult>`.
- Implements the 6-step sync logic from MOK-151 (read state → 2 parallel searches → process categories → process items → resolve images → update state).
- Pure logic for the diff/upsert per-row separated into small helpers (`upsertCategory`, `upsertItem`, `replaceMembership`, `markVariationsDeleted`, `cascadeDeletedCategoryMemberships`) so each is unit-testable.
- Returns `{ categoriesUpserted, itemsUpserted, variationsUpserted, membershipsUpserted, errors }` — useful for the manual endpoint's response.

**Acceptance:**
- Type-checks against the new `SquareMenuCategory` types.
- Imports the existing Square fetch client.
- All public-API changes covered by JSDoc.
- (Tests come in T7.)

### T5 — Webhook handler extension
**Files:**
- `src/app/api/webhooks/square/catalog/route.ts` (modified)

**Scope:**
- After existing per-event work, call `syncMenusFromSquare(supabase, tenantId)` for the affected tenant. Wrap in try/catch; log but don't fail the webhook on sync error (Square retries, but we don't want a crash to repeat indefinitely).
- Existing CATEGORY/ITEM processing for non-menu purposes is preserved.

**Acceptance:**
- Existing webhook tests still pass.
- New log line `[catalog-webhook] menu-sync ran for tenant=… result=…` appears on receipt of a real webhook.

### T6 — Manual full-resync endpoint
**Files:**
- `src/app/api/admin/square/menu-sync/route.ts` (new)

**Scope:**
- `POST` only, admin-only via `requireAdminAuth`.
- Calls `syncMenusFromSquare(supabase, tenantId, { fullResync })` with the operator's choice of full or incremental.
- Returns counts + timing + structured errors per the contract below.
- 5xx on uncaught error.

**Request contract:**
```http
POST /api/admin/square/menu-sync
Cookie: <admin session>
Content-Type: application/json

{
  "fullResync": true   // optional, defaults to false (incremental from last_synced_at)
}
```

**Response contract (200):**
```json
{
  "success": true,
  "data": {
    "fullResync": false,
    "syncStartedAt": "2026-05-06T18:00:00.123Z",
    "syncCompletedAt": "2026-05-06T18:00:01.456Z",
    "upserts": {
      "categories": 4,
      "items": 7,
      "variations": 12,
      "memberships": 7
    },
    "deletes": {
      "categoriesMarkedDeleted": 0,
      "itemsMarkedDeleted": 0,
      "variationsMarkedDeleted": 0,
      "membershipsRemoved": 0
    },
    "warnings": []     // non-fatal issues (e.g. unresolvable image_id), empty when clean
  }
}
```

**Response contract (errors):**
- `401 { "error": "Authentication required" }` — no admin session.
- `403 { "error": "Admin role required" }` — authenticated but not admin.
- `500 { "success": false, "error": "<sanitized message>", "code": "<code>" }` — uncaught failure.

**Internal `SyncResult` type (T4) mirrors `data` above** so the route is essentially a thin wrapper: load tenantId from auth context, call sync function, attach `success: true`, return.

**Acceptance:**
- Authenticated admin POST returns 200 with the contract shape; counts match what hit the DB.
- Unauthenticated request → 401.
- Cross-tenant request fails (cannot resync another tenant's mirror) — `getCurrentTenantId()` resolves to caller's own tenant; foreign tenant_id can't be passed.
- `fullResync: true` ignores `last_synced_at`; `fullResync: false` (default) honors it.

### T7 — Vitest integration tests + fixtures
**Files:**
- `tests/integration/fixtures/square-menu-*.json` (new — captured from real sandbox responses)
- `tests/integration/kds-v3-menu-sync.test.ts` (new)

**Scope (one test per acceptance criterion in MOK-151):**
1. Full sync — 1 menu, 3 groups, 7 items mirrored correctly.
2. Item moved between groups → memberships replaced.
3. Item removed from all groups (still exists) → memberships gone, `is_deleted=false`.
4. Item hard-deleted → cascade to variations + memberships.
5. Variation removed (others stay) → variation marked deleted, siblings untouched.
6. Menu group deleted → group `is_deleted=true`, memberships cascaded.
7. REGULAR_CATEGORY items skipped.
8. Manual full-resync = end-state of incremental sync.
9. Tenant isolation.
10. Idempotent re-run.

Mocks `fetch` for Square endpoints (similar to existing MOK-127 retry-pipeline test pattern). Real DB writes to cafe-pulse-dev via `getServiceClient()`.

**Acceptance:**
- `npm run test:integration -- kds-v3-menu-sync` all green.
- `npm run lint`, `npm run build` clean.

### T8 — Manual end-to-end verification (against your Square sandbox)
Documented checklist run against `npm run dev:webpack` + cafe-pulse-dev + your seeded test menu (T3).

**Procedure:** layer 2 of the test plan we agreed on:
1. Apply migration via `npm run db:migrate`.
2. Run `npm run seed-square-test-menu`.
3. Hit `POST /api/admin/square/menu-sync` with admin auth → assert response counts.
4. Inspect Supabase Studio → all 5 tables populated.
5. Mutate via Square API (rename item, move group, delete variation, delete item, delete group) → re-sync → confirm each propagates.
6. Idempotency: full-resync twice, count unchanged.
7. Provision a second test tenant → sync only first → confirm second's mirror empty.

**Acceptance:**
- All 10 manual steps pass.
- Operator-shaped output captured in `.planning/kds-v3/PHASE-1-VERIFICATION.md` (created in T9).

### T9 — Rollback rehearsal + verification report
**Files:**
- `.planning/kds-v3/PHASE-1-VERIFICATION.md` (new — captures evidence + sign-off)

**Procedure:**
1. With T8 mirror still populated, execute `.planning/kds-v3/ROLLBACK.sql` against cafe-pulse-dev.
2. Confirm: 5 tables dropped, indexes gone, RLS policies gone, migration entry removed from `supabase_migrations.schema_migrations`.
3. Re-run `npm run db:migrate` — migration re-applies cleanly.
4. Re-run T8 manual flow — confirms identical end-state to first run.
5. Document the run in `PHASE-1-VERIFICATION.md` with timestamps, counts, and pass/fail per acceptance criterion.

**Acceptance:**
- Rollback SQL produces clean state on first try (or iterate T2 until it does).
- Migration is idempotent on re-apply.
- Verification doc filled in with all checkboxes ✓ and sign-off line.

## Dependencies / ordering rationale
- T1 must precede T4-T9 (everything reads/writes the new tables).
- T2 should land alongside T1 (rollback paired with forward migration).
- T3 is independent of T1; useful before T4 for fixture capture but not strictly blocking.
- T4 must precede T5, T6, T7 (consumers of the sync function).
- T7 needs T4 and fixture data from T3.
- T8 + T9 are end-of-phase verification, after T1-T7 land on the sub-branch.

## Risk areas
- **Sandbox vs production API drift.** Sandbox dashboard menu builder is limited; we're authoring test menus via API. Mitigation: T3 uses the same API endpoints production callers will use; T8 layer 4 (post-staging-merge) re-verifies against a real dashboard-authored menu.
- **Image URL resolution.** Square's IMAGE objects are returned via `include_related_objects: true` but the linkage between item and image is via `item_data.image_ids[]`. Need to handle the lookup correctly. T7 includes a fixture-driven test; T8 verifies against real images in the seed menu.
- **Webhook handler race.** Existing handler may already be processing CATEGORY/ITEM events when our new menu-sync call fires. T5 wraps in try/catch and runs after existing work to avoid breaking current behavior.
- **Migration timestamp ordering on a long-lived branch.** Other migrations may land on staging while this branch is in flight. Mitigation: only additive tables here; rebase from staging weekly.
- **RLS policy gotcha.** Service-role writes bypass RLS, but if KDS v3 phases later read these tables from a user-scoped client, the policies must permit it. T1 includes `tenant_staff_select_*` policies up front.

## Verification checkpoints
Each MOK-151 acceptance criterion maps to one or more tasks:

| MOK-151 acceptance | Verified by |
|---|---|
| Migration creates the 5 tables w/ RLS, FKs, indexes; tenant_id NOT NULL | T1 + manual inspection in Supabase Studio |
| Full sync mirrors a 1-menu/3-group/7-item Square menu | T7 #1 (auto) + T8 #4 (manual) |
| Item rename → webhook → reflected in <30s | T8 #5 (manual, against staging in layer 4) |
| Item moved between groups → memberships replaced | T7 #2 + T8 #5 |
| Item removed from all groups (still exists) → memberships gone, is_deleted=false | T7 #3 |
| Item hard-deleted → cascade | T7 #4 + T8 #5 |
| Variation removed (others stay) → marked deleted | T7 #5 + T8 #5 |
| Menu group deleted → group + memberships cleaned | T7 #6 + T8 #5 |
| Manual full-resync = incremental end-state | T7 #8 |
| REGULAR_CATEGORY processing unchanged | T7 #7 + T5 (existing webhook tests) |
| Integration tests cover all of the above + tenant isolation | T7 |

## Out of scope (per MOK-151)
- KDS screen + grid box schema (phase 2)
- Aesthetic image library (phase 4)
- Per-item display overrides (phase 5)
- Migration UI (phase 3 territory)
- Cutover from v2 KDS data (phase 7)

## Rollback contract
Phase 1's tables are isolated additions with no FKs from existing schema. Rollback SQL at `.planning/kds-v3/ROLLBACK.sql` (T2) drops everything cleanly. Validated by T9 before any merge to staging. Rollback window stays open through phases 2-6 (tables exist but aren't user-facing); after phase 7 cutover, rollback becomes a separate decision.

## Done criteria for phase 1
- All T1-T9 commits on `kds-v3-p1-square-mirror`, each with green CI.
- `PHASE-1-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-p1-square-mirror` → `kds-v3` opened, reviewed, merged.
- Phase 2 spec drafting begins (per just-in-time spec cadence agreed 2026-05-06).
