# Raspberry Pi Secure User Setup

Create a secure `pi` user account for deploying the cafe web app on Raspberry Pi.

## Prerequisites

- Raspberry Pi running Debian 12 (Bookworm) or Raspberry Pi OS
- Physical access or existing SSH access to the Pi
- Mac/Linux development machine on the same network

## 1. Create the `pi` User

Run these commands **on the Raspberry Pi** (logged in as your current user):

```bash
# Create user with home directory
sudo useradd -m -s /bin/bash pi

# Set a strong password
sudo passwd pi

# Add to sudo group
sudo usermod -aG sudo pi
```

## 2. Enable SSH Service

```bash
# Enable and start SSH
sudo systemctl enable ssh
sudo systemctl start ssh

# Verify it's running
sudo systemctl status ssh
```

## 3. Set Up SSH Key Authentication

Key-based authentication is more secure than password authentication.

### On your development machine (Mac/Linux):

```bash
# Check if you already have an SSH key
ls ~/.ssh/id_ed25519.pub

# If not, generate one
ssh-keygen -t ed25519 -C "your-machine-name"

# Copy your public key to the Pi
ssh-copy-id pi@<raspberry-pi-ip>

# Test the connection
ssh pi@<raspberry-pi-ip>
```

## 4. Harden SSH Configuration

After confirming key-based login works, disable password authentication.

**On the Raspberry Pi:**

```bash
sudo nano /etc/ssh/sshd_config
```

Change or add these settings:

```
# Disable password authentication (key-only)
PasswordAuthentication no

# Disable root login
PermitRootLogin no

# Only allow specific users
AllowUsers pi

# Use strong protocol
Protocol 2

# Disconnect idle sessions after 5 minutes
ClientAliveInterval 300
ClientAliveCountMax 0
```

Restart SSH to apply changes:

```bash
sudo systemctl restart ssh
```

**Important:** Keep your current SSH session open while testing a new connection to ensure you don't lock yourself out.

## 5. Configure Firewall (UFW)

```bash
# Install UFW if not present
sudo apt update
sudo apt install -y ufw

# Set default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH
sudo ufw allow ssh

# Allow the web app port
sudo ufw allow 3000

# Enable the firewall
sudo ufw enable

# Check status
sudo ufw status
```

## 6. Limit Sudo Access (Optional)

For additional security, restrict what the `pi` user can do with sudo.

Create a specific sudoers entry:

```bash
sudo visudo -f /etc/sudoers.d/pi-app
```

Add these lines:

```
# Allow pi to manage the app service without password
pi ALL=(ALL) NOPASSWD: /bin/systemctl start cafe-pulse
pi ALL=(ALL) NOPASSWD: /bin/systemctl stop cafe-pulse
pi ALL=(ALL) NOPASSWD: /bin/systemctl restart cafe-pulse
pi ALL=(ALL) NOPASSWD: /bin/systemctl status cafe-pulse

# Allow pi to manage PM2 without password
pi ALL=(ALL) NOPASSWD: /usr/bin/pm2 *
```

## 7. Additional Security Measures

### Install and configure fail2ban

Protects against brute-force SSH attacks:

```bash
sudo apt install -y fail2ban

# Create local config
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

Add or modify:

```ini
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
```

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### Keep system updated

```bash
# Update package lists and upgrade
sudo apt update && sudo apt upgrade -y

# Enable automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### Disable unused services

```bash
# List running services
systemctl list-units --type=service --state=running

# Disable any unnecessary services
# sudo systemctl disable <service-name>
```

## Quick Setup Summary

### On the Raspberry Pi:

```bash
# Create user
sudo useradd -m -s /bin/bash pi
sudo passwd pi
sudo usermod -aG sudo pi

# Enable SSH
sudo systemctl enable ssh
sudo systemctl start ssh
```

### On your development machine:

```bash
# Copy SSH key
ssh-copy-id pi@<raspberry-pi-ip>

# Test login
ssh pi@<raspberry-pi-ip>
```

### Back on the Raspberry Pi:

```bash
# Harden SSH (after key login works)
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# Set up firewall
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 3000
sudo ufw enable
```

## Verification Checklist

- [ ] `pi` user created with strong password
- [ ] SSH key authentication working
- [ ] Password authentication disabled
- [ ] Root login disabled
- [ ] Firewall enabled with only necessary ports open
- [ ] fail2ban installed and running (optional)
- [ ] Automatic updates enabled (optional)

## Troubleshooting

### Locked out of SSH

If you disable password auth before setting up keys:

1. Connect a keyboard and monitor to the Pi
2. Log in locally
3. Re-enable password auth: `sudo sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config`
4. Restart SSH: `sudo systemctl restart ssh`
5. Set up keys properly, then disable password auth again

### SSH connection refused

```bash
# Check if SSH is running
sudo systemctl status ssh

# Check firewall
sudo ufw status

# Check if port 22 is listening
sudo netstat -tlnp | grep 22
```

### Permission denied (publickey)

```bash
# On the Pi, check authorized_keys permissions
ls -la ~/.ssh/
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```
