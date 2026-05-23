#!/bin/bash
# KDS Kiosk Launcher for Raspberry Pi
# Runs on boot via .bash_profile → startx
#
# MOK-163 (KDS Pi Deployment phase 7) — v3-aware:
#   - Reads screen_1_url / screen_2_url from the v3 config endpoint
#   - Per-slot independent: each HDMI output goes to its bound URL OR the
#     awaiting page if unbound (no Chromium navigation to `${API_BASE}null`)
#   - Appends ?token=$AUTH_TOKEN on every Chromium URL — the v3 page reads it
#     from the searchParam since the kiosk doesn't go through the browser
#     for the /api/kds/register step that would otherwise set the cookie
#   - Heartbeats are sent browser-side by KDSHeartbeat (both the v3 page and
#     the awaiting page mount it), so this script doesn't do its own loop
#
# Boot sequence:
#   1. Check if device is registered (kds-config.json has auth_token)
#   2. If not: attempt registration with setup_code, or launch browser to
#      setup page for manual code entry
#   3. If yes: fetch latest config from server, launch one Chromium per
#      connected HDMI output (bound URL or awaiting URL)

set -e

CONFIG_FILE="$HOME/kds-config.json"
REGISTER_SCRIPT="$HOME/kds-register.sh"
API_BASE="${KDS_API_BASE:-https://cafepulse.com}"
LOG_FILE="$HOME/kds-kiosk.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

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
    # Launch Chromium to the setup page for manual code entry
    xset s off 2>/dev/null || true
    xset -dpms 2>/dev/null || true
    xset s noblank 2>/dev/null || true
    unclutter -idle 0.5 -root &>/dev/null &

    chromium \
      --kiosk \
      --noerrdialogs \
      --disable-infobars \
      --disable-session-crashed-bubble \
      --disable-restore-session-state \
      "${API_BASE}/kds/setup" 2>/dev/null
    exit 0
  fi
fi

# ─── Fetch Latest Config ──────────────────────────────────────────────────────

DEVICE_ID=$(jq -r '.device_id' "$CONFIG_FILE")
AUTH_TOKEN=$(jq -r '.auth_token' "$CONFIG_FILE")

log "Device $DEVICE_ID registered. Fetching latest config..."

LATEST=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "${API_BASE}/api/kds/device/${DEVICE_ID}/config" 2>/dev/null)

HTTP_CODE=$(echo "$LATEST" | tail -1)
BODY=$(echo "$LATEST" | sed '$d')

# Prefer server response; fall back to cached config on any error so a
# transient network blip doesn't black out the display on boot.
if [ "$HTTP_CODE" = "200" ]; then
  SOURCE_JSON="$BODY"
else
  log "Warning: Could not fetch latest config (HTTP $HTTP_CODE). Using cached config."
  SOURCE_JSON=$(cat "$CONFIG_FILE")
fi

# ─── Resolve Per-Slot URLs ────────────────────────────────────────────────────
#
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

# ─── Display Setup ────────────────────────────────────────────────────────────

# Disable screen blanking
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Hide cursor
unclutter -idle 0.5 -root &>/dev/null &

# ─── Launch Chromium per HDMI Output ──────────────────────────────────────────

# Detect chromium binary (newer Pi OS uses 'chromium', older uses 'chromium-browser')
if command -v chromium &>/dev/null; then
  CHROMIUM=chromium
elif command -v chromium-browser &>/dev/null; then
  CHROMIUM=chromium-browser
else
  log "Error: No Chromium browser found. Install with: sudo apt install chromium"
  exit 1
fi

CHROMIUM_FLAGS=(
  --kiosk
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

log "Launching Chromium on HDMI-1..."
DISPLAY=:0.0 $CHROMIUM "${CHROMIUM_FLAGS[@]}" "$SCREEN1_URL" &>/dev/null &
PID1=$!

# Check if second display is connected (X11-era detection — Phase 8 will
# replace with Wayland-aware compositor logic).
if xrandr 2>/dev/null | grep -q "HDMI-2 connected"; then
  log "Launching Chromium on HDMI-2..."
  DISPLAY=:0.1 $CHROMIUM "${CHROMIUM_FLAGS[@]}" "$SCREEN2_URL" &>/dev/null &
  PID2=$!
  log "Dual display active. PIDs: $PID1, $PID2"
else
  log "Single display mode. PID: $PID1"
  log "Tip: Connect a second TV via HDMI-2 and reboot for dual display."
fi

# Wait for Chromium to exit (keeps the script running)
wait
