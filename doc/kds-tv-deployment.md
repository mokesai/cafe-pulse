# KDS TV Deployment Guide

This guide covers setting up the Kitchen Display System (KDS) on two 50" TV screens for Little Cafe at Kaiser Permanente, Denver.

## Display Configuration

### Screen Layout
- **Screen 1 (Left TV)**: Drinks menu - `/kds/drinks`
- **Screen 2 (Right TV)**: Food menu - `/kds/food`

### Recommended Hardware
- 50" Smart TV with web browser support (Samsung, LG, or similar)
- Alternatively: Raspberry Pi 4 with HDMI output
- Stable WiFi or Ethernet connection

## Deployment URLs

| Screen | URL | Content |
|--------|-----|---------|
| Drinks | `https://your-domain.com/kds/drinks` | Hot drinks, espressos, cold drinks, blended beverages |
| Food | `https://your-domain.com/kds/food` | Breakfast, pastries, sandwiches, snacks |

## TV Setup Options

### Option 1: Smart TV Built-in Browser

Most modern Smart TVs have a built-in web browser:

1. Open the TV's web browser app
2. Navigate to the KDS URL
3. Enable fullscreen mode (usually F11 or a menu option)
4. Disable screen timeout/sleep mode in TV settings
5. Set the browser as startup app (if supported)

**Pros**: No additional hardware needed
**Cons**: Limited browser capabilities, may need manual refresh

### Option 2: Raspberry Pi (Recommended)

Use a Raspberry Pi 4 for reliable kiosk-mode display:

#### Hardware Required
- Raspberry Pi 4 (2GB+ RAM)
- MicroSD card (16GB+)
- HDMI cable
- Power supply (USB-C, 3A)
- Case with passive cooling

#### Software Setup

1. **Install Raspberry Pi OS Lite**
   ```bash
   # Download Raspberry Pi Imager and flash "Raspberry Pi OS Lite (64-bit)"
   ```

2. **Install required packages**
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y chromium-browser xserver-xorg x11-xserver-utils xinit unclutter
   ```

3. **Create autostart script**
   ```bash
   sudo nano /home/pi/kiosk.sh
   ```

   Contents:
   ```bash
   #!/bin/bash

   # Disable screen saver and power management
   xset s off
   xset -dpms
   xset s noblank

   # Hide cursor
   unclutter -idle 0.5 -root &

   # Start Chromium in kiosk mode
   chromium-browser \
     --kiosk \
     --disable-infobars \
     --disable-session-crashed-bubble \
     --disable-restore-session-state \
     --noerrdialogs \
     --disable-translate \
     --no-first-run \
     --fast \
     --fast-start \
     --disable-features=TranslateUI \
     --disk-cache-dir=/dev/null \
     --overscroll-history-navigation=0 \
     --disable-pinch \
     "https://your-domain.com/kds/drinks"  # Change to /kds/food for screen 2
   ```

4. **Make executable and enable autostart**
   ```bash
   chmod +x /home/pi/kiosk.sh

   # Edit .bash_profile for auto-login
   echo '[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && startx /home/pi/kiosk.sh' >> ~/.bash_profile
   ```

5. **Enable auto-login**
   ```bash
   sudo raspi-config
   # Navigate to: System Options > Boot / Auto Login > Console Autologin
   ```

6. **Set display rotation (if needed)**
   ```bash
   sudo nano /boot/config.txt
   # Add: display_rotate=1  (90°) or display_rotate=3 (270°)
   ```

### Option 3: Fire TV Stick / Chromecast

For a simple solution using streaming devices:

#### Fire TV Stick
1. Install "Silk Browser" from Amazon Appstore
2. Navigate to KDS URL
3. Use Developer Options to enable "Stay Awake"

#### Chromecast with Google TV
1. Install Chrome browser
2. Navigate to KDS URL
3. Enable fullscreen mode

## Network Requirements

- Stable internet connection (WiFi or Ethernet preferred)
- Outbound HTTPS access to your domain
- No proxy/firewall blocking the application

## Auto-Refresh

The KDS automatically refreshes every 5 minutes to pick up menu changes. The refresh indicator in the bottom-right corner shows:
- Countdown to next refresh
- Spinning icon during refresh

## Troubleshooting

### Screen goes black/sleep
- Disable power saving in TV settings
- For Raspberry Pi, ensure `xset -dpms` is running

### Browser shows error page
- Check internet connectivity
- Verify the URL is accessible
- Check if the application is running

### Menu not updating
- The system auto-refreshes every 5 minutes
- Manual refresh: Use TV remote to refresh page
- Check if Sheets data has been imported to database

### Images not loading
- Verify images exist in `/public/images/kds/`
- Check browser console for 404 errors
- Ensure image filenames match database records

### Display too small/large
- The KDS CSS is optimized for 1920x1080 (Full HD)
- 4K displays will use larger fonts automatically
- Adjust TV zoom if needed

## Maintenance

### Updating Menu Content

1. Edit prices/items in Google Sheets
2. Publish Sheets as CSV
3. Run import script:
   ```bash
   npm run import-kds-menu -- --clear
   ```
4. Wait for auto-refresh (5 minutes) or manually refresh TVs

### Adding New Images

1. Add images to appropriate folder:
   - `/public/images/kds/drinks/` for drinks
   - `/public/images/kds/food/` for food

2. Update images CSV in Sheets with new filenames

3. Run import script

### Rebooting Displays

For Raspberry Pi:
```bash
ssh pi@raspberrypi.local
sudo reboot
```

For Smart TV:
- Use TV remote power cycle
- Or unplug/replug power

## Recommended Schedule

| Task | Frequency |
|------|-----------|
| Check display status | Daily |
| Update menu prices | As needed |
| Rotate footer images | Weekly |
| Full system reboot | Weekly |
| Browser cache clear | Monthly |

## Support Contacts

- Technical Issues: Check application logs at `/kds` routes
- Content Updates: Edit via Google Sheets workflow
- Hardware Issues: Contact IT support

## Quick Reference

```
Drinks Display:  https://your-domain.com/kds/drinks
Food Display:    https://your-domain.com/kds/food

Auto-refresh:    Every 5 minutes
Image rotation:  Every 6 seconds (footer)

Import command:  npm run import-kds-menu -- --clear
Export command:  npm run export-kds-menu
```
