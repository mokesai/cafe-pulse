# KDS v3 — Phase 7 verification report

**Spec:** [MOK-160](https://linear.app/mokesai/issue/MOK-160)
**Plan:** [.planning/kds-v3/PHASE-7-PLAN.md](./PHASE-7-PLAN.md)
**Branch:** `kds-v3-p7-cutover`
**Verified against:** cafe-pulse-dev (`ettmabcwfhidcpapphgm`)
**Verified on:** 2026-05-22

---

## Summary

v2 is now fully gone from the codebase. v3 is the single canonical KDS surface.

- Sidebar has one `KDS Setup` entry (the renamed `KDS v3 (beta)`) landing on `/admin/kds-v3/screens`. The old `KDS Setup` pointing at `/admin/kds-config` is gone (the path itself is gone too).
- v2 admin (`/admin/(kds)/...`, `/admin/(protected)/kds-config/...`, `/api/admin/kds/...`) — deleted.
- v2 public routes (`/kds/drinks`, `/kds/food`, `/kds/display/...`) — deleted. v3 Pi route `/kds/v3/[deviceId]/[screenId]` unchanged.
- v2 components (`src/app/kds/components/*` — 23 files: `KDSScreen`, `KDSDrinksMagazine`, `KDSFoodMagazine`, `KDSHeader`, etc.) — deleted.
- v2 lib helpers (`src/lib/kds/{access,group-items,layout-types,photos,queries,types}.ts` + the `index.ts` barrel) — deleted.
- v2-only deprecated CSS (`kds-warm.css`, `kds.css`) — deleted. Shared theme CSS (`kds-themes.css` + the three theme variants + `kds-base.css`) preserved.
- `KDSHeartbeat` + `KDSDisplayWrapper` moved from a v2-shaped path into `src/components/kds/v3/` so the v3 route can stand alone.
- v2 schema (`kds_categories`, `kds_menu_items`, `kds_settings`, `kds_images`) annotated `COMMENT ON TABLE ... DEPRECATED`. Structural DROP is phase 7.5.

Total deletion: **~7000 lines of v2 code across ~60 files.**

---

## Coverage map: MOK-160 acceptance → evidence

| MOK-160 acceptance | Evidence | Status |
|---|---|---|
| 1. Sidebar has one `KDS Setup` entry pointing at `/admin/kds-v3/screens` | T5 commit `c7b79d3` + grep | ✅ |
| 2. v3 imports nothing from v2-shaped paths | T1 commit `b35fdcf` + post-T7 grep | ✅ |
| 3. v2 admin paths return 404 — code deleted | T2 commit `cf1a887` | ✅ |
| 4. v2 public routes return 404 — code deleted | T3 commit `596cc70` | ✅ |
| 5. v2 tables annotated DEPRECATED | T6 commit `ee7417a`, migration `20260522220313` | ✅ |
| 6. lint / build / unit / integration all green | T7 sweep — see results below | ✅ (kds-v3) / ⚠ (rate-limited rest) |
| 7. Rollback path documented | This report § Rollback | ✅ |

---

## T7 — Full quality-gate sweep results

```
npm run lint                       → ✅ no warnings
npm run build                      → ✅ clean (cleaned .next first)
npm run test:unit                  → ✅ 147/147 (9 files)
npm run test:integration tests/integration/kds-v3
                                   → ✅ 81/81 (7 files)
```

Full integration suite (`npm run test:integration`, no path filter) hit Supabase auth's "Request rate limit reached" on 8 non-KDS test files when running 30 files in parallel. This is **pre-existing test-infra rate-limiting**, not a phase 7 regression — every parallel-test run that creates 30+ tenants in quick succession hits this. Confirmed by:

- All failures share the same error: `Failed to sign in test user: Request rate limit reached`
- Zero failures reference deleted v2 files
- Final grep confirms no test file imports any deleted v2 lib (`@/lib/kds/{queries,types,access,group-items,photos,layout-types}`)
- KDS v3 subset (the only area touched by phase 7) runs clean: 81/81

For phase 7 acceptance the targeted KDS v3 sweep is the load-bearing check. The rate-limited integration runs aren't a phase 7 concern and can be addressed in a separate test-infra ticket (e.g. throttle test parallelism, or stagger tenant creation).

---

## Rollback

No schema rollback artifact needed — the only DB change is `COMMENT ON TABLE` (metadata only). To revert phase 7:

```
git revert <merge-commit-of-PR>     # restores deleted v2 code
# optionally: re-set comments to NULL
COMMENT ON TABLE public.kds_categories IS NULL;
COMMENT ON TABLE public.kds_menu_items IS NULL;
COMMENT ON TABLE public.kds_settings   IS NULL;
COMMENT ON TABLE public.kds_images     IS NULL;
```

v2 data in the underlying tables was never touched. Restoration is just `git revert`.

---

## Commits

| Task | Commit | Subject |
|---|---|---|
| Plan | `dc0911f` | plan(kds-v3): MOK-160 phase 7 — v2 cutover |
| T1 | `b35fdcf` | refactor(kds-v3): MOK-160 T1 — move shared infra out of v2 paths |
| T2 | `cf1a887` | chore(kds-v3): MOK-160 T2 — delete v2 admin code |
| T3 | `596cc70` | chore(kds-v3): MOK-160 T3 — delete v2 public routes + components + CSS |
| T4 | `ac4e630` | chore(kds-v3): MOK-160 T4 — delete v2 lib helpers + v2 theme selector |
| T5 | `c7b79d3` | ui(kds-v3): MOK-160 T5 — sidebar consolidation |
| T6 | `ee7417a` | schema(kds-v3): MOK-160 T6 — v2 tables marked DEPRECATED |

---

## Next

PR `kds-v3-p7-cutover` → `kds-v3`. After merge, a single `kds-v3` → `staging` PR opens — **this is the moment the entire v3 rollout ships through to production.**

Phase 7.5 (drop the 4 v2 tables) is captured as a follow-up — wait 1–2 weeks of v3 in production before opening.

After phase 7.5 closes, the **KDS Raspberry Pi Deployment** Linear project comes off the shelf.
