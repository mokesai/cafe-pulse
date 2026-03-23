# KDS Raspberry Pi Self-Service Deployment — Design Document

## Date: 2026-03-22

## Status: Approved for implementation

---

## 1. Understanding Summary

- **What:** A self-service Raspberry Pi deployment flow integrated into `/admin/kds-config`, enabling non-technical tenant admins to deploy KDS screens to TVs without developer assistance
- **Why:** Current deployment requires SSH, command-line, and developer involvement — blocking tenant self-service onboarding
- **Who:** Cafe managers / tenant admins with no technical background
- **Architecture:** Pi runs only Chromium in kiosk mode → points to Vercel-hosted app → fetches data from Supabase. No local app server on the Pi.
- **Device model:** 1 Pi per location with dual HDMI outputs driving 2 TV screens (drinks + food). Device registers via a setup code, receives a bearer token, and sends 60-second heartbeats.
- **Three provisioning options:** Pre-built SD card image (Mokesai-maintained), downloadable setup script, or step-by-step guided instructions. WiFi can be pre-configured in the download or via Raspberry Pi Imager.
- **Scope:** MVP targets 10-50 tenants. Status-only remote monitoring (online/offline). Content updates are automatic via existing auto-refresh. Offline behavior shows last content with an indicator.

---

## 2. Assumptions

- Vercel is the only production hosting target
- One Pi per tenant location (not multiple Pis per location)
- The Pi has reliable power (no UPS/battery concerns)
- Tenant admin has access to a computer to flash the SD card
- The tenant's WiFi network allows outbound HTTPS to Vercel and Supabase
- The KDS display route lives outside `/admin/` (e.g., `/kds/display/:deviceId/:screen`) — no admin auth required
- The SD card image is based on Raspberry Pi OS Lite (64-bit, Bookworm)
- Chromium auto-updates on Raspberry Pi OS, so the image rarely needs rebuilding

---

## 3. Data Model

### Table: `kds_devices`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Device ID |
| `tenant_id` | uuid (FK → tenants) | Owner tenant |
| `name` | text | Admin-friendly name (e.g., "Front Counter Pi") |
| `setup_code` | text (unique) | Short registration code (e.g., "BIGCAFE-7X4K") |
| `setup_code_expires_at` | timestamptz | Code expiration (24 hours after generation) |
| `auth_token` | text | Hashed bearer token — the Pi stores the plaintext |
| `status` | text | "pending", "registered", "offline" |
| `screen_1` | text | Screen assignment for HDMI 1 (e.g., "drinks") |
| `screen_2` | text | Screen assignment for HDMI 2 (e.g., "food") |
| `last_heartbeat_at` | timestamptz | Last ping received |
| `ip_address` | text | Reported IP from last heartbeat |
| `created_at` | timestamptz | When device record was created |
| `registered_at` | timestamptz | When setup code was redeemed |

**RLS:** Tenant-scoped. Admins can only see/manage their own devices.

**Online/offline threshold:** A device with no heartbeat for 3+ minutes is considered offline. No separate heartbeat log table for MVP — `last_heartbeat_at` on the device row is sufficient.

---

## 4. API Endpoints

All endpoints live outside `/admin/` — no user authentication required. Device endpoints use bearer token auth.

### `POST /api/kds/register`

**Purpose:** Pi redeems a setup code to register itself.

**Request:**
```json
{ "setup_code": "BIGCAFE-7X4K" }
```

**Validation:**
- Code exists in `kds_devices` table
- Code has not expired (`setup_code_expires_at > now`)
- Device status is "pending" (not already registered)

**Response (success):**
```json
{
  "device_id": "uuid",
  "auth_token": "random-64-char-string",
  "screen_1": "drinks",
  "screen_2": "food",
  "screen_1_url": "/kds/display/{device_id}/drinks",
  "screen_2_url": "/kds/display/{device_id}/food",
  "tenant_slug": "bigcafe"
}
```

**Side effects:**
- Sets `status` to "registered"
- Sets `registered_at` to now
- Stores hashed `auth_token`
- Clears `setup_code` (single-use)

### `POST /api/kds/heartbeat`

**Purpose:** Pi sends periodic health ping.

**Headers:** `Authorization: Bearer <auth_token>`

