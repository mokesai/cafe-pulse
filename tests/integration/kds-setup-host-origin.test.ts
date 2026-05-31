/**
 * MOK-166 — verify the Pi setup-script endpoint uses the request's Host
 * header (not nextUrl.origin) when interpolating API_BASE into the
 * generated bash. This is the exact symptom that bit Pi dev testing:
 * nextUrl.origin reports `http://localhost:3000` under `next dev -H 0.0.0.0`
 * even when the client connects via `http://bigcafe.local-macbook:3000`,
 * so the Pi tries to POST to localhost-on-the-Pi and the install dies at
 * step 2.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'

import { GET as setupGET } from '@/app/api/kds/setup/[setupCode]/route'

import {
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenant: TestTenant

beforeAll(async () => {
  tenant = await createTenantForTest('mok166')
})

afterAll(async () => {
  await cleanupTenant(tenant)
})

beforeEach(async () => {
  const supabase = getServiceClient()
  await supabase.from('kds_devices').delete().eq('tenant_id', tenant.id)
})

async function seedPendingDevice(setupCode: string) {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('kds_devices')
    .insert({
      tenant_id: tenant.id,
      name: `MOK-166 ${crypto.randomBytes(3).toString('hex')}`,
      status: 'pending',
      setup_code: setupCode,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedPendingDevice: ${error?.message}`)
  return data.id as string
}

function buildSetupRequest(opts: {
  setupCode: string
  url: string
  host?: string
  forwardedProto?: string
}) {
  const headers = new Headers()
  if (opts.host) headers.set('host', opts.host)
  if (opts.forwardedProto) headers.set('x-forwarded-proto', opts.forwardedProto)
  return new Request(opts.url, { method: 'GET', headers })
}

describe('MOK-166 — setup script uses Host header for API_BASE', () => {
  it('bakes API_BASE from Host header, not from the bind address', async () => {
    const setupCode = `MOK166-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    await seedPendingDevice(setupCode)

    // Mirrors the Pi-dev scenario: server bound to localhost:3000 but the
    // client (Pi) addresses it via bigcafe.local-macbook:3000.
    const req = buildSetupRequest({
      setupCode,
      url: 'http://localhost:3000/api/kds/setup/' + setupCode,
      host: 'bigcafe.local-macbook:3000',
    })

    const res = await setupGET(req as Parameters<typeof setupGET>[0], {
      params: Promise.resolve({ setupCode }),
    })
    expect(res.status).toBe(200)

    const body = await res.text()
    expect(body).toContain('API_BASE="http://bigcafe.local-macbook:3000"')
    expect(body).not.toContain('API_BASE="http://localhost:3000"')
    // The curl-bootstrap one-liner in the script header should also point
    // at the right host.
    expect(body).toContain(
      `# Run with: curl -sL http://bigcafe.local-macbook:3000/api/kds/setup/${setupCode} | bash`,
    )
  })

  it('writes KDS_API_BASE to ~/.kds-env so the kiosk inherits the origin (MOK-167)', async () => {
    const setupCode = `MOK167-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    await seedPendingDevice(setupCode)

    const req = buildSetupRequest({
      setupCode,
      url: 'http://localhost:3000/api/kds/setup/' + setupCode,
      host: 'bigcafe.local-macbook:3000',
    })

    const res = await setupGET(req as Parameters<typeof setupGET>[0], {
      params: Promise.resolve({ setupCode }),
    })
    const body = await res.text()
    // The env-file write uses the same Host-derived origin so the kiosk
    // script's `[ -f "$HOME/.kds-env" ] && . "$HOME/.kds-env"` picks it up
    // before defaulting to https://cafepulse.com.
    expect(body).toContain(
      `echo 'export KDS_API_BASE="http://bigcafe.local-macbook:3000"' > "$HOME/.kds-env"`,
    )
    expect(body).toContain('chmod 600 "$HOME/.kds-env"')
    // Re-runs are idempotent because the redirect is `>` (overwrite), not
    // `>>` (append) — verify we don't accidentally regress to append.
    expect(body).not.toContain('>> "$HOME/.kds-env"')
  })

  it('honors x-forwarded-proto for https in front of a proxy', async () => {
    const setupCode = `MOK166-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    await seedPendingDevice(setupCode)

    const req = buildSetupRequest({
      setupCode,
      url: 'http://localhost:3000/api/kds/setup/' + setupCode,
      host: 'cafepulse.com',
      forwardedProto: 'https',
    })

    const res = await setupGET(req as Parameters<typeof setupGET>[0], {
      params: Promise.resolve({ setupCode }),
    })
    const body = await res.text()
    expect(body).toContain('API_BASE="https://cafepulse.com"')
  })
})
