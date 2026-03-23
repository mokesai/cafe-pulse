#!/bin/bash
# KDS Device Registration Script
# Usage: ./kds-register.sh <SETUP_CODE> [API_BASE_URL]
#
# Registers this Pi with the Cafe Pulse KDS system using a setup code.
# Writes device config (device_id, auth_token, URLs) to ~/kds-config.json.

set -e

SETUP_CODE="$1"
API_BASE="${2:-https://cafepulse.com}"
CONFIG_FILE="$HOME/kds-config.json"

if [ -z "$SETUP_CODE" ]; then
  echo "Usage: $0 <SETUP_CODE> [API_BASE_URL]"
  echo "  SETUP_CODE: The code shown in the admin UI (e.g., BIGCAFE-7X4K)"
  echo "  API_BASE_URL: Optional. Defaults to https://cafepulse.com"
  exit 1
fi

echo "═══════════════════════════════════════════"
echo "  KDS Device Registration"
echo "═══════════════════════════════════════════"
echo ""
echo "  Setup Code: $SETUP_CODE"
echo "  API:        $API_BASE"
echo ""

# Call registration API
echo "Registering device..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/api/kds/register" \
  -H "Content-Type: application/json" \
  -d "{\"setup_code\": \"$SETUP_CODE\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  ERROR=$(echo "$BODY" | jq -r '.error // "Unknown error"' 2>/dev/null || echo "HTTP $HTTP_CODE")
  echo "✗ Registration failed: $ERROR"
  exit 1
fi

# Validate response has required fields
DEVICE_ID=$(echo "$BODY" | jq -r '.device_id')
AUTH_TOKEN=$(echo "$BODY" | jq -r '.auth_token')

if [ -z "$DEVICE_ID" ] || [ "$DEVICE_ID" = "null" ]; then
  echo "✗ Invalid response from API"
  exit 1
fi

# Write config file
echo "$BODY" | jq '.' > "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

echo "✓ Device registered successfully!"
echo ""
echo "  Device ID:  $DEVICE_ID"
echo "  Screen 1:   $(echo "$BODY" | jq -r '.screen_1')"
echo "  Screen 2:   $(echo "$BODY" | jq -r '.screen_2')"
echo "  Config:     $CONFIG_FILE"
echo ""
