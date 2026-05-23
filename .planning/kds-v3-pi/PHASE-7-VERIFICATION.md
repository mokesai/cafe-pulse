# KDS Pi Deployment — Phase 7 verification report

**Spec:** [MOK-163](https://linear.app/mokesai/issue/MOK-163)
**Plan:** [.planning/kds-v3-pi/PHASE-7-PLAN.md](./PHASE-7-PLAN.md)
**Branch:** `kds-v3-pi-p7-script`
**Base:** `kds-v3` @ `0f32aa3`
**Verified on:** 2026-05-22

---

## Summary

Pi-side artifacts now consume Phase 5's v3 URL shape correctly. The kiosk script no longer constructs broken `${API_BASE}null` URLs, always appends the device's auth token as `?token=` so the v3 + awaiting pages authenticate without a cookie round-trip, and routes any unbound slot to a new `/kds/awaiting/[deviceId]/[slot]` server page that auto-redirects the TV the moment the operator binds a screen in admin.

Heartbeats stay browser-side (existing `KDSHeartbeat` on the v3 page; same component mounted on the new awaiting page) — no bash heartbeat loop introduced.

Operator-visible script output drops the legacy `Screen 1: drinks` echoes from both the register script and the `curl … | bash` setup endpoint.

- 1 new app route (`/kds/awaiting/[deviceId]/[slot]`)
- 1 new tiny client component (`AutoRefresh` — 30s `window.location.reload()`)
- 3 script-side updates (`kds-kiosk.sh`, `kds-register.sh`, `/api/kds/setup/[setupCode]/route.ts`)
- No schema changes (no rollback SQL needed)

---

## Coverage map: MOK-163 acceptance → evidence

| MOK-163 acceptance | Evidence | Status |
|---|---|---|
| Kiosk script never builds `${API_BASE}null` URLs | T2 commit `e69ff4b` — `jq -r '... // empty'` extraction + `[ -n "$path" ]` guard | ✅ |
| Pi sends heartbeats so admin status lights up | Browser-side `KDSHeartbeat` (existing on v3 page, added to T1 awaiting page) + T2 token append so the page authenticates | ✅ |
| Operator-visible output drops `screen_1`/`screen_2` legacy text | T3 (`b5c9c93`) + T4 (`5b1fa8c`) | ✅ |
| Unbound slot shows operator-friendly waiting state | T1 (`41773cc`) — `/kds/awaiting/[deviceId]/[slot]` server component | ✅ |
| Operator binding mid-boot reaches the TV without reboot | T1 — server component re-evaluates on each `AutoRefresh` reload (30s); when binding appears, server-side `redirect()` to v3 page | ✅ |
| Two-screens-bound boot path unchanged | T2 — slot logic generalized; bound URL still wins; HDMI-2 detection via xrandr unchanged | ✅ |
| Lint + build clean | `npm run lint` ✅ · `npm run build` ✅ (awaiting route registered at `/kds/awaiting/[deviceId]/[slot]`) | ✅ |

---

## Automated coverage

| Layer | File | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ no warnings |
| Unit | `npm run test:unit` (147 cases) | ✅ |
| Build | `npm run build` | ✅ new route `/kds/awaiting/[deviceId]/[slot]` registered |
| Syntax check | `bash -n scripts/pi/kds-{kiosk,register}.sh` | ✅ both pass |

shellcheck not installed locally — skipped per plan T5. Manual review found no Phase-7-introduced quoting issues; existing patterns (which shellcheck would also flag) preserved as-is to keep this PR scoped.

---

## Manual trace — three boot states

**State A — both screens bound** (regression check):
1. Boot → `kds-kiosk.sh` reads `auth_token` from `kds-config.json`.
2. Fetches `/api/kds/device/<id>/config` with Bearer header.
3. Both `screen_1_url` and `screen_2_url` non-empty.
4. `build_slot_url` returns `${API_BASE}${path}?token=${ENC_TOKEN}` for both.
5. Chromium launches on HDMI-1 → /kds/v3/<deviceId>/<screen1>?token=…
6. xrandr sees HDMI-2 connected → Chromium launches on HDMI-2 → /kds/v3/<deviceId>/<screen2>?token=…
7. v3 page reads `?token=` searchParam, mounts `KDSHeartbeat`. Admin shows "online" within 60s.

**State B — only screen 1 bound** (the bug Phase 7 fixes):
1. Boot → config returns `screen_1_url: "/kds/v3/<id>/<s1>"`, `screen_2_url: null`.
2. `SCREEN1_PATH=/kds/v3/<id>/<s1>`, `SCREEN2_PATH=""` (thanks to `// empty`).
3. `build_slot_url 1 …` returns the v3 URL with token.
4. `build_slot_url 2 ""` returns `${API_BASE}/kds/awaiting/<deviceId>/2?token=…`.
5. HDMI-1 → v3 page; HDMI-2 → black "Waiting for screen assignment" page showing device name + "Slot 2".
6. Operator binds screen 2 in admin → next `AutoRefresh` tick (≤30s) re-renders the awaiting page, server sees `screen_2_id` non-null, `redirect()` to v3. TV updates without Pi reboot.

**State C — neither bound**: same as B but both TVs show the awaiting state. Both heartbeat. Operator binds either slot → that TV redirects within 30s.

---

## Notes

### Existing v2 Pi
Operator has a v2-era Pi previously set up via SSH (not flashed from current SD image). It runs the older script versions which:
- Don't append `?token=` (so v3 page would 404 if pointed there)
- Don't know about the awaiting page
- Still echo the legacy `Screen 1: drinks` labels

Phase 10 (MOK-164) covers the re-walk; until then the existing Pi will need either a re-run of the `curl … | bash` setup, or a manual `scp` of the two updated scripts. Documented in the Phase 10 plan when it's drafted.

### Browser-side heartbeat cadence
`src/components/kds/v3/KDSHeartbeat.tsx` POSTs every 60s. Phase 6's `computed_status` thresholds (8 min online / 20 min stale / 20 min offline) were sized for a hypothetical 5-min bash loop; with 60s browser beats they're very forgiving but still functional. Tightening is an iterate-1 follow-up.

### Token in URL
`?token=$AUTH_TOKEN` rides in the URL on every Chromium launch and on the redirect. The token is per-device and long-lived (5y cookie maxAge in `/api/kds/register`). Risk surface: it lands in Chromium's URL bar, browser history, and the network tab. Within the kiosk context (no operator at the keyboard, kiosk mode hides chrome) this is acceptable. Long-term improvement: have the kiosk script POST the token to a small `/api/kds/cookie` endpoint that issues a `Set-Cookie` and redirects — out of scope for v1.

### Wayland / dual HDMI
This phase stays in X11 / `xrandr`. Phase 8 (MOK-49) owns the labwc/sway migration. The kiosk script's HDMI-2 detection block carries a comment flagging this.

---

## Commits

| Task | Commit | Subject |
|---|---|---|
| Plan | `10c2296` | plan(kds-v3-pi): MOK-163 phase 7 — Pi script updates for v3 URL shape |
| T1 | `41773cc` | feat(kds-v3-pi): MOK-163 T1 — awaiting page for unbound slots |
| T2 | `e69ff4b` | feat(kds-v3-pi): MOK-163 T2 — kiosk script null guard + per-slot routing + token |
| T3 | `b5c9c93` | feat(kds-v3-pi): MOK-163 T3 — register script v3-aware output |
| T4 | `5b1fa8c` | feat(kds-v3-pi): MOK-163 T4 — setup curl-bash summary v3-aware |
| T5 | — | shellcheck unavailable locally; `bash -n` + manual review documented above |

---

## Next

PR `kds-v3-pi-p7-script` → `kds-v3`. Phase 8 (MOK-49) — dual-HDMI via labwc/sway — branches off `kds-v3` once this merges. Phase 8 owns the Wayland compositor migration; Phase 7's xrandr-based HDMI-2 detection retires with it.