**Request:**
```json
{
  "device_id": "uuid",
  "screen": "drinks",
  "ip_address": "192.168.1.42"
}
```

**Response:**
```json
{ "ok": true, "refresh_interval": 300000 }
```

**Side effects:**
- Updates `last_heartbeat_at` to now
- Updates `ip_address`

### `GET /api/kds/device/:deviceId/config`

**Purpose:** Pi fetches current config on boot (in case screen assignments changed).

**Headers:** `Authorization: Bearer <auth_token>`

**Response:**
```json
{
  "screen_1": "drinks",
  "screen_2": "food",
  "screen_1_url": "/kds/display/{device_id}/drinks",
  "screen_2_url": "/kds/display/{device_id}/food",
  "tenant_slug": "bigcafe",
  "status": "registered"
}
```

### `GET /kds/display/:deviceId/:screen`

**Purpose:** The actual KDS display page rendered on the TV.

**Authentication:** Device `auth_token` validated from cookie (set during registration).

**Behavior:**
- Renders `KDSDynamicScreen` component (same as preview)
- Includes heartbeat JavaScript (`setInterval` every 60 seconds)
- Includes offline detection with visual indicator
- Uses `dynamic = 'force-dynamic'` to prevent stale data

---

## 5. Admin UI Pages

### Page 1: Device Manager (`/admin/kds-config/deploy`)

**Layout:** Table of registered devices.

| Column | Content |
|--------|---------|
| Status | Green dot (online), red dot (offline), gray dot (pending) |
| Name | Admin-friendly device name |
| Screen 1 | "Drinks" or "Food" |
| Screen 2 | "Drinks" or "Food" |
| Last Heartbeat | Relative time (e.g., "2 min ago") |
| IP Address | Reported local IP |
| Actions | Rename, Change Screens, Revoke |

**Online threshold:** Heartbeat within last 3 minutes = green. Otherwise red.

**"Add Device" button** → navigates to the add device wizard.

### Page 2: Add Device Wizard (`/admin/kds-config/deploy/add`)

**Step 1: Name your device**
- Text input: "Give your Pi a name" (e.g., "Front Counter Pi")
- Default suggestion based on tenant name

**Step 2: Assign screens**
- HDMI 1: Dropdown — Drinks / Food
- HDMI 2: Dropdown — Drinks / Food
- Default: HDMI 1 = Drinks, HDMI 2 = Food

**Step 3: Choose setup method**
Three cards, each with an icon and description:

**Card A: SD Card Image (Recommended)**
- Description: "Download a ready-to-flash SD card image. Just flash, insert, and power on."
- WiFi configuration fields appear: SSID (required), Password (required)
- "Download Image" button → generates setup code, injects WiFi + code into image, serves `.img.gz` download
- Below button: estimated file size (~1.5-2 GB) and flash instructions (use Raspberry Pi Imager or balenaEtcher)

**Card B: Setup Script**
- Description: "Already have Raspberry Pi OS installed? Run one command to configure everything."
- Shows a copyable one-liner:
  ```
  curl -sL https://cafepulse.com/setup/BIGCAFE-7X4K | bash
  ```
- Setup code is embedded in the URL
- The script installs Chromium, configures kiosk mode, registers the device, and sets up autostart

**Card C: Manual Setup**
- Description: "Follow step-by-step instructions to set up your Pi manually."
- Expandable sections with numbered steps and copy-paste commands
- Setup code displayed prominently in a large monospace box
- Instructions cover: install packages, create kiosk.sh, configure autostart, run registration

**Step 4: Waiting for registration**
- Shows the setup code in large text
- Animated spinner with "Waiting for your Pi to connect..."
- Polls `/api/kds/device/:id` every 5 seconds
- On success: green checkmark, device name, "Your KDS screens are live!" with links to the display URLs
- Timeout after 24 hours (matches setup code expiration)

---

## 6. Pi-Side Architecture

### File Structure

```
/home/pi/
├── kds-kiosk.sh          # Main launcher — runs on boot
├── kds-config.json        # Written during registration
└── kds-register.sh        # First-boot registration (called by kiosk.sh)
```

### kds-config.json (after registration)

