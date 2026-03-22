# KDS TV Deployment Guide (v2)

This guide covers deploying Kitchen Display System (KDS) screens to TV displays for Cafe Pulse tenants.

## Recommended: Raspberry Pi

The recommended approach is using a Raspberry Pi 4 in kiosk mode. See **`doc/raspberry-pi-deployment.md`** for the full setup guide.

Quick overview:
1. Go to **KDS Config → Deploy to TV** in the admin panel
2. Add a device and choose your setup method
3. The Pi runs Chromium in kiosk mode pointing to your KDS screens
4. Dual HDMI support — one Pi drives two TVs (drinks + food)

## Alternative: Smart TV Browser

For locations where a Pi isn't practical, you can use the TV's built-in browser.

### Setup

1. Open the TV's web browser
2. Navigate to your KDS display URL:
   - Drinks: `https://your-domain.com/kds/drinks`
   - Food: `https://your-domain.com/kds/food`
3. Enable fullscreen mode (usually F11 or a menu option)
4. Disable screen timeout in TV settings

### Limitations

- No device registration or heartbeat monitoring
- Requires manual URL entry and authentication
- Browser may crash or show update dialogs
- No auto-recovery from network drops
- Not recommended for permanent installations

## Display URLs

### Registered Pi Devices
| Screen | URL | Auth |
|--------|-----|------|
| Drinks | `/kds/display/{deviceId}/drinks` | Device token (auto) |
| Food | `/kds/display/{deviceId}/food` | Device token (auto) |

### Direct Access (Smart TV / Testing)
| Screen | URL | Auth |
|--------|-----|------|
| Drinks | `/kds/drinks` | Admin login required |
| Food | `/kds/food` | Admin login required |

## Display Specifications

- Target resolution: **1920×1080** (Full HD)
- The KDS layout is fixed at 1920×1080 pixels
- 4K TVs will scale up automatically
- Smaller screens may require zoom adjustment

## Auto-Refresh

KDS screens refresh automatically:
- **Data refresh**: Every 5 minutes (configurable via `refresh_interval` setting)
- **Image rotation**: Every 6 seconds (configurable via `image_rotation_interval` setting)

## Network Requirements

- Outbound HTTPS access to your Vercel deployment
- Outbound HTTPS access to Supabase (for data)
- Outbound HTTPS access to Google Fonts (for custom header fonts)
- Stable connection — brief drops are handled gracefully (offline indicator)

## Maintenance

| Task | Frequency |
|------|-----------|
| Check device status in admin UI | Daily |
| Update menu prices (via Square sync) | As needed |
| Update layout (via Layout Editor) | As needed |
| Reboot Pi | Monthly or as needed |
| Update Pi OS | Quarterly |
