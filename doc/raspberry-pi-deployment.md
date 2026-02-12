# Raspberry Pi Deployment Guide

Deploy the Little Cafe web app to a Raspberry Pi 4 for KDS (Kitchen Display System) TV displays.

## Prerequisites

- Raspberry Pi 4 (2GB+ RAM recommended)
- Debian Linux 12 (Bookworm) or Raspberry Pi OS
- Network connection
- HDMI display (TV screen)

## Deployment Options

**Option 1: Direct Node.js Deployment (Recommended for KDS)**
- Simple setup, runs the Next.js server directly
- Uses PM2 for process management and auto-restart

**Option 2: Docker**
- More isolated but higher resource overhead on Pi

This guide covers Option 1.

---

## Setup Instructions

### 1. Install Node.js

```bash
# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should show v20.x
npm --version
```

### 2. Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

### 3. Transfer Your App

**Option A: Git clone (if repo is accessible)**
```bash
cd ~
git clone <your-repo-url> cafe-web
cd cafe-web/website
```

**Option B: Rsync from your development machine**
```bash
# Run this FROM your Mac/development machine
rsync -avz --exclude 'node_modules' --exclude '.next' --exclude '.git' \
  /path/to/cafe-web/website/ \
  pi@<raspberry-pi-ip>:~/cafe-web/
```

### 4. Setup Environment Variables

```bash
# On the Pi
cd ~/cafe-web
nano .env.local
```

Add your environment variables (copy from your development `.env.local`):
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SECRET_KEY=your_secret_key
# ... other required env vars
```

### 5. Build and Run

```bash
cd ~/cafe-web

# Install dependencies
npm install

# Build for production
npm run build

# Start with PM2
pm2 start npm --name "cafe-web" -- start

# Save PM2 config to survive reboots
pm2 save
pm2 startup  # Follow the instructions it outputs
```

---

## Chromium Kiosk Mode (TV Display)

### Install Chromium

```bash
sudo apt-get install -y chromium-browser
```

### Create Autostart Entry

```bash
mkdir -p ~/.config/autostart
nano ~/.config/autostart/kds-kiosk.desktop
```

Add this content:
```ini
[Desktop Entry]
Type=Application
Name=KDS Kiosk
Exec=/home/pi/kds-kiosk.sh
X-GNOME-Autostart-enabled=true
```

### Create Kiosk Script

```bash
nano ~/kds-kiosk.sh
```

```bash
#!/bin/bash

# Wait for network and app to be ready
sleep 10

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Start Chromium in kiosk mode
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --start-fullscreen \
  http://localhost:3000/admin/kds/drinks
```

Make it executable:
```bash
chmod +x ~/kds-kiosk.sh
```

---

## Two-Screen Setup (Drinks + Food)

For the full KDS setup with two displays:

| Screen | URL | Content |
|--------|-----|---------|
| Screen 1 | `http://localhost:3000/admin/kds/drinks` | Hot drinks, espressos, cold drinks, blended |
| Screen 2 | `http://localhost:3000/admin/kds/food` | Breakfast, pastries, sandwiches, snacks |

### Option A: Two Raspberry Pis
- Configure each Pi with the appropriate URL in `kds-kiosk.sh`

### Option B: Single Pi with Dual Monitors
- Modify the kiosk script to open two browser windows on different displays:

```bash
#!/bin/bash
sleep 10
xset s off && xset -dpms && xset s noblank

# Display 1 - Drinks
DISPLAY=:0.0 chromium-browser --kiosk --app=http://localhost:3000/admin/kds/drinks &

# Display 2 - Food
DISPLAY=:0.1 chromium-browser --kiosk --app=http://localhost:3000/admin/kds/food &
```

---

## PM2 Commands Reference

```bash
# View app logs
pm2 logs cafe-web

# View real-time logs
pm2 logs cafe-web --lines 100

# Restart app
pm2 restart cafe-web

# Stop app
pm2 stop cafe-web

# Check status
pm2 status

# Monitor resources
pm2 monit
```

---

## Updating the App

```bash
cd ~/cafe-web

# If using git
git pull

# Or rsync new files from dev machine

# Rebuild and restart
npm install
npm run build
pm2 restart cafe-web
```

---

## Troubleshooting

### App won't start
```bash
# Check logs for errors
pm2 logs cafe-web --lines 50

# Verify environment variables
cat .env.local

# Try running manually to see errors
npm start
```

### Screen goes blank
```bash
# Disable screen saver permanently
sudo nano /etc/lightdm/lightdm.conf

# Add under [Seat:*]:
xserver-command=X -s 0 -dpms
```

### Browser shows login page
The KDS routes require admin authentication. Either:
1. Log in once and the session will persist
2. Or configure a service account for unattended display

### Network issues
```bash
# Check network connectivity
ping google.com

# Check if app is running
curl http://localhost:3000

# Check PM2 status
pm2 status
```

---

## Security Notes

- The `.env.local` file contains sensitive keys - ensure proper file permissions:
  ```bash
  chmod 600 .env.local
  ```
- Consider using a firewall to restrict access:
  ```bash
  sudo apt-get install ufw
  sudo ufw allow ssh
  sudo ufw allow 3000
  sudo ufw enable
  ```
- For production, consider running behind a reverse proxy (nginx) with HTTPS
