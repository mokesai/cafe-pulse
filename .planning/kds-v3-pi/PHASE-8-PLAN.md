# KDS Pi Deployment — Phase 8 plan (Wayland + systemd, merging Phases 8 + 9)

**Specs:**
- [MOK-49](https://linear.app/mokesai/issue/MOK-49) — Dual HDMI support
- [MOK-50](https://linear.app/mokesai/issue/MOK-50) — systemd autostart at boot
- **Phases 8 and 9 collapsed** by operator decision 2026-05-31. Same systems work; merging avoids two passes over the install flow.

**Branch:** `kds-v3-pi-p8-wayland` (base: `kds-v3` @ `aa9bc97`)
**Depends on:** Phase 5/6/7 (merged) + MOK-165/166/167 (merged)
**Status of the X11 path it replaces:** dead — Bookworm Xorg autoconfig dies with `Cannot run in framebuffer mode` even with explicit `modesetting` driver config (verified hands-on 2026-05-31).

## Goal

Replace the v2-era X11 / startx / `.bash_profile` autostart stack with a Wayland-native kiosk that:

1. Boots automatically without an interactive login (no `raspi-config` console-autologin prerequisite).
2. Drives both HDMI outputs simultaneously, with bound v3 URLs or awaiting URLs per slot.
3. Works on Pi 5 (primary) and Pi 4 (locked decision #4).
4. Pairs cleanly with all the Phase 5–7 + dev-host plumbing already merged.

## Non-goals

- Multi-Pi-per-location — Phase 6 cap stays at 1.
- Tenant docs / `raspberry-pi-deployment.md` overhaul — Phase 10 (MOK-164) territory; this phase just does the technical implementation.
- Pi OS Lite *Bullseye* support — Bookworm only. The user already flashed Bookworm; older releases are out of scope.
- Migration helper from the existing v2-style X11 install on the operator's current Pi — they'll re-flash for the Phase 8 walkthrough. Established earlier in the session.
- A KDS-specific Pi OS image — that was an old project idea, not in scope here.

## T0 — audit findings (done)

| Area | Finding |
|---|---|
| Current `scripts/pi/kds-kiosk.sh` | 180 lines, X11-heavy. Uses `xset` for blanking, `xrandr` for HDMI-2 detection, `DISPLAY=:0.0` / `:0.1` for per-output Chromium. All of this is X11-only and dies under Wayland. |
| Current setup endpoint | Step 1 installs `chromium xserver-xorg xinit x11-xserver-utils unclutter jq`. Step 4 appends `[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && startx ~/kds-kiosk.sh` to `.bash_profile` and drops an Xorg blanking config. Both must change. |
| Existing artifacts that survive Phase 8 | `kds-register.sh` (no X11 deps), `~/.kds-env` (env file), `~/kds-config.json` (device state), the heartbeat path (browser-side), all the v3 URL plumbing. |
| Pi-side state at Phase 8 boundary | The user's current Pi has the v2 X11 setup installed (failed to boot Chromium). Phase 8 walkthrough = re-flash. The merged kds-v3 trunk plus this PR generates the new install path. |
| Pi OS Lite Bookworm defaults | No compositor pre-installed. We install ours from apt. Pi user is in `video` group by default; `render` and `seat` may need adding. |
| Chromium Wayland support | `chromium 1:148.0.7778.167-1~deb13u1+rpt1` (operator's installed version) has Ozone Wayland. Flags: `--ozone-platform=wayland --enable-features=UseOzonePlatform --kiosk`. Pi-specific `rpi-chromium-mods` package present; shouldn't conflict. |

## Design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Compositor = sway, not labwc** | Reversing my initial recommendation. labwc's multi-output rules (window-to-output assignment) are newer and less documented; sway has battle-tested `output … workspace …` semantics from its i3 lineage. Both are wlroots-based + lightweight; the operational difference is sway has better tooling for the "one Chromium per HDMI" requirement. **If you'd rather hold labwc, say so before T1.** |
| D2 | **Per-HDMI Chromium via sway workspaces + `--class` matching** | Two Chromium instances launched with distinct `--class=kds-screen-1` / `kds-screen-2`. Sway config has `assign [app_id="kds-screen-1"] workspace 1` + `workspace 1 output HDMI-A-1`. Each window auto-routes to its output. Survives plug/unplug because sway re-applies rules on output add. |
| D3 | **systemd user service + linger** | `~/.config/systemd/user/kds-kiosk.service` runs sway on boot. `loginctl enable-linger pi` lets user services start at boot without an active login — supersedes the Phase 9 autostart story and eliminates the raspi-config console-autologin prerequisite. |
| D4 | **Per-instance `--user-data-dir`** | Each Chromium gets `/tmp/chromium-1` / `/tmp/chromium-2` so they don't share session state and one crash doesn't cascade. `/tmp` is `tmpfs` so dirs vanish on reboot — desired. |
| D5 | **No persistent Chromium cache** | Keeps `--disk-cache-dir=/dev/null` from the existing script. Pi I/O is cheap; v3 pages re-render fresh each boot. |
| D6 | **Drop X11 packages from install** | Stop installing `xserver-xorg xinit x11-xserver-utils unclutter`. Install `sway seatd libseat1` instead. `unclutter`-style cursor hiding is a sway built-in (`seat * hide_cursor 1000`). |
| D7 | **Single-HDMI fallback is automatic** | Sway only renders workspaces on connected outputs. When HDMI-2 is absent, the slot-2 Chromium has nowhere to render and stays parked in a hidden workspace (no error, no crash). Existing awaiting-page flow handles the "slot 2 unbound" case end-to-end. |
| D8 | **Idempotent re-run** | If the operator re-runs the setup curl, the systemd unit is overwritten, linger is re-enabled (no-op), the `.bash_profile` startx line is removed if present (defensive cleanup), and the X11 blanking conf is removed too. Same setup_code can't be reused (cleared after registration) — that's existing behavior. |
| D9 | **Pi OS Bookworm 64-bit only** | The package set + sway config + Chromium flags are tested against the operator's image. Pi OS Lite Bullseye 32-bit would need different package names and is explicitly out of scope. |

## Task breakdown

### T1 — Sway compositor config + systemd user unit (new files in repo)

**New files:**
- `scripts/pi/sway-config` — sway compositor config: enables both HDMI outputs, assigns workspaces 1/2 per output, app-id matching rules for `kds-screen-1` / `kds-screen-2`, blanking off (`output * dpms on`), cursor hidden, no input handling (no keyboard binds since it's a kiosk).
- `scripts/pi/kds-kiosk.service` — systemd user unit. `ExecStart=sway --config %h/.config/sway/config`. `Restart=on-failure`. `RestartSec=3`. Logs to journal.

**Commit:** `feat(kds-v3-pi): MOK-49/50 T1 — sway config + systemd user unit`

### T2 — Rewrite `scripts/pi/kds-kiosk.sh` for Wayland

Largest task. New shape (approximate):

```bash
#!/bin/bash
set -e

# Source operator env (KDS_API_BASE etc.)
[ -f "$HOME/.kds-env" ] && . "$HOME/.kds-env"

# Variables, log helper, registration check — preserved from Phase 7

# Fetch config from server, fall back to cached on error — preserved

# Resolve per-slot URLs with build_slot_url helper — preserved

# Launch two Chromium instances under Wayland. Sway routes by --class.
CHROMIUM_BASE_FLAGS=(
  --kiosk
  --ozone-platform=wayland
  --enable-features=UseOzonePlatform
  --noerrdialogs
  --disable-infobars
  --disable-session-crashed-bubble
  --disable-restore-session-state
  --no-first-run
  --disk-cache-dir=/dev/null
  --overscroll-history-navigation=0
)

log "Launching Chromium slot 1 → $SCREEN1_URL"
chromium "${CHROMIUM_BASE_FLAGS[@]}" \
  --class=kds-screen-1 \
  --user-data-dir=/tmp/chromium-1 \
  "$SCREEN1_URL" &>/dev/null &
PID1=$!

log "Launching Chromium slot 2 → $SCREEN2_URL"
chromium "${CHROMIUM_BASE_FLAGS[@]}" \
  --class=kds-screen-2 \
  --user-data-dir=/tmp/chromium-2 \
  "$SCREEN2_URL" &>/dev/null &
PID2=$!

wait
```

Key removals: `xset`, `xrandr`, `unclutter`, `DISPLAY=:0.0/:0.1`, chromium binary auto-detection (Bookworm only ships `chromium`). The script is now launched by sway's autostart (which is launched by the systemd unit), not by `startx` from `.bash_profile`.

**Commit:** `feat(kds-v3-pi): MOK-49/50 T2 — Wayland-native kiosk script`

### T3 — Update setup endpoint: new package list + systemd-user install + cleanup

**File:** `src/app/api/kds/setup/[setupCode]/route.ts` (edit Step 1, Step 4)

**Step 1 — install:**
```bash
sudo apt-get install -y -qq sway seatd libseat1 chromium jq
sudo usermod -a -G seat,render,video pi   # idempotent
sudo systemctl enable --now seatd
```

**Step 3.5 — drop the sway config and systemd unit:**
```bash
mkdir -p "$HOME/.config/sway"
curl -sL "${origin}/api/kds/kiosk-script?type=sway-config" > "$HOME/.config/sway/config"
mkdir -p "$HOME/.config/systemd/user"
curl -sL "${origin}/api/kds/kiosk-script?type=systemd-unit" > "$HOME/.config/systemd/user/kds-kiosk.service"
```

**Step 4 — enable + cleanup:**
```bash
# Defensive cleanup of any prior v2-style autostart
sed -i '/kds-kiosk.sh/d' "$HOME/.bash_profile" 2>/dev/null || true
sudo rm -f /etc/X11/xorg.conf.d/10-blanking.conf
# Enable user-service linger so kiosk starts at boot without a console login
sudo loginctl enable-linger pi
# Reload + enable the unit
systemctl --user daemon-reload
systemctl --user enable kds-kiosk.service
```

**Step 5 — guidance**: print "Reboot to start the kiosk. No console autologin needed."

**Commit:** `feat(kds-v3-pi): MOK-49/50 T3 — setup endpoint installs Wayland stack via systemd-user`

### T4 — Extend `/api/kds/kiosk-script` for sway-config + systemd-unit types

**File:** `src/app/api/kds/kiosk-script/route.ts` (edit)

Currently handles `?type=kiosk|register`. Add `?type=sway-config` (serves `scripts/pi/sway-config`) and `?type=systemd-unit` (serves `scripts/pi/kds-kiosk.service`). One-line addition to the switch.

**Commit:** `feat(kds-v3-pi): MOK-49/50 T4 — kiosk-script endpoint serves sway-config + systemd-unit`

### T5 — Operator walkthrough on real hardware + verification report

This is the gate. Since I can't shell into the Pi, the operator has to drive:

1. **Re-flash** the Pi with Pi OS Lite 64-bit Bookworm (latest Imager release).
2. SSH in, revoke + re-add the device in admin, copy the new setup code.
3. `curl -sL http://bigcafe.local-macbook:3000/api/kds/setup/<NEW-CODE> | bash`.
4. **Do not** enable console autologin via raspi-config (we want to confirm linger works without it).
5. `sudo reboot`.
6. Confirm: TV goes from console to black to Chromium kiosk WITHOUT a console login prompt visible after boot.
7. Single-HDMI verification: screen 1 renders v3 page, slot 2 either renders awaiting (if you plug in TV-2) or hides silently.
8. Dual-HDMI verification (if you have a second TV/HDMI): plug it in, reboot, both screens render in parallel.
9. Heartbeat verification: admin device dot turns green within 60s.

Captures all of this into `PHASE-8-VERIFICATION.md` as we go.

**Commit:** `verify(kds-v3-pi): MOK-49/50 T5 — phase 8 walkthrough + verification`

### T6 — Open PR against `kds-v3`

PR body references both MOK-49 and MOK-50 for issue auto-close.

## Acceptance criteria (collapsed from MOK-49 + MOK-50)

| Acceptance | Met by |
|---|---|
| Pi boots straight to Chromium kiosk without console login | T3 (systemd-user + linger) + T1 (systemd unit) |
| Both HDMI outputs drive their bound v3 URLs in parallel | T1 (sway workspace-per-output) + T2 (per-slot --class) |
| Single-HDMI install still works (slot 2 hides) | T1 + D7 (sway-no-output-no-render) |
| Awaiting page renders for unbound slots | Phase 7 (already merged) + T2 (no changes to URL logic) |
| Heartbeats reach admin from both Chromium instances | Phase 7 + browser-side `KDSHeartbeat` |
| Re-run setup curl is idempotent | T3 D8 |
| No X11 packages remaining required at runtime | T3 (sway/seatd swap) |

## Risks / open questions

- **R1 — Sway output naming on Pi.** Outputs are typically `HDMI-A-1` and `HDMI-A-2` on Pi OS Bookworm wlroots; need to confirm during T5. If they differ, the sway config workspace assignment lines need adjustment. Fallback: use `swaymsg -t get_outputs` during install to discover and substitute.
- **R2 — `seatd` vs `polkit`.** Wayland compositors need seat management. On Pi OS Bookworm Lite, `seatd` is the lightweight path. If the operator's image has `elogind` instead, the config could differ. We install seatd explicitly.
- **R3 — Chromium GBM on Pi 5.** Pi 5 uses `vc4-kms-v3d` KMS. Chromium-Ozone-Wayland should work, but GPU acceleration may need `--use-gl=angle` or `--use-gl=desktop` to be smooth. Plan B is to fall back to `--disable-gpu` and accept CPU rendering — fine for static KDS displays.
- **R4 — Sway needs `XDG_RUNTIME_DIR`.** The systemd user unit must set this. Bookworm systemd-user typically does so by default, but worth confirming.
- **R5 — `loginctl enable-linger pi` may need root.** Wrapping it in `sudo` in the install script handles this. Existing `sudo apt-get install` already prompts for password, so by this step the sudo cache is warm.
- **R6 — Idempotency of re-run.** Listed under D8. Defensive cleanup of `.bash_profile` and the X11 blanking conf are best-effort; failures fall back to `|| true` so the install still completes.

## Rollback

No DB or app-side data changes — pure Pi-side install behavior. To roll back: revert the PR. Existing installs continue running (with broken Chromium under X11, which is what was happening anyway).

## Out of scope (later)

- **Phase 10 (MOK-164)** — documentation refresh covering the new install steps, sway prerequisites, dual-HDMI verification checklist.
- **Production deploy** — won't happen until the full `kds-v3 → staging` PR at end of project.
- **Single Pi driving > 2 HDMI outputs** — Pi 5 max is 2, so this is a hardware bound, not a software gap.
