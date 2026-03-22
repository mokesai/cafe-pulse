# Raspberry Pi KDS Deployment Guide (v2)

Deploy Cafe Pulse KDS screens to TV displays using a Raspberry Pi 4.

## Architecture

The Pi runs **only Chromium in kiosk mode** — no local app server, no Node.js, no PM2. The app is hosted on Vercel and the Pi is just a browser pointing at a URL. All menu data, layouts, and settings come from Supabase (cloud).

```
Raspberry Pi 4                     Vercel (Cloud)
┌─────────────┐                  ┌─────────────────┐
│ Chromium    │───── HTTPS ─────▶│ Next.js App      │
│ (kiosk mode)│                  │ /kds/display/... │
│             │◀──── HTML ──────│                   │
│ HDMI-1 → TV1│                  │                   │
│ HDMI-2 → TV2│                  └────────┬──────────┘
└─────────────┘                           │
      │ heartbeat (60s)                   │
      └──────────────────────────────────▶│ Supabase
                                          │ (menu data, layouts)
```

## Prerequisites

- Raspberry Pi 4 (2GB+ RAM)
- MicroSD card (16GB+)
- USB-C power supply (3A)
- 1-2 TVs with HDMI input
- HDMI cable(s)
- WiFi network with internet access (or Ethernet)
- A computer to flash the SD card

## Setup Options

### Option A: Setup Script (Recommended)

The fastest path if you already have Raspberry Pi OS installed.

1. Flash **Raspberry Pi OS Lite (64-bit)** to your SD card using [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Boot the Pi and connect via SSH
3. In the Cafe Pulse admin UI, go to **KDS Config → Deploy to TV → Add Device**
4. Complete the wizard (name your device, assign screens)
5. Choose **"Setup Script"** and copy the one-liner command
6. Run the command on your Pi:
   ```bash
   curl -sL https://your-domain.com/api/kds/setup/YOUR-CODE | bash
   ```
7. The script installs everything, registers the device, and prompts to reboot
8. After reboot, your KDS screens appear automatically

### Option B: SD Card Image

The simplest path — everything pre-configured.

1. In the Cafe Pulse admin UI, go to **KDS Config → Deploy to TV → Add Device**
2. Complete the wizard and choose **"SD Card Image"**
3. Enter your WiFi network name and password
4. Download the image file (~2 GB)
5. Flash to SD card using Raspberry Pi Imager or balenaEtcher
6. Insert SD card, connect HDMI cable(s), power on
7. The Pi auto-connects to WiFi, registers itself, and displays your KDS screens

### Option C: Manual Setup

Step-by-step instructions for full control.

1. Flash Raspberry Pi OS Lite (64-bit) and boot
2. Connect to WiFi and enable SSH
3. Install packages:
   ```bash
   sudo apt update && sudo apt install -y chromium-browser xserver-xorg xinit x11-xserver-utils unclutter jq
   ```
4. Register your device (get setup code from admin UI):
   ```bash
   curl -s -X POST https://your-domain.com/api/kds/register \
     -H "Content-Type: application/json" \
     -d '{"setup_code":"YOUR-CODE"}' > ~/kds-config.json
   ```
5. Download kiosk scripts:
   ```bash
   curl -sL https://your-domain.com/api/kds/kiosk-script?type=kiosk > ~/kds-kiosk.sh
   curl -sL https://your-domain.com/api/kds/kiosk-script?type=register > ~/kds-register.sh
   chmod +x ~/kds-kiosk.sh ~/kds-register.sh
   ```
6. Configure autostart:
   ```bash
   echo '[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && startx ~/kds-kiosk.sh' >> ~/.bash_profile
   ```
7. Disable screen blanking:
   ```bash
   sudo mkdir -p /etc/X11/xorg.conf.d
   sudo tee /etc/X11/xorg.conf.d/10-blanking.conf << 'EOF'
   Section "ServerFlags"
       Option "BlankTime" "0"
       Option "StandbyTime" "0"
       Option "SuspendTime" "0"
       Option "OffTime" "0"
   EndSection
   EOF
   ```
8. Reboot: `sudo reboot`

## Display Configuration

### Dual Screen Setup

The Pi 4 has two HDMI ports. By default:
- **HDMI-1** → Drinks screen
- **HDMI-2** → Food screen

Screen assignments are configured in the admin UI during device setup and can be changed anytime from the Device Manager.

### Single Screen

If only one TV is connected, the Pi detects this automatically and launches only one Chromium window. A message in the log suggests connecting a second TV.

## Content Updates

Menu updates are **automatic** — no Pi reboot needed.

1. Update prices in Square
2. Sync to Google Sheet (KDS Config → Manage Sheet → Sync from Square)
3. Import the sheet (KDS Config → Manage Sheet → Import)
4. Within 5 minutes, the Pi's browser auto-refreshes and shows new prices

Layout changes, new categories, and image updates also propagate automatically.

## Device Management

From the admin UI at **KDS Config → Deploy to TV**:

- **Status monitoring** — Green dot = online (heartbeat within 3 min), red = offline
- **Rename** — Click the edit icon to rename a device
- **Change screens** — Reassign which screen shows on which HDMI output
- **Revoke** — Remove a device (it will stop displaying KDS screens)

## Offline Behavior

If the internet connection drops:
- The current menu content **stays visible** on the TV
- A small "Offline" indicator appears in the bottom-right corner
- When the connection returns, the indicator disappears and the page refreshes

## Troubleshooting

### Screens are blank / not loading

1. Check if the Pi has internet: `ping google.com`
2. Check if the app is accessible: `curl -s https://your-domain.com/api/kds/heartbeat`
3. Check kiosk log: `cat ~/kds-kiosk.log`
4. Verify the device is registered: `cat ~/kds-config.json | jq .device_id`

### Device shows "Offline" in admin UI

- Check Pi's internet connection
- Check if Chromium is running: `ps aux | grep chromium`
- Reboot the Pi: `sudo reboot`

### Second TV not showing

- Verify HDMI-2 cable is connected before booting
- Check display detection: `xrandr`
- Reboot with both cables connected

### Setup code expired

- Setup codes expire after 24 hours
- Generate a new one: revoke the device in admin UI and add a new one

### Menu not updating

- Auto-refresh runs every 5 minutes
- Force refresh: reboot the Pi or press F5 if a keyboard is connected
- Verify the latest data was imported in the admin UI

## Security

- Device auth tokens are stored hashed in the database
- The display route (`/kds/display/:deviceId/:screen`) requires a valid device token cookie
- Tokens can be revoked from the admin UI at any time
- SSH is enabled by default on the Pi for troubleshooting — consider disabling or key-only auth for production (see `doc/raspberry-pi-secure-setup.md`)

## Hardware Recommendations

| Component | Recommendation |
|-----------|---------------|
| Raspberry Pi | Pi 4 Model B, 2GB+ RAM |
| SD Card | 16GB+ Class 10 / UHS-I |
| Power Supply | Official USB-C 3A (5.1V) |
| TV | Any TV with HDMI input, 1080p recommended |
| Case | Official case or passive cooling case |
| Network | WiFi or Ethernet (Ethernet preferred for reliability) |
