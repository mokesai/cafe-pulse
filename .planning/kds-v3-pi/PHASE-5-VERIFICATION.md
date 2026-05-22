# KDS Pi Deployment — Phase 5 verification report

**Spec:** [MOK-161](https://linear.app/mokesai/issue/MOK-161)
**Plan:** [.planning/kds-v3-pi/PHASE-5-PLAN.md](./PHASE-5-PLAN.md)
**Branch:** `kds-v3-pi-p5-schema`
**Verified against:** cafe-pulse-dev (`ettmabcwfhidcpapphgm`)
**Verified on:** 2026-05-22

---

## Summary

`kds_devices` now has v3-aware screen references. Pi-side config routes (`register` + `device/[deviceId]/config`) return v3 URLs (`/kds/v3/<deviceId>/<screen_uuid>`) when screens are assigned; null when not. Legacy `screen_1` / `screen_2` text columns kept through one release for transition safety.

- 2 new UUID columns on `kds_devices` (`screen_1_id`, `screen_2_id`)
- 2 FKs to `kds_screens(id)` with `ON DELETE SET NULL`
- New helper `src/lib/kds/devices.ts` — single source of truth for URL construction
- 2 API routes updated (`/api/kds/register`, `/api/kds/device/[deviceId]/config`)
- `/api/kds/sd-image` left alone (doesn't construct URLs; only informational README labels)
- 5 integration tests, all green

---

## Coverage map: MOK-161 acceptance → evidence

| MOK-161 acceptance | Evidence | Status |
|---|---|---|
| Migration adds `screen_1_id` + `screen_2_id` UUID columns | T1 commit `6db5fc9` | ✅ |
| FKs with `ON DELETE SET NULL` | T1 + 4-case battery | ✅ |
| `device/[deviceId]/config` returns new fields | T3 commit `5f14550` + T4 case #1, #2 | ✅ |
| `register` returns new fields | T3 + T4 case #3 | ✅ |
| `getDeviceScreenUrls` helper exists | T3 (`src/lib/kds/devices.ts`) | ✅ |
| Integration tests: round-trip + FK SET NULL + tenant guard | T4 (5 cases) | ✅ |
| Rollback drops columns cleanly | T5 (this report) | ✅ |

---

## T1 — Forward migration corner battery (executed 2026-05-22)

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | Columns + FKs exist; existing rows have NULL UUIDs | PASS | ✅ 2 columns, 2 FKs, 1 row with NULL pair |
| 2 | INSERT with valid `screen_1_id` referencing a real `kds_screens.id` | PASS | ✅ round-trips |
| 3 | INSERT with fabricated UUID not in `kds_screens` | FK_VIOLATION | ✅ `kds_devices_screen_1_id_fkey` |
| 4 | DELETE referenced screen → device's `screen_1_id` becomes NULL | SET NULL | ✅ device row survived |

Battery test rows cleaned up after the run.

---

## T5 — Rollback rehearsal (executed 2026-05-22)

### Pre-rollback

| Metric | Value |
|---|---|
| Phase 5 UUID columns | 2 |
| Phase 5 FKs | 2 |
| `schema_migrations` row `20260522230507` | 1 |
| `kds_devices` row count | 1 |
| Legacy text columns (`screen_1`/`screen_2`) | 2 |

### Post-rollback (PHASE-5-ROLLBACK.sql executed)

| Metric | Expected | Actual | Status |
|---|---|---|---|
| Phase 5 UUID columns | 0 | 0 | ✅ |
| Phase 5 FKs | 0 | 0 | ✅ |
| Migration row | 0 | 0 | ✅ |
| `kds_devices` row count | 1 | 1 | ✅ (preserved) |
| Legacy text columns | 2 | 2 | ✅ (untouched) |

### Re-apply via `supabase db push`

Migration re-applied cleanly. All 3 metrics returned to phase-5-applied state (2 / 2 / 1).

Rollback + re-apply both idempotent.

---

## Automated coverage

| Layer | File | Cases | Result |
|---|---|---|---|
| Integration | `tests/integration/kds-v3-pi-p5-devices.test.ts` (new) | 5 | ✅ |
| Lint | `npm run lint` | — | ✅ no warnings |
| Build | `npm run build` | — | ✅ |

---

## Notes

### Existing dev device

The single `kds_devices` row in dev (bigcafe Pi from earlier KDS testing) was `screen_1='drinks'`, `screen_2='food'`, with both new UUID columns NULL after this migration. **Expected** — Phase 6's device manager will surface the "Unassigned" state and let the operator re-assign to v3 screens.

### What the Pi sees today

Until Phase 6 lands and the operator assigns v3 screens, any registered Pi calling `device/<id>/config` gets `screen_1_url: null` / `screen_2_url: null`. The kiosk script's `jq -r '... // empty'` handles this — the second Chromium is skipped when the URL is empty. The TV will be blank (correctly — there's no screen assigned). Operator action in Phase 6 unblocks rendering.

### Sd-image route deliberately untouched

`/api/kds/sd-image` bakes labels like "Screen 1: drinks" into a setup README. No URL construction happens there; the labels are operator-readable hints during SD-card preparation. Leaving them on the legacy text columns is fine — Phase 6's device manager will be the canonical source of "what screen is assigned where" once it lands.

---

## Commits

| Task | Commit | Subject |
|---|---|---|
| Plan | `0c5ca08` | plan(kds-v3-pi): MOK-161 phase 5 — v3 schema integration on kds_devices |
| T1 | `6db5fc9` | schema(kds-v3-pi): MOK-161 T1 — kds_devices.screen_1_id / _2_id + FKs |
| T2 | `02fc56e` | plan(kds-v3-pi): MOK-161 T2 — phase 5 rollback SQL |
| T3 | `5f14550` | feat(kds-v3-pi): MOK-161 T3 — getDeviceScreenUrls helper + v3 URLs in 2 routes |
| T4 | `a6a36a6` | test(kds-v3-pi): MOK-161 T4 — phase 5 integration tests |

---

## Next

PR `kds-v3-pi-p5-schema` → `kds-v3`. Phase 6 (MOK-162) — device manager rebuild as 4th tab — branches off `kds-v3` once this merges. Phase 6 will consume `screen_1_id` / `screen_2_id` for the screen-binding dropdowns and surface the "Unassigned" badge in the devices table.
