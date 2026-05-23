# KDS Pi Deployment — Phase 7 plan

**Spec:** [MOK-163](https://linear.app/mokesai/issue/MOK-163) — Pi script updates for v3 URL shape
**Branch:** `kds-v3-pi-p7-script` (base: `kds-v3` @ `0f32aa3`)
**Depends on:** Phase 5 (schema, merged) + Phase 6 (admin UI, merged)

## Goal

Make the Pi script flow consume v3-shaped responses correctly:

1. Don't navigate Chromium to a broken URL when a screen slot is unassigned.
2. Send heartbeats so Phase 6's status UI (online / stale / offline) actually lights up.
3. Drop the v2-era `screen_1` / `screen_2` text labels from operator-visible script output.

This is the first phase the Pi itself consumes end-to-end. Once merged + a real Pi flashes against it, MOK-164 (Phase 10 — end-to-end re-verification) can run.

## Non-goals

- Compositor migration (cage / labwc / sway / Wayland) — Phase 8 owns dual-HDMI rework.
- systemd autostart — Phase 9.
- Removing the legacy `screen_1` / `screen_2` text columns from `kds_devices` — deferred post-Phase-7.
- Multi-Pi-per-location — Phase 6 cap stays at 1.

## T0 — audit findings (done)

| Area | Finding |
|---|---|
| `scripts/pi/kds-kiosk.sh` URL handling | L74–78 uses `// empty` for the **update** path. L86–87 builds the final SCREEN1/SCREEN2 URLs **without** that guard → if either is JSON null, Chromium navigates to `${API_BASE}null`. |
| Heartbeat | Never sent from the Pi. `/api/kds/heartbeat` endpoint exists; Phase 6's `computed_status` depends on `last_heartbeat_at`. Without heartbeats every Pi shows `pending` or `offline` in admin. |
| Legacy text label echoes | `scripts/pi/kds-register.sh:60-61` and `src/app/api/kds/setup/[setupCode]/route.ts:126-127` print `Screen 1: drinks` from the legacy v2 text columns. Phase 5 flagged these for removal. |
| Unassigned-screen UX | Today the kiosk script just launches Chromium with whatever URL string the config holds. No polling, no "waiting" idle state. |
| Compositor | Scripts still use `startx` + X11 + `xrandr`. Phase 8 owns the Wayland migration. Phase 7 stays in X11. |

## Design decisions baked into this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | Null URLs handled at extraction time | Single source of truth: `path=$(jq -r '.screen_1_url // empty')` → `[ -z "$path" ] && skip`. Eliminates `${API_BASE}null` accidents in any future code path. |
| D2 | Awaiting-page on unbound slot | Operator-confirmed alternative. New app route `/kds/awaiting/[deviceId]/[slot]` — server component that reads the device's bound URL for that slot via the Phase 5 helper. If bound, `redirect()` to the v3 page. If unbound, render "Waiting for screen assignment" + device name + admin pointer, with `<meta http-equiv="refresh" content="30">` so the page re-evaluates server-side every 30s and auto-redirects the TV the moment the operator binds it. No Pi reboot needed. |
| D3 | Heartbeat as inline background loop | `while true; do sleep 300; curl POST /api/kds/heartbeat; done &` started after Chromium is up. Dies with the script. Simpler than a separate `kds-heartbeat.sh` + systemd timer; v1+iterate. Phase 9 (systemd autostart) can lift this into a proper unit later. |
| D4 | Heartbeat IP discovery | `curl -s ifconfig.me` for public IP, `hostname -I \| awk '{print $1}'` for local. v1: send the local IP only (private network, operator-meaningful). Skip the external lookup. |
| D5 | Drop legacy `screen_1` / `screen_2` echoes | Replace with v3-aware lines that show the bound screen name (resolved client-side from the response, which already exposes `screen_1_id`/`screen_2_id`). When unassigned, print `(unassigned — bind in admin)`. |
| D6 | Single Chromium-per-slot decision | If `screen_1_url` is empty → skip slot 1. If `screen_2_url` empty → skip slot 2 (also when no HDMI-2 attached, as today). Per slot, independent. |
| D7 | No bash tests | shellcheck + manual walk in Phase 10. v1+iterate. |

## Task breakdown

### T1 — awaiting page (`/kds/awaiting/[deviceId]/[slot]`)

**File:** `src/app/kds/awaiting/[deviceId]/[slot]/page.tsx` (new)

Server component. Reads the device by id, picks `screen_<slot>_id` (slot ∈ {1,2}). If bound, `redirect('/kds/v3/<deviceId>/<screenId>')`. Else render a black-background "Waiting for screen assignment" UI showing the device name and the admin URL. Adds `<meta http-equiv="refresh" content="30">` so a full re-render fires every 30s — the moment the operator binds the slot in admin, the next refresh server-redirects the TV without a Pi reboot.

Public route, no token. The screen pages themselves at `/kds/v3/...` are public; this is just a sibling waiting state. Server-side lookup uses `createServiceClient()` + the device UUID (the operator's "secret" is the SD-card-baked setup code, not the device id).

**Commit:** `feat(kds-v3-pi): MOK-163 T1 — awaiting page for unbound screen slots`

### T2 — kds-kiosk.sh: null-URL handling + per-slot routing + heartbeat

**File:** `scripts/pi/kds-kiosk.sh` (edit)

Key changes:
- `SCREEN1_PATH=$(jq -r '.screen_1_url // empty' "$CONFIG_FILE")` — extract once with `// empty`, never build `${API_BASE}null`.
- Drop the L74–78 jq-write-back block. It's stale-state-on-disk prone to drift; always read fresh from server, fall back to cached file if server unreachable.
- Per slot: if URL non-empty → use it; if empty → use `${API_BASE}/kds/awaiting/${DEVICE_ID}/${slot}`. Either way, one Chromium per connected HDMI output. Slot independence — no early-exit if slot 2 unbound.
- After Chromium launches, spawn a background heartbeat loop: `while sleep 300; do curl -s -X POST -H "Authorization: Bearer $AUTH_TOKEN" -d "{\"device_id\":\"$DEVICE_ID\",\"ip_address\":\"$(hostname -I | awk '{print $1}')\"}" "$API_BASE/api/kds/heartbeat"; done &`. Log non-200 responses but don't kill the kiosk.

**Commit:** `feat(kds-v3-pi): MOK-163 T2 — kiosk script: null guard, per-slot routing, heartbeat`

### T3 — kds-register.sh: drop legacy text echoes

**File:** `scripts/pi/kds-register.sh` (edit)

Replace L60–61:
```bash
echo "  Screen 1:   $(echo "$BODY" | jq -r '.screen_1')"
echo "  Screen 2:   $(echo "$BODY" | jq -r '.screen_2')"
```
with v3-aware lines that read `screen_1_url` / `screen_2_url` and print either the path or `(unassigned)`. This is informational output only — registration logic is unchanged.

**Commit:** `feat(kds-v3-pi): MOK-163 T3 — register script v3-aware output`

### T4 — setup/[setupCode]/route.ts: drop legacy text echoes

**File:** `src/app/api/kds/setup/[setupCode]/route.ts` (edit)

Replace the final-summary `Screen 1: $(jq -r '.screen_1' ...)` lines (L126-127) with v3-aware lines reading `screen_1_url`/`screen_2_url` from the config the registration step just wrote. Same `(unassigned)` fallback as T2.

**Commit:** `feat(kds-v3-pi): MOK-163 T4 — setup script v3-aware summary`

### T5 — shellcheck pass

Run `shellcheck` on both shell scripts. Fix any warnings (likely a handful of quoting nits that existed pre-edit). If shellcheck isn't installed locally, skip — Phase 10 manual walk catches functional issues anyway.

**Commit:** `chore(kds-v3-pi): MOK-163 T5 — shellcheck cleanup` (or fold into T2/T3 if minimal)

### T6 — verification + PR

**File:** `.planning/kds-v3-pi/PHASE-7-VERIFICATION.md` (new)

- Coverage map: MOK-163 acceptance → evidence.
- Static analysis: `npm run lint` + `npm run build` + `shellcheck scripts/pi/*.sh`.
- Manual trace through each script path documented (boot with no bindings → idle; boot with one binding → single Chromium + heartbeat; boot with both → dual Chromium + heartbeat).
- Real-Pi walk deferred to Phase 10.

**Commit:** `verify(kds-v3-pi): MOK-163 T6 — phase 7 verification + manual trace`

## Acceptance criteria (from MOK-163)

| Acceptance | Met by |
|---|---|
| Kiosk script never navigates Chromium to a `${API_BASE}null` URL | T2 (extraction guard) |
| Pi sends periodic heartbeats so admin status lights up | T2 (background loop, 5-min cadence) |
| Operator-visible script output drops `screen_1`/`screen_2` legacy text | T3 + T4 |
| Unbound slot shows an operator-friendly waiting state instead of crashing | T1 (awaiting page) + T2 (kiosk routes to it) |
| Operator binding a screen mid-boot reaches the TV without a reboot | T1 (meta-refresh redirect on server-side eval) |
| Two-screens-bound boot path unchanged | T2 (slot logic generalized; bound URL still wins) |
| Lint + build clean; shellcheck clean | T5 + T6 |

## Risks / open questions

- **R1 — Heartbeat race with single-shot script termination**: if Chromium exits (crash, kill), `wait` returns and the script exits, killing the heartbeat loop. v1: acceptable; the Pi has stopped displaying anyway, so going `offline` in admin is correct.
- **R2 — `ifconfig.me` not used**: `hostname -I` is reliable on Pi OS. Skipping public IP is fine for the operator's internal-network use case.
- **R3 — Cache headers on setup script**: `setup/[setupCode]/route.ts` already sets `Cache-Control: no-store` so the edits land immediately. No CDN invalidation needed.
- **R4 — Heartbeat endpoint expects bearer token**: we already have `AUTH_TOKEN` in memory after config load. Trivial.

## Rollback

No schema or API contract changes. To roll back: revert the PR. Existing Pi devices (none in production yet) would simply stop heartbeating and revert to the old null-URL bug.

## Out of scope (later phases)

- Dual-HDMI via Wayland compositor — Phase 8 (MOK-49)
- systemd autostart on boot — Phase 9 (MOK-50)
- End-to-end Pi re-verification + tenant onboarding docs — Phase 10 (MOK-164)