```json
{
  "device_id": "uuid",
  "auth_token": "random-64-char-string",
  "screen_1_url": "https://cafepulse.com/kds/display/{device_id}/drinks",
  "screen_2_url": "https://cafepulse.com/kds/display/{device_id}/food",
  "tenant_slug": "bigcafe",
  "registered_at": "2026-03-22T..."
}
```

### Boot Sequence

```
Power on
  → Auto-login as pi
  → .bash_profile runs kds-kiosk.sh
  → Check: does kds-config.json have auth_token?
    ├── NO (first boot):
    │   → Check: does kds-config.json have setup_code? (from SD image)
    │     ├── YES: Run kds-register.sh with the code (curl → API → writes config)
    │     └── NO: Launch Chromium to /kds/setup for manual code entry
    │   → On success: restart kds-kiosk.sh
    │
    └── YES (normal boot):
        → curl /api/kds/device/:id/config (check for updated screen assignments)
        → Update kds-config.json if assignments changed
        → Disable screen blanking (xset -dpms, xset s off)
        → Hide cursor (unclutter)
        → Launch Chromium instance 1 on HDMI-1 → screen_1_url
        → Launch Chromium instance 2 on HDMI-2 → screen_2_url
```

### kds-kiosk.sh (pseudocode)

```bash
#!/bin/bash
CONFIG="/home/pi/kds-config.json"

# Check registration
if [ ! -f "$CONFIG" ] || [ "$(jq -r .auth_token $CONFIG)" == "null" ]; then
  SETUP_CODE=$(jq -r .setup_code $CONFIG 2>/dev/null)
  if [ -n "$SETUP_CODE" ] && [ "$SETUP_CODE" != "null" ]; then
    /home/pi/kds-register.sh "$SETUP_CODE"
  else
    # Manual registration — launch browser to setup page
    startx chromium-browser --kiosk "https://cafepulse.com/kds/setup"
    exit 0
  fi
fi

# Fetch latest config
DEVICE_ID=$(jq -r .device_id $CONFIG)
AUTH_TOKEN=$(jq -r .auth_token $CONFIG)
# ... curl config endpoint, update URLs if changed ...

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Hide cursor
unclutter -idle 0.5 -root &

# Get display URLs
SCREEN1_URL=$(jq -r .screen_1_url $CONFIG)
SCREEN2_URL=$(jq -r .screen_2_url $CONFIG)

# Launch dual Chromium instances
DISPLAY=:0.0 chromium-browser --kiosk --noerrdialogs \
  --disable-infobars --disable-session-crashed-bubble \
  --disk-cache-dir=/dev/null "$SCREEN1_URL" &

DISPLAY=:0.1 chromium-browser --kiosk --noerrdialogs \
  --disable-infobars --disable-session-crashed-bubble \
  --disk-cache-dir=/dev/null "$SCREEN2_URL" &

wait
```

### kds-register.sh

```bash
#!/bin/bash
SETUP_CODE="$1"
API_URL="https://cafepulse.com/api/kds/register"
CONFIG="/home/pi/kds-config.json"

RESPONSE=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{\"setup_code\": \"$SETUP_CODE\"}")

# Check for error
if echo "$RESPONSE" | jq -e .error > /dev/null 2>&1; then
  echo "Registration failed: $(echo $RESPONSE | jq -r .error)"
  exit 1
fi

# Write config
echo "$RESPONSE" > "$CONFIG"
echo "Device registered successfully."
```

---

## 7. KDS Display Route

### Route: `/kds/display/:deviceId/:screen`

**Server component** that:
1. Reads `auth_token` from cookie
2. Validates against `kds_devices` table (hashed comparison)
3. Looks up tenant from device record
4. Renders `KDSDynamicScreen` with tenant's layout (published, not draft)
5. Injects heartbeat and offline detection JavaScript

### Heartbeat JavaScript (injected into the page)

