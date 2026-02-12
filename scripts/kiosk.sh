#!/bin/bash
# KDS Kiosk Launcher for Raspberry Pi
# Usage: ./kiosk.sh [drinks|food] [warm|dark|wps]
#
# Launches Chromium in kiosk mode pointing to the KDS display.
# Disables screen blanking and hides the cursor.

SCREEN="${1:-drinks}"
THEME="${2:-warm}"
BASE_URL="${KDS_BASE_URL:-http://localhost:3000}"

# Validate screen
if [[ "$SCREEN" != "drinks" && "$SCREEN" != "food" ]]; then
  echo "Error: Screen must be 'drinks' or 'food'"
  echo "Usage: $0 [drinks|food] [warm|dark|wps]"
  exit 1
fi

# Validate theme
if [[ "$THEME" != "warm" && "$THEME" != "dark" && "$THEME" != "wps" ]]; then
  echo "Error: Theme must be 'warm', 'dark', or 'wps'"
  echo "Usage: $0 [drinks|food] [warm|dark|wps]"
  exit 1
fi

URL="${BASE_URL}/admin/kds/${SCREEN}?theme=${THEME}"

echo "Starting KDS kiosk mode..."
echo "  Screen: ${SCREEN}"
echo "  Theme:  ${THEME}"
echo "  URL:    ${URL}"

# Disable screen blanking (Linux/X11)
if command -v xset &> /dev/null; then
  xset s off
  xset -dpms
  xset s noblank
fi

# Hide cursor (requires unclutter)
if command -v unclutter &> /dev/null; then
  unclutter -idle 0.5 -root &
fi

# Launch Chromium in kiosk mode
if command -v chromium-browser &> /dev/null; then
  chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --incognito \
    "$URL"
elif command -v chromium &> /dev/null; then
  chromium \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --incognito \
    "$URL"
elif command -v google-chrome &> /dev/null; then
  google-chrome \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --incognito \
    "$URL"
else
  echo "Error: No supported browser found (chromium-browser, chromium, or google-chrome)"
  echo "Opening URL in default browser..."
  if command -v xdg-open &> /dev/null; then
    xdg-open "$URL"
  elif command -v open &> /dev/null; then
    open "$URL"
  fi
fi
