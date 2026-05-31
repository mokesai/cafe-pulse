# KDS Pi Deployment — Phase 8 verification report

**Specs:**
- [MOK-49](https://linear.app/mokesai/issue/MOK-49) — Dual HDMI support
- [MOK-50](https://linear.app/mokesai/issue/MOK-50) — systemd autostart at boot
**Plan:** [.planning/kds-v3-pi/PHASE-8-PLAN.md](./PHASE-8-PLAN.md)
**Branch:** `kds-v3-pi-p8-wayland`
**Base:** `kds-v3` @ `aa9bc97`
**Status:** Awaiting operator walkthrough — fill the checklists below as you go and we'll bake the results into the report before merge.

---

## Summary (pending walkthrough)

Replaces the v2-era X11 / startx / `.bash_profile` autostart stack with a Wayland-native kiosk using sway as the compositor and a systemd user service with linger enabled. Drives both HDMI outputs simultaneously by routing per-slot Chromium instances to pinned workspaces via `--class` app-id matching.

- 2 new artifacts shipped (`scripts/pi/sway-config`, `scripts/pi/kds-kiosk.service`)
- `scripts/pi/kds-kiosk.sh` rewritten (~80 lines removed, ~60 added)
- `src/app/api/kds/setup/[setupCode]/route.ts` install flow rewritten (packages, autostart, defensive v2 cleanup)
- `src/app/api/kds/kiosk-script/route.ts` extended for two new artifact types
- 6-case unit test for the kiosk-script endpoint
- No DB changes; no app-side schema changes

---

## Coverage map: MOK-49 + MOK-50 acceptance → evidence

| Acceptance | Evidence | Status |
|---|---|---|
| Pi boots straight to Chromium kiosk without a console login (MOK-50) | systemd-user + `loginctl enable-linger pi` (T3) | ☐ pending walkthrough |
| Both HDMI outputs drive their bound v3 URLs simultaneously (MOK-49) | sway workspace pinning + `--class` matching (T1 + T2) | ☐ pending walkthrough |
| Single-HDMI install still works (slot 2 hides) | sway no-output-no-render (T1, design D7) | ☐ pending walkthrough |
| Awaiting page renders for unbound slots | Phase 7 (already merged) | ☐ confirm during walkthrough |
| Heartbeats reach admin from both Chromium instances | Phase 7 browser-side `KDSHeartbeat` | ☐ confirm during walkthrough |
| Re-run of setup curl is idempotent | T3 defensive cleanup of `.bash_profile` startx + X11 blanking conf | ☐ pending walkthrough |
| No X11 runtime packages required | T3 package list swap | ☐ confirm via `dpkg -l \| grep xserver-xorg` (should be empty / not running) |

---

## Automated coverage

| Layer | File | Cases | Result |
|---|---|---|---|
| Unit | `src/app/api/kds/kiosk-script/__tests__/route.test.ts` (new) | 6 | ✅ |
| Lint | `npm run lint` | — | ✅ no warnings |
| Build | `npm run build` | — | ✅ |
| Syntax | `bash -n scripts/pi/kds-kiosk.sh` | — | ✅ |
| Full unit suite | `npm run test:unit` | 178 | ✅ |

---

## Operator walkthrough — to be completed on a fresh Pi flash

### Pre-flash

- [ ] cafe-pulse-dev has bigcafe tenant with at least one v3 screen created and the device row revoked (so we start clean with a new setup code)
- [ ] Mac dev server running `npm run dev -- -H 0.0.0.0` on the kds-v3-pi-p8-wayland branch
- [ ] Pi 5 + 2 HDMI TVs connected on both ports
- [ ] `/etc/hosts` on the Pi has `192.168.4.114 bigcafe.local-macbook` (or current Mac IP)

### Flash

- [ ] Pi OS Lite 64-bit Bookworm flashed via Imager onto the SD card. **Imager options:** set hostname `raspberrypi`, enable SSH, set pi user with strong password, set WiFi. **Do not** enable any boot autologin — Phase 8 supersedes it.

### Install

- [ ] SSH in: `ssh pi@raspberrypi.local`
- [ ] In admin → KDS Setup → Devices, add a new device. Copy the setup code (format `XXXX-XXXX`).
- [ ] On the Pi:
  ```bash
  curl -sL http://bigcafe.local-macbook:3000/api/kds/setup/<NEW-CODE> | bash
  ```
- [ ] Observe each step prints `Done:`. Setup completes with `[5/5] Setup complete!` and the new "Note: No console autologin needed" line.
- [ ] **Decline the reboot prompt** so we can inspect first. Verify on the Pi:
  ```bash
  ls -la ~/.config/sway/config ~/.config/systemd/user/kds-kiosk.service ~/kds-kiosk.sh ~/.kds-env ~/kds-config.json
  ```
  Expected: all 5 files exist with current timestamps.
- [ ] `systemctl --user is-enabled kds-kiosk.service` → `enabled`
- [ ] `loginctl show-user pi | grep -i linger` → `Linger=yes`
- [ ] `dpkg -l | grep -E 'sway|seatd|xserver-xorg'` — sway + seatd installed, no xserver-xorg
- [ ] `groups pi` includes `seat`, `render`, `video`

### Boot (single TV first)

- [ ] **Disconnect HDMI-2** so only HDMI-1 is active.
- [ ] `sudo reboot`
- [ ] After ~30s: TV-1 shows brief boot log → black → Chromium kiosk loading the v3 page. NO `raspberrypi login:` prompt visible after the boot sequence.
- [ ] `journalctl --user -u kds-kiosk -n 50` (SSH back in to check) shows sway starting + Chromium PIDs.
- [ ] `~/kds-kiosk.log` shows screen URLs and `Chromium instances live. PIDs: …`
- [ ] In admin → KDS Setup → Devices: heartbeat dot turns green within 60s.

### Boot (dual TV)

- [ ] Power off Pi. Plug HDMI-2 into TV-2. Power on.
- [ ] After ~30s: TV-1 renders screen 1's bound v3 URL, TV-2 renders screen 2's bound v3 URL (or the awaiting page if slot 2 still unbound in admin).
- [ ] In admin: bind a screen to slot 2 of the device. Within ~30s TV-2's awaiting page server-side redirects to the bound v3 URL. (Tests Phase 7's auto-refresh.)
- [ ] Admin still shows the device online.

### Re-run idempotency

- [ ] Without reflashing, on the Pi:
  ```bash
  systemctl --user stop kds-kiosk.service   # stop the kiosk so re-run doesn't fight it
  curl -sL http://bigcafe.local-macbook:3000/api/kds/setup/<NEW-CODE> | bash  # will fail at register — code consumed
  ```
- [ ] **Better idempotency check:** edit `~/.kds-env` to flip the origin URL, run the setup curl with a different origin (creates a new device in admin first, takes a new code), and confirm `~/.kds-env`, `~/.config/sway/config`, and `~/.config/systemd/user/kds-kiosk.service` all overwrite cleanly.

### Break-glass debugging

- [ ] Plug a USB keyboard into the Pi. Press Mod4+Return (Windows-key + Enter). The break-glass `foot` terminal should appear. Press Mod4+Shift+Q to close it. (Verifies sway is reachable for ops debugging.)

---

## Issues to capture

(Fill as you walk — anything that surprises, fails, or needs a follow-up.)

- [ ] _(empty)_

---

## Commits

| Task | Commit | Subject |
|---|---|---|
| Plan | `cc3bc37` | plan(kds-v3-pi): MOK-49/50 phase 8 — Wayland + systemd autostart |
| T1 | `0f3c226` | feat(kds-v3-pi): MOK-49/50 T1 — sway config + systemd user unit |
| T2 | `6b0dd16` | feat(kds-v3-pi): MOK-49/50 T2 — Wayland-native kiosk script |
| T3 | `13488b3` | feat(kds-v3-pi): MOK-49/50 T3 — setup endpoint installs Wayland stack |
| T4 | `0cf0806` | feat(kds-v3-pi): MOK-49/50 T4 — kiosk-script serves sway-config + systemd-unit |
| T5 | _(this commit)_ | verify(kds-v3-pi): MOK-49/50 T5 — phase 8 walkthrough checklist + verification stub |

---

## Next

PR `kds-v3-pi-p8-wayland` → `kds-v3` opens with this stub. Operator drives the walkthrough; we update this report with results and any issues before merging. After merge, Phase 10 (MOK-164) closes out the project with a tenant-docs refresh covering the new install path.