```javascript
const DEVICE_ID = '{{deviceId}}';
const AUTH_TOKEN = '{{authToken}}';
const HEARTBEAT_URL = '/api/kds/heartbeat';
const SCREEN = '{{screen}}';
let failCount = 0;

setInterval(async () => {
  try {
    const ip = await fetch('https://api.ipify.org?format=json')
      .then(r => r.json()).then(d => d.ip).catch(() => 'unknown');

    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify({ device_id: DEVICE_ID, screen: SCREEN, ip_address: ip })
    });

    failCount = 0;
    document.getElementById('kds-offline-indicator')?.remove();
  } catch {
    failCount++;
    if (failCount >= 2) showOfflineIndicator();
  }
}, 60000);

function showOfflineIndicator() {
  if (document.getElementById('kds-offline-indicator')) return;
  const el = document.createElement('div');
  el.id = 'kds-offline-indicator';
  el.innerHTML = '● Offline';
  el.style.cssText = 'position:fixed;bottom:12px;right:12px;background:rgba(0,0,0,0.6);color:#f87171;padding:6px 12px;border-radius:6px;font-size:14px;z-index:9999;';
  document.body.appendChild(el);
}
```

---

## 8. Offline Behavior

**Detection:** Heartbeat `fetch()` catches network errors. After 2 consecutive failures (2 minutes), offline mode activates.

**Offline mode:**
- Current page content stays visible (DOM untouched — last prices, layout, images all remain)
- Small indicator appears in bottom-right corner: red pulsing dot + "Offline" text
- Muted styling so it doesn't alarm customers

**Recovery:**
- Heartbeat continues attempting every 60 seconds
- On first success: indicator removed, full page refresh triggered to pick up changes

---

## 9. SD Card Image

### Base Image Contents

**OS:** Raspberry Pi OS Lite (64-bit, Bookworm)

**Pre-installed packages:**
- `chromium-browser`
- `xserver-xorg`, `xinit`, `x11-xserver-utils`
- `unclutter`
- `jq`

**Pre-configured:**
- Auto-login as `pi` user
- `.bash_profile` triggers `kds-kiosk.sh`
- Screen blanking and DPMS disabled
- Dual HDMI output enabled in `/boot/config.txt`
- Hostname: `kds-display`
- SSH enabled (for troubleshooting)
- `kds-kiosk.sh`, `kds-register.sh` in `/home/pi/`

### Image Customization at Download

When tenant clicks "Download SD Card Image" in the admin UI:

1. Server generates a setup code and creates the `kds_devices` record
2. Server takes the base `.img.gz` from cloud storage (e.g., Supabase Storage or S3)
3. Server decompresses, mounts the boot partition
4. Injects WiFi config → `wpa_supplicant.conf` in boot partition
5. Injects setup code → `/home/pi/kds-config.json` as `{ "setup_code": "BIGCAFE-7X4K" }`
6. Re-compresses and streams the download to the tenant

**Image size:** ~1.5-2 GB compressed

**Tenant steps after download:**
1. Flash to SD card using Raspberry Pi Imager or balenaEtcher
2. Insert SD card into Pi
3. Connect Pi to TV(s) via HDMI
4. Power on
5. Pi auto-registers and displays KDS screens

---

## 10. Setup Script (Option B)

The `curl` one-liner downloads and runs a bash script that:

1. Installs required packages (`chromium-browser`, `xserver-xorg`, `unclutter`, `jq`)
2. Creates `/home/pi/kds-kiosk.sh` and `/home/pi/kds-register.sh`
3. Runs `kds-register.sh` with the embedded setup code
4. Configures auto-login and autostart
5. Disables screen blanking
6. Prompts to reboot

The script is hosted at `https://cafepulse.com/setup/:setupCode` and is generated dynamically with the setup code embedded.

---

## 11. Manual Setup (Option C)

The admin UI page displays step-by-step instructions:

1. Flash Raspberry Pi OS Lite to SD card
2. Boot and connect to WiFi
3. Install packages (copy-paste command)
4. Download kiosk scripts (copy-paste `curl` commands)
5. Enter setup code (displayed in large monospace text)
6. Run registration command
7. Configure autostart (copy-paste commands)
8. Reboot

Each step has a copy button and clear instructions written for non-developers.

---

## 12. Future Enhancements

These are explicitly out of scope for MVP but documented for future planning.

### Remote Commands (Phase 2)
- Admin UI sends commands: refresh screen, reboot Pi, change screen assignment
- Pi polls for pending commands via heartbeat response
- Heartbeat response adds: `{ commands: [{ type: "refresh", target: "screen_1" }] }`

### Heartbeat History & Analytics (Phase 2)
- Separate `kds_heartbeats` table logging each ping
- Uptime percentage tracking per device
- Alert notifications (email/Slack) when a device goes offline for 10+ minutes

