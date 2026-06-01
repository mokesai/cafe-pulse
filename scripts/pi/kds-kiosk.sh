#!/bin/bash
# KDS Kiosk Launcher — Wayland edition (MOK-49 / MOK-50, Phase 8).
#
# Runs INSIDE the sway compositor (via `exec /home/pi/kds-kiosk.sh` in
# ~/.config/sway/config). Sway is itself launched by the systemd user
# service (~/.config/systemd/user/kds-kiosk.service), which runs at boot
# without a console login thanks to `loginctl enable-linger pi`.
#
# Per-HDMI Chromium routing:
#   - Each Chromium instance is launched with --class=kds-screen-{1,2}.
#   - Sway's assign rules (in sway-config) route windows by app_id to
#     workspace 1 / 2, which are pinned to HDMI-A-1 / HDMI-A-2.
#   - Single-HDMI fallback: when HDMI-A-2 is absent, workspace 2 has
#     nowhere to render and Chromium-2 quietly stays in a hidden state.
#     No xrandr-style detection logic needed here.
#
# Boot sequence:
#   1. Check if device is registered (kds-config.json has auth_token).
#   2. If not: attempt registration with setup_code, or open Chromium to
#      the setup page for manual code entry.
#   3. If yes: fetch latest config from server, launch two Chromium
#      instances (one per slot) — bound URL or awaiting URL each.

set -e

# MOK-167 — source operator-configured env (KDS_API_BASE, etc.).
# shellcheck source=/dev/null
[ -f "$HOME/.kds-env" ] && . "$HOME/.kds-env"

CONFIG_FILE="$HOME/kds-config.json"
REGISTER_SCRIPT="$HOME/kds-register.sh"
API_BASE="${KDS_API_BASE:-https://cafepulse.com}"
LOG_FILE="$HOME/kds-kiosk.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# ─── Chromium flag set (shared across slots) ──────────────────────────────────
#
# Wayland flags: --ozone-platform=wayland + UseOzonePlatform tell Chromium
# to render natively under sway. No DISPLAY/XAUTHORITY needed.
CHROMIUM_BASE_FLAGS=(
  --kiosk
  --ozone-platform=wayland
  --enable-features=UseOzonePlatform
  --noerrdialogs
  --disable-infobars
  --disable-session-crashed-bubble
  --disable-restore-session-state
  --disable-translate
  --no-first-run
  --fast
  --fast-start
  --disable-features=TranslateUI
  --disk-cache-dir=/dev/null
  --overscroll-history-navigation=0
  --disable-pinch
)

# ─── Registration Check ───────────────────────────────────────────────────────

if [ ! -f "$CONFIG_FILE" ] || [ "$(jq -r '.auth_token // empty' "$CONFIG_FILE" 2>/dev/null)" = "" ]; then
  log "Device not registered. Checking for setup code..."

  SETUP_CODE=$(jq -r '.setup_code // empty' "$CONFIG_FILE" 2>/dev/null)

  if [ -n "$SETUP_CODE" ]; then
    log "Found setup code: $SETUP_CODE — registering..."
    if bash "$REGISTER_SCRIPT" "$SETUP_CODE" "$API_BASE"; then
      log "Registration successful. Restarting kiosk..."
      exec bash "$0"  # Restart this script
    else
      log "Registration failed. Will retry on next boot."
      exit 1
    fi
  else
    log "No setup code found. Launching browser for manual registration..."
    # Single Chromium instance pinned to slot 1's app_id so sway routes it
    # to the primary TV. No need for two windows in this branch.
    chromium "${CHROMIUM_BASE_FLAGS[@]}" \
      --class=kds-screen-1 \
      --user-data-dir=/tmp/chromium-1 \
      "${API_BASE}/kds/setup" 2>/dev/null
    exit 0
  fi
fi

# ─── Fetch Latest Config ──────────────────────────────────────────────────────

