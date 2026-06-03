/**
 * MOK-49/50 — verify /api/kds/kiosk-script can serve all four artifact
 * types the setup curl-bash flow expects.
 */
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from '../route'

function buildRequest(type?: string): NextRequest {
  const url = type
    ? `http://localhost:3000/api/kds/kiosk-script?type=${encodeURIComponent(type)}`
    : 'http://localhost:3000/api/kds/kiosk-script'
  return new NextRequest(url)
}

describe('GET /api/kds/kiosk-script', () => {
  it('defaults to type=kiosk when no query param', async () => {
    const res = await GET(buildRequest())
    expect(res.status).toBe(200)
    const body = await res.text()
    // kds-kiosk.sh always opens with a bash shebang
    expect(body.startsWith('#!/bin/bash')).toBe(true)
    expect(body).toContain('KDS Kiosk Launcher')
  })

  it('serves kds-kiosk.sh for type=kiosk', async () => {
    const res = await GET(buildRequest('kiosk'))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('KDS Kiosk Launcher')
  })

  it('serves kds-register.sh for type=register', async () => {
    const res = await GET(buildRequest('register'))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('KDS Device Registration')
  })

  it('serves sway-config for type=sway-config (MOK-49/50)', async () => {
    const res = await GET(buildRequest('sway-config'))
    expect(res.status).toBe(200)
    const body = await res.text()
    // Sway config is plain-text, not bash — these lines anchor on the
    // Phase 8 design: workspace-per-output pinning and per-slot
    // app-id routing.
    expect(body).toContain('workspace 1 output HDMI-A-1')
    expect(body).toContain('workspace 2 output HDMI-A-2')
    expect(body).toContain('assign [app_id="kds-screen-1"] workspace 1')
    expect(body).toContain('assign [app_id="kds-screen-2"] workspace 2')
    expect(body).toContain('exec /home/pi/kds-kiosk.sh')
  })

  it('serves greetd-config.toml for type=greetd-config (MOK-49/50)', async () => {
    // greetd is the system-level display manager that replaces the v2
    // .bash_profile + startx dance AND the systemd-user + linger approach
    // (which can't grant sway a PAM session). Phase 8 settled on this
    // after the user-unit path failed to acquire a seat at boot.
    const res = await GET(buildRequest('greetd-config'))
    expect(res.status).toBe(200)
    const body = await res.text()
    // greetd config is TOML — anchor on the structural shape and the
    // sway exec line so changes that break the launch get caught.
    expect(body).toContain('[terminal]')
    expect(body).toContain('vt = 1')
    expect(body).toContain('[default_session]')
    expect(body).toContain('command = "sway --config /home/pi/.config/sway/config"')
    expect(body).toContain('user = "pi"')
  })

  it('returns 400 with a helpful error for an unknown type', async () => {
    const res = await GET(buildRequest('not-a-real-type'))
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain("Unknown kiosk-script type 'not-a-real-type'")
  })
})