### OTA Image Updates (Phase 3)
- Pi checks for image version on heartbeat
- Admin UI pushes update notification
- Pi downloads and applies update on next reboot
- Requires A/B partition scheme for safe rollback

### Multiple Pis Per Location (Phase 3)
- Support more than 2 screens per location
- Device grouping by location
- Location-level management in admin UI

### Screen Rotation / Scheduling (Phase 3)
- Schedule different layouts for different times of day (breakfast vs lunch menu)
- Rotate between screens on a single display
- Playlist-style content management

### QR Code Registration (Phase 2)
- Generate QR code in admin UI instead of text setup code
- Pi camera scans QR during first boot
- Faster and less error-prone than typing codes

### Health Monitoring Dashboard (Phase 2)
- Dedicated monitoring page with device map
- Historical uptime charts
- Network quality indicators (latency, failed heartbeats)

### Service Worker Offline Cache (Phase 2)
- Cache static assets (CSS, fonts, images) via service worker
- Ensure fonts and icons display even on first offline occurrence
- Pre-cache the layout JSON for instant display after reboot without network

---

## 13. Decision Log

| # | Decision | Alternatives Considered | Why Chosen |
|---|----------|------------------------|------------|
| 1 | Pi runs Chromium only (no local app server) | Full Next.js on Pi, Docker on Pi | App is on Vercel; Pi only needs a browser. Eliminates Node.js, PM2, builds on Pi. |
| 2 | Three provisioning options (SD image, setup script, manual) | Single option only | Different tenant comfort levels. All converge on same end state. |
| 3 | Setup code for device registration | Direct URL, QR code, manual token entry | Enables device registration, auth token issuance, and future remote management. Short codes are easy to type. |
| 4 | Device-specific bearer token (simple) | Rotating tokens, mTLS certificates | Sufficient for kiosk on private WiFi. Revocable from admin UI. MVP simplicity. |
| 5 | Browser-managed kiosk (Approach 1) | Pi-side agent daemon, static config | Minimal Pi complexity. All logic in the web app. Status-only monitoring doesn't need a daemon. |
| 6 | Heartbeat via page JavaScript (60s) | Agent daemon heartbeat, no heartbeat | Reliable in kiosk mode. No extra services on Pi. 3-min offline threshold. |
| 7 | Status-only remote monitoring | Status + commands, no monitoring | Sufficient for MVP. Content updates are automatic via existing auto-refresh. |
| 8 | 1 Pi with dual HDMI → 2 screens | 2 Pis per location, 1 Pi 1 screen | Cost-effective. Pi 4 supports dual displays natively. |
| 9 | Mokesai maintains SD card image | Tenant builds own image, use Pi Imager only | Simplest tenant experience. Rarely needs updating. |
| 10 | WiFi pre-configured in download (primary) | First-boot captive portal, Ethernet only | Seamless experience. Pi Imager as alternative. Manual as fallback. |
| 11 | Server-side image injection at download | Base image + separate config file | One download, flash, boot, done. Cleanest tenant experience. |
| 12 | Offline shows last content + indicator | Offline message screen, browser error page | Customers see the menu even during outages. Subtle indicator doesn't cause alarm. |
| 13 | KDS display route outside `/admin/` | Authenticated admin route, public route | Bypasses admin login. Protected by device token, not user session. |
| 14 | 10-50 tenant scale for MVP | Larger scale, single tenant | ~100 heartbeats/min is trivial. No special infrastructure needed. |

---

## 14. Implementation Phases

### Phase 1: Core Infrastructure
- Database migration: `kds_devices` table with RLS
- API endpoints: register, heartbeat, config
- KDS display route: `/kds/display/:deviceId/:screen`
- Heartbeat + offline detection JavaScript

### Phase 2: Admin UI
- Device Manager page (`/admin/kds-config/deploy`)
- Add Device wizard with 3 provisioning options
- Device status display (online/offline/pending)

### Phase 3: Pi Provisioning
- Build base SD card image
- Server-side image injection (WiFi + setup code)
- Setup script generator
- Manual setup instructions page

### Phase 4: Testing & Documentation
- End-to-end testing with actual Pi hardware
- Tenant-facing deployment guide (PDF)
- Troubleshooting documentation