DEVICE_ID=$(jq -r '.device_id' "$CONFIG_FILE")
AUTH_TOKEN=$(jq -r '.auth_token' "$CONFIG_FILE")

log "Device $DEVICE_ID registered. Fetching latest config..."

# Retry the config fetch — at boot, greetd starts sway before the network
# is fully up. curl's exit code (6 DNS, 7 connect refused, 28 timeout)
# would otherwise trip set -e and kill the script silently, leaving the
# kiosk blank. Use a short loop with backoff; total ~30s of patience.
# `set +e` around the curl so a temporary failure doesn't propagate.
HTTP_CODE=""
BODY=""
RETRY=0
MAX_RETRIES=10
while [ "$RETRY" -lt "$MAX_RETRIES" ]; do
  set +e
  LATEST=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    "${API_BASE}/api/kds/device/${DEVICE_ID}/config" 2>/dev/null)
  CURL_EXIT=$?
  set -e
  if [ "$CURL_EXIT" = "0" ]; then
    HTTP_CODE=$(echo "$LATEST" | tail -1)
    BODY=$(echo "$LATEST" | sed '$d')
    break
  fi
  RETRY=$((RETRY + 1))
  log "Network not ready (curl exit $CURL_EXIT). Retry $RETRY/$MAX_RETRIES in 3s..."
  sleep 3
done

# Prefer server response; fall back to cached config on any error so a
# persistent network blip doesn't black out the displays. The awaiting
# pages and v3 pages both auto-refresh, so transient outages recover
# without operator intervention once the network comes back.
if [ "$HTTP_CODE" = "200" ]; then
  SOURCE_JSON="$BODY"
elif [ -n "$HTTP_CODE" ]; then
  log "Warning: Could not fetch latest config (HTTP $HTTP_CODE). Using cached config."
  SOURCE_JSON=$(cat "$CONFIG_FILE")
else
  log "Warning: Could not reach $API_BASE after $MAX_RETRIES retries. Using cached config."
  SOURCE_JSON=$(cat "$CONFIG_FILE")
fi

# ─── Resolve Per-Slot URLs ────────────────────────────────────────────────────
# `// empty` ensures jq emits an empty string (not "null") when the column
# is unbound, so the [-z] guards work correctly.
SCREEN1_PATH=$(echo "$SOURCE_JSON" | jq -r '.screen_1_url // empty')
SCREEN2_PATH=$(echo "$SOURCE_JSON" | jq -r '.screen_2_url // empty')

# URL-encode the token (alnum hex is safe but encodeURI-equivalent for
# defense in depth).
ENC_TOKEN=$(printf '%s' "$AUTH_TOKEN" | jq -sRr @uri)

build_slot_url() {
  local slot="$1"
  local path="$2"
  if [ -n "$path" ]; then
    echo "${API_BASE}${path}?token=${ENC_TOKEN}"
  else
    echo "${API_BASE}/kds/awaiting/${DEVICE_ID}/${slot}?token=${ENC_TOKEN}"
  fi
}

SCREEN1_URL=$(build_slot_url 1 "$SCREEN1_PATH")
SCREEN2_URL=$(build_slot_url 2 "$SCREEN2_PATH")

log "Screen 1: ${SCREEN1_PATH:-(unassigned — awaiting page)} → $SCREEN1_URL"
log "Screen 2: ${SCREEN2_PATH:-(unassigned — awaiting page)} → $SCREEN2_URL"

# ─── Launch Chromium per HDMI Output ──────────────────────────────────────────
#
# Two instances, one per slot. Sway routes by --class app_id to the
# pinned workspace. /tmp is tmpfs so the per-instance user-data-dirs
# disappear on reboot — desired (no stale state, no cache buildup).

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

log "Chromium instances live. PIDs: $PID1, $PID2"
log "Tip: only the slots whose HDMI outputs are connected will actually render."

# Wait for either to exit. If one crashes, the systemd unit's
# Restart=on-failure brings sway back up, which re-execs this script.
wait
