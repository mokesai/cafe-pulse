import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * POST /api/kds/sd-image
 * Generates a downloadable config bundle for SD card setup.
 *
 * For MVP: Returns a ZIP-like bundle of config files to copy to the Pi's SD card.
 * Future: Will inject WiFi + setup code into a base .img.gz and stream the download.
 *
 * Body: { device_id, wifi_ssid, wifi_password }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { device_id, wifi_ssid, wifi_password } = body

    if (!device_id || !wifi_ssid || !wifi_password) {
      return NextResponse.json(
        { error: 'device_id, wifi_ssid, and wifi_password are required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Get device with setup code
    const { data: device } = await supabase
      .from('kds_devices')
      .select('id, setup_code, screen_1, screen_2, tenant_id')
      .eq('id', device_id)
      .maybeSingle()

    if (!device || !device.setup_code) {
      return NextResponse.json({ error: 'Device not found or already registered' }, { status: 404 })
    }

    const origin = request.nextUrl.origin

    // Generate wpa_supplicant.conf content
    const wpaSupplicant = `country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="${wifi_ssid}"
    psk="${wifi_password}"
    key_mgmt=WPA-PSK
}
`

    // Generate kds-config.json with setup code
    const kdsConfig = JSON.stringify({
      setup_code: device.setup_code,
      api_base: origin,
    }, null, 2)

    // Generate a README with instructions
    const readme = `Cafe Pulse KDS — SD Card Configuration
========================================

These files were generated for your KDS device setup.

INSTRUCTIONS:
1. Flash Raspberry Pi OS Lite (64-bit) to your SD card
   using Raspberry Pi Imager or balenaEtcher.

2. After flashing, open the "boot" partition on the SD card.

3. Copy these files to the boot partition:
   - wpa_supplicant.conf → connects to your WiFi automatically
   - kds-config.json → contains your setup code for auto-registration

4. Also copy wpa_supplicant.conf to the rootfs partition at:
   /etc/wpa_supplicant/wpa_supplicant.conf

5. Copy kds-config.json to the rootfs partition at:
   /home/pi/kds-config.json

6. Insert the SD card into your Raspberry Pi and power on.

7. Once booted, SSH into the Pi and run the setup script:
   curl -sL ${origin}/api/kds/setup/${device.setup_code} | bash

Setup Code: ${device.setup_code}
Screen 1: ${device.screen_1}
Screen 2: ${device.screen_2}
`

    // Return as JSON with all config files
    // (MVP approach — future: actual .img injection)
    return NextResponse.json({
      files: {
        'wpa_supplicant.conf': wpaSupplicant,
        'kds-config.json': kdsConfig,
        'README.txt': readme,
      },
      setup_code: device.setup_code,
      instructions: readme,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
