#!/bin/bash
# KDS Kiosk Launcher for Raspberry Pi
# Runs on boot via .bash_profile → startx
#
# Boot sequence:
#   1. Check if device is registered (kds-config.json has auth_token)
#   2. If not: attempt registration with setup_code, or launch browser to setup page
#   3. If yes: fetch latest config, launch dual Chromium kiosk windows

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

    chromium-browser \
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

if [ "$HTTP_CODE" = "200" ]; then
  # Update screen URLs if assignments changed
  NEW_S1=$(echo "$BODY" | jq -r '.screen_1_url // empty')
  NEW_S2=$(echo "$BODY" | jq -r '.screen_2_url // empty')
  if [ -n "$NEW_S1" ]; then
    jq --arg s1 "$NEW_S1" --arg s2 "$NEW_S2" \
      '.screen_1_url = $s1 | .screen_2_url = $s2' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" \
      && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    log "Config updated from server."
  fi
else
  log "Warning: Could not fetch latest config (HTTP $HTTP_CODE). Using cached config."
fi

# ─── Read Display URLs ────────────────────────────────────────────────────────

SCREEN1_URL="${API_BASE}$(jq -r '.screen_1_url' "$CONFIG_FILE")"
SCREEN2_URL="${API_BASE}$(jq -r '.screen_2_url' "$CONFIG_FILE")"

log "Screen 1: $SCREEN1_URL"
log "Screen 2: $SCREEN2_URL"

# ─── Display Setup ────────────────────────────────────────────────────────────

# Disable screen blanking
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Hide cursor
unclutter -idle 0.5 -root &>/dev/null &

# ─── Launch Dual Chromium ─────────────────────────────────────────────────────

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
DISPLAY=:0.0 chromium-browser "${CHROMIUM_FLAGS[@]}" "$SCREEN1_URL" &>/dev/null &
PID1=$!

# Check if second display is connected
if xrandr 2>/dev/null | grep -q "HDMI-2 connected"; then
  log "Launching Chromium on HDMI-2..."
  DISPLAY=:0.1 chromium-browser "${CHROMIUM_FLAGS[@]}" "$SCREEN2_URL" &>/dev/null &
  PID2=$!
  log "Dual display active. PIDs: $PID1, $PID2"
else
  log "Single display mode. PID: $PID1"
  log "Tip: Connect a second TV via HDMI-2 and reboot for dual display."
fi

# Wait for Chromium to exit (keeps the script running)
wait
