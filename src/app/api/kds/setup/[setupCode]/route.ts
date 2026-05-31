import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getRequestOrigin } from '@/lib/http/request-origin'

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

  // MOK-166 — read from Host header so the dev-server origin (e.g.
  // bigcafe.local-macbook:3000) propagates into the generated bash. Falls
  // back to nextUrl.origin when there's no Host header.
  const origin = getRequestOrigin(request)

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
    '# MOK-49/50 (phase 8) — Wayland kiosk stack:',
    '#   - sway: the compositor',
    '#   - greetd: the system-level display manager that launches sway',
    '#     with a real PAM session (the systemd-user+linger path was',
    '#     verified to not work — sway exits with status 1, no logs,',
    '#     because there is no seat to claim).',
    '#   - seatd, libseat1: kept for parity with manual sway runs during',
    "#     debugging; greetd's session uses logind for actual seat",
    '#     management.',
    '#   - foot: break-glass terminal bound to Mod4+Return in the sway',
    '#     config for on-Pi debugging.',
    'echo "[1/5] Installing packages..."',
    'sudo apt-get update -qq',
    'sudo apt-get install -y -qq chromium sway greetd seatd libseat1 foot jq > /dev/null 2>&1 || true',
    '# Pi user needs membership in `video`, `render`, and `seat` to open',
    '# DRM nodes. `video` is the default; the others may not be.',
    "sudo usermod -a -G video,render,seat pi 2>/dev/null || true",
    '# Ensure seatd is up so manual sway debugging works.',
    'sudo systemctl enable --now seatd 2>/dev/null || true',
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
    '# MOK-167 — Persist the dev/prod origin so the kiosk script uses the',
    '# same API base on boot as the setup just used. The kiosk script sources',
    '# ~/.kds-env before reading KDS_API_BASE, so this single line keeps the',
    "# Pi pointing at whichever origin the operator's setup ran against.",
    '# Overwrites unconditionally so re-running with a different origin updates cleanly.',
    `echo 'export KDS_API_BASE="${origin}"' > "$HOME/.kds-env"`,
    'chmod 600 "$HOME/.kds-env"',
    '',
    '# Step 4: Configure auto-start',
    '# MOK-49/50 (phase 8) — greetd display manager launches sway at boot',
    "# with a real PAM session, so seatd/logind can grant a seat and sway",
    "# can actually draw to HDMI. greetd's packaged systemd unit has",
    '# Conflicts=getty@tty1.service, so getty disables itself when greetd',
    '# starts — no console login prompt to fight with.',
    'echo "[4/5] Configuring auto-start..."',
    '',
    '# Install the sway compositor config (in the pi user\'s home).',
    'mkdir -p "$HOME/.config/sway"',
    `curl -sL "${origin}/api/kds/kiosk-script?type=sway-config" > "$HOME/.config/sway/config"`,
    '',
    '# Install the greetd display-manager config (system-wide).',
    'sudo mkdir -p /etc/greetd',
    `curl -sL "${origin}/api/kds/kiosk-script?type=greetd-config" | sudo tee /etc/greetd/config.toml > /dev/null`,
    '',
    '# Defensive cleanup of any prior install attempt:',
    '#   - v2 X11 path: .bash_profile startx line + Xorg blanking config',
    '#   - earlier Phase 8 attempt: systemd-user unit + linger (replaced',
    '#     by greetd; if left, the user unit would harmlessly restart-loop',
    '#     trying to acquire a seat that greetd already owns).',
    'sed -i \'/kds-kiosk.sh/d\' "$HOME/.bash_profile" 2>/dev/null || true',
    'sudo rm -f /etc/X11/xorg.conf.d/10-blanking.conf',
    'systemctl --user disable kds-kiosk.service 2>/dev/null || true',
    'rm -f "$HOME/.config/systemd/user/kds-kiosk.service"',
    'sudo loginctl disable-linger pi 2>/dev/null || true',
    '',
    '# Two gotchas on Pi OS Lite Bookworm that the bare `enable greetd`',
    '# command misses (verified hands-on 2026-05-31):',
    "#   1) greetd's packaged unit is WantedBy=graphical.target, but Pi OS",
    '#      Lite defaults to multi-user.target — so greetd never activates',
    '#      at boot. Switch the default target so it does.',
    "#   2) greetd's packaged unit has Conflicts=getty@tty7.service (the",
    '#      legacy X11 VT), but our greetd-config.toml uses vt=1 (where',
    "#      the TV defaults). Mask getty@tty1 so greetd doesn't fight",
    '#      agetty for VT-1 ownership.',
    'sudo systemctl set-default graphical.target',
    'sudo systemctl mask getty@tty1.service',
    '',
    '# Enable greetd. It is a system service, so this needs sudo.',
    'sudo systemctl enable greetd.service',
    '',
    'echo "  Done: Auto-start configured (greetd → sway)"',
    '',
    '# Step 5: Done',
    'echo "[5/5] Setup complete!"',
    'echo ""',
    'echo "==========================================="',
    'echo "  KDS setup complete!"',
    'echo ""',
    'echo "  Device ID: $DEVICE_ID"',
    // MOK-163 (phase 7) — v3-aware: print the screen_*_url path (or an
    // explicit '(unassigned)' marker), not the legacy 'drinks'/'food' text.
    'S1=$(jq -r \'.screen_1_url // empty\' "$CONFIG_FILE")',
    'S2=$(jq -r \'.screen_2_url // empty\' "$CONFIG_FILE")',
    'echo "  Screen 1:  ${S1:-(unassigned — bind in admin)}"',
    'echo "  Screen 2:  ${S2:-(unassigned — bind in admin)}"',
    'echo ""',
    'echo "  Reboot to start displaying KDS screens:"',
    'echo "    sudo reboot"',
    'echo ""',
    "# MOK-49/50 (phase 8) — console autologin is no longer required;",
    '# systemd-user linger starts the kiosk at boot. Mention this so the',
    "# operator doesn't run raspi-config out of habit.",
    'echo "  Note: No console autologin needed — systemd-user linger"',
    'echo "        starts the kiosk automatically on boot."',
    'echo "==========================================="',
    'echo ""',
    // When this script is run via `curl … | bash`, stdin is the script
    // body itself. A bare `read -n 1` would consume the next line's first
    // char (the `e` from `echo`) and bash then complains about `cho:
    // command not found`. Redirecting from /dev/tty reads from the
    // operator's terminal instead. If there's no controlling tty (rare
    // for the install flow) the `|| true` keeps `set -e` from killing
    // an otherwise-successful install.
    'read -p "  Reboot now? [y/N] " -n 1 -r </dev/tty || true',
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
