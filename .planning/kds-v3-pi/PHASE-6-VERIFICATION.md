# KDS Pi Deployment — Phase 6 verification report

**Spec:** [MOK-162](https://linear.app/mokesai/issue/MOK-162)
**Plan:** [.planning/kds-v3-pi/PHASE-6-PLAN.md](./PHASE-6-PLAN.md)
**Branch:** `kds-v3-pi-p6-devices`
**Base:** `kds-v3` @ `498955c`
**Verified on:** 2026-05-22

---

## Summary

KDS Setup now has a 4th `Devices` tab. Operator can add a Pi (name → setup code reveal), see its status (online / stale / pending / offline derived from the 5-min heartbeat), rename it inline, bind each HDMI slot to one of the tenant's `kds_screens`, and revoke. Cap of one device per tenant enforced.

- 2 admin API endpoints (`/api/admin/kds-v3/devices` + `/api/admin/kds-v3/devices/[deviceId]`)
- 4th tab added to the KDS v3 admin layout
- New devices admin page (`/admin/kds-v3/devices`) — inlined client component matching the screens admin pattern
- 10 integration tests, all green
- No schema changes (no rollback SQL needed)

---

## Coverage map: MOK-162 acceptance → evidence

| MOK-162 acceptance | Evidence | Status |
|---|---|---|
| 4th `Devices` tab visible in KDS Setup | T3 commit `0721838` | ✅ |
| Operator can register a new Pi (name → setup code) | T1 + T4 (POST + Add form + setup-code reveal) | ✅ |
| Operator can see device status: online / stale / pending / offline | T1 (`computed_status`) + T4 (status dot + label) | ✅ |
| Operator can bind/unbind each screen slot | T2 (PATCH `screen_*_id`) + T4 (selects) | ✅ |
| "Unassigned" badge visible when no screen bound | T4 (amber badge alongside the select) | ✅ |
| Operator can rename a device | T2 (PATCH name) + T4 (inline pencil) | ✅ |
| Operator can revoke a device | T2 (DELETE) + T4 (Revoke button + confirm) | ✅ |
| Tenant isolation enforced | T5 case #10 | ✅ |
| One-device cap enforced | T1 + T5 case #3 (`KDS_DEVICE_LIMIT_REACHED`) | ✅ |
| Screen binding rejects cross-tenant IDs | T2 + T5 case #7 (`KDS_DEVICE_SCREEN_NOT_OWNED`) | ✅ |

---

## Automated coverage

| Layer | File | Cases | Result |
|---|---|---|---|
| Integration | `tests/integration/kds-v3-pi-p6-devices-admin.test.ts` (new) | 10 | ✅ |
| Unit | `npm run test:unit` | 147 | ✅ |
| Lint | `npm run lint` | — | ✅ no warnings |
| Build | `npm run build` | — | ✅ new routes registered (`/admin/kds-v3/devices`, `/api/admin/kds-v3/devices`, `/api/admin/kds-v3/devices/[deviceId]`) |

---

## Notes

### Status freshness thresholds

Pi heartbeats every 5 min (`refresh_interval: 300000` in `/api/kds/heartbeat`). The API derives:

- **online** — last heartbeat within 8 min (one full beat + 3-min buffer)
- **stale** — 8–20 min (1–3 missed beats — could be a network blip)
- **offline** — > 20 min
- **pending** — never registered

These are first-pass thresholds. Tune in iterate-1 once a real Pi is running and we observe how often the 5-min beat slides under load / over WiFi reconnections.

### Revoke semantics

DELETE just removes the row. The Pi's auth_token goes with it, so the Pi's next heartbeat returns 401. Until the operator re-flashes the SD card, the Pi is bricked — acceptable per v1 scope. Operator confirmed: "I don't have any Pi's running yet."

### Roles

`requireAdminAuth` blocks `staff` at the middleware layer. The migration's RLS allows `staff` SELECT, but since admin routes use the service-role client, RLS isn't on the path. Operator confirmed: admin-only.

### Setup-code reveal UX

The setup code is included in every GET response on a pending device, so the operator can come back later and copy it. Once the Pi registers, the setup_code column is cleared and the row's `Show setup` toggle becomes inactive (the button is only shown when `computed_status === 'pending'`).

### Re-binding while Pi is running

The Pi fetches `/api/kds/device/[id]/config` only on boot. Re-binding screens mid-session won't take effect until reboot. Acceptable per v1 scope; flagged in the plan as future iterate.

### Auto-refresh interval

The page polls the list endpoint every 30 s to keep the status dot fresh. With the 1-device cap that's at most one row × every 30 s — negligible cost.

### No schema changes

Phase 5 already added the `screen_1_id` / `screen_2_id` UUID columns; Phase 6 only adds API + UI on top. No rollback SQL needed — to back out, revert the PR.

---

## Commits

| Task | Commit | Subject |
|---|---|---|
| Plan | `ccb617a` | plan(kds-v3-pi): MOK-162 phase 6 — device manager as 4th tab |
| T1 | `61dd3ff` | feat(kds-v3-pi): MOK-162 T1 — admin devices list + create routes |
| T2 | `5762a51` | feat(kds-v3-pi): MOK-162 T2 — admin device rename + bind + revoke |
| T3 | `0721838` | feat(kds-v3-pi): MOK-162 T3 — Devices tab in KDS Setup |
| T4 | `b9bfa49` | feat(kds-v3-pi): MOK-162 T4 — devices admin page |
| T5 | `17e9e8f` | test(kds-v3-pi): MOK-162 T5 — phase 6 admin integration tests |

---

## Next

PR `kds-v3-pi-p6-devices` → `kds-v3`. Phase 7 (MOK-163) — Pi script updates for the v3 URL shape — branches off `kds-v3` once this merges. With Phase 5 (schema) + Phase 6 (operator UI) landed, Phase 7 is the first piece the Pi itself consumes end-to-end.
