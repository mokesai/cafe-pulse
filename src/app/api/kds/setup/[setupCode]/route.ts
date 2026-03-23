import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * GET /api/kds/setup/:setupCode
 * Returns a bash script that installs and configures the KDS kiosk on a Raspberry Pi.
 * Usage: curl -sL https://cafepulse.com/api/kds/setup/BIGCAFE-7X4K | bash
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ setupCode: string }> }
) {
  const { setupCode } = await params

  // Validate the setup code exists
  const supabase = createServiceClient()
  const { data: device } = await supabase
    .from('kds_devices')
    .select('id, status, setup_code_expires_at')
    .eq('setup_code', setupCode)
    .maybeSingle()

  if (!device) {
    return new NextResponse('echo "Error: Invalid setup code."\nexit 1\n', {
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  if (device.status === 'registered') {
    return new NextResponse('echo "Error: This setup code has already been used."\nexit 1\n', {
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  if (device.setup_code_expires_at && new Date(device.setup_code_expires_at) < new Date()) {
    return new NextResponse('echo "Error: This setup code has expired."\nexit 1\n', {
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const origin = request.nextUrl.origin

  // Build script as array of lines to avoid template literal / bash variable collision
  const lines = [
    '#!/bin/bash',
    '# Cafe Pulse KDS — Raspberry Pi Setup Script',
    `# Setup Code: ${setupCode}`,
    `# Run with: curl -sL ${origin}/api/kds/setup/${setupCode} | bash`,
    '',
    'set -e',
    '',
    `API_BASE="${origin}"`,
    `SETUP_CODE="${setupCode}"`,
    'CONFIG_FILE="$HOME/kds-config.json"',
    '',
    'echo ""',
    'echo "==========================================="',
    'echo "  Cafe Pulse KDS Setup"',
    'echo "==========================================="',
    'echo ""',
    '',
    '# Step 1: Install packages',
    'echo "[1/5] Installing packages..."',
    'sudo apt-get update -qq',
    'sudo apt-get install -y -qq chromium xserver-xorg xinit x11-xserver-utils unclutter jq > /dev/null 2>&1 || true',
    'echo "  Done: Packages installed"',
    '',
    '# Step 2: Register device',
    'echo "[2/5] Registering device..."',
    'RESPONSE=$(curl -s -w "\\n%{http_code}" -X POST "$API_BASE/api/kds/register" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d "{\\"setup_code\\": \\"$SETUP_CODE\\"}")',
    '',
    'HTTP_CODE=$(echo "$RESPONSE" | tail -1)',
    'BODY=$(echo "$RESPONSE" | sed \'$d\')',
    '',
    'if [ "$HTTP_CODE" != "200" ]; then',
    '  ERROR=$(echo "$BODY" | jq -r \'.error // "Unknown error"\' 2>/dev/null || echo "HTTP $HTTP_CODE")',
    '  echo "  FAILED: Registration failed: $ERROR"',
    '  exit 1',
    'fi',
    '',
    'echo "$BODY" | jq \'.\' > "$CONFIG_FILE"',
    'chmod 600 "$CONFIG_FILE"',
    'DEVICE_ID=$(echo "$BODY" | jq -r \'.device_id\')',
    'echo "  Done: Device registered: $DEVICE_ID"',
    '',
    '# Step 3: Create kiosk scripts',
    'echo "[3/5] Creating kiosk scripts..."',
    '',
    `curl -sL "${origin}/api/kds/kiosk-script?type=register" > "$HOME/kds-register.sh"`,
    'chmod +x "$HOME/kds-register.sh"',
    '',
    `curl -sL "${origin}/api/kds/kiosk-script?type=kiosk" > "$HOME/kds-kiosk.sh"`,
    'chmod +x "$HOME/kds-kiosk.sh"',
    '',
    'echo "  Done: Scripts created"',
    '',
    '# Step 4: Configure auto-start',
    'echo "[4/5] Configuring auto-start..."',
    '',
    'AUTOSTART=\'[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && startx ~/kds-kiosk.sh\'',
    'if ! grep -q "kds-kiosk.sh" "$HOME/.bash_profile" 2>/dev/null; then',
    '  echo "$AUTOSTART" >> "$HOME/.bash_profile"',
    'fi',
    '',
    'sudo mkdir -p /etc/X11/xorg.conf.d',
    'cat << \'XCONF\' | sudo tee /etc/X11/xorg.conf.d/10-blanking.conf > /dev/null',
    'Section "ServerFlags"',
    '    Option "BlankTime" "0"',
    '    Option "StandbyTime" "0"',
    '    Option "SuspendTime" "0"',
    '    Option "OffTime" "0"',
    'EndSection',
    'XCONF',
    '',
    'echo "  Done: Auto-start configured"',
    '',
    '# Step 5: Done',
    'echo "[5/5] Setup complete!"',
    'echo ""',
    'echo "==========================================="',
    'echo "  KDS setup complete!"',
    'echo ""',
    'echo "  Device ID: $DEVICE_ID"',
    'echo "  Screen 1:  $(jq -r \'.screen_1\' "$CONFIG_FILE")"',
    'echo "  Screen 2:  $(jq -r \'.screen_2\' "$CONFIG_FILE")"',
    'echo ""',
    'echo "  Reboot to start displaying KDS screens:"',
    'echo "    sudo reboot"',
    'echo "==========================================="',
    'echo ""',
    'read -p "  Reboot now? [y/N] " -n 1 -r',
    'echo',
    'if [[ $REPLY =~ ^[Yy]$ ]]; then',
    '  sudo reboot',
    'fi',
  ]

  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
    },
  })
}
