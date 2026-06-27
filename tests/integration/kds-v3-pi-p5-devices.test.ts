/**
 * MOK-161 / KDS Pi Deployment phase 5 — device-config + register routes
 * + v3 URL construction integration tests.
 *
 * Plan: .planning/kds-v3-pi/PHASE-5-PLAN.md (T4)
 *
 * Covers:
 *   1. GET /device/[id]/config returns v3 screen URL when screen_1_id is set
 *   2. GET /device/[id]/config returns null screen URL when screen_1_id is null
 *   3. POST /register returns the same shape on a freshly-registered device
 *   4. FK SET NULL: delete a kds_screen referenced by a device → screen_*_id becomes NULL
 *   5. Bad token rejected (defense check)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'

import { GET as configGET } from '@/app/api/kds/device/[deviceId]/config/route'
import { POST as registerPOST } from '@/app/api/kds/register/route'

import {
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenantA: TestTenant

beforeAll(async () => {
  tenantA = await createTenantForTest('kds-pi-p5')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
})

async function clearAll(tenantId: string) {
  const supabase = getServiceClient()
  await supabase.from('kds_devices').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_grid_boxes').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_screens').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  await clearAll(tenantA.id)
})

async function seedScreen(tenant: TestTenant, name = 'Drinks') {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('kds_screens')
    .insert({
      tenant_id: tenant.id,
      name,
      grid_rows: 4,
      grid_cols: 4,
      theme: 'warm',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedScreen: ${error?.message}`)
  return data.id as string
}

interface SeedDeviceOptions {
  screen_1_id?: string | null
  screen_2_id?: string | null
  setup_code?: string | null
  status?: 'pending' | 'registered'
  auth_token_plain?: string | null
}

async function seedDevice(tenant: TestTenant, opts: SeedDeviceOptions = {}) {
  const supabase = getServiceClient()
  const plainToken =
    opts.status === 'registered'
      ? opts.auth_token_plain ?? crypto.randomBytes(16).toString('hex')
      : null
  const hashedToken = plainToken
    ? crypto.createHash('sha256').update(plainToken).digest('hex')
    : null
  const { data, error } = await supabase
    .from('kds_devices')
    .insert({
      tenant_id: tenant.id,
      name: `Test Pi ${crypto.randomBytes(3).toString('hex')}`,
      status: opts.status ?? 'pending',
      setup_code: opts.setup_code ?? null,
      auth_token: hashedToken,
      registered_at: opts.status === 'registered' ? new Date().toISOString() : null,
      screen_1_id: opts.screen_1_id ?? null,
      screen_2_id: opts.screen_2_id ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedDevice: ${error?.message}`)
  return { id: data.id as string, plainToken }
}

function configRequest(deviceId: string, token: string | null) {
  const url = `http://localhost:3000/api/kds/device/${deviceId}/config`
  return new Request(url, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

function registerRequest(body: Record<string, unknown>) {
  return new Request('http://localhost:3000/api/kds/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('MOK-161 — Pi phase 5 device-config + register', () => {
  // 1
  it('device-config returns /kds/v3/<id>/<uuid> URL when screen_1_id is set', async () => {
    const screenId = await seedScreen(tenantA, 'Drinks')
    const { id: deviceId, plainToken } = await seedDevice(tenantA, {
      status: 'registered',
      screen_1_id: screenId,
    })

    const res = await configGET(configRequest(deviceId, plainToken), {
      params: Promise.resolve({ deviceId }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.screen_1_id).toBe(screenId)
    expect(body.screen_1_url).toBe(`/kds/v3/${deviceId}/${screenId}`)
    expect(body.screen_2_url).toBeNull()
  })

  // 2
  it('device-config returns null screen_1_url when screen_1_id is null', async () => {
    const { id: deviceId, plainToken } = await seedDevice(tenantA, {
      status: 'registered',
    })

    const res = await configGET(configRequest(deviceId, plainToken), {
      params: Promise.resolve({ deviceId }),
    })
    const body = await res.json()
    expect(body.screen_1_id).toBeNull()
    expect(body.screen_1_url).toBeNull()
    expect(body.screen_2_url).toBeNull()
  })

  // 3
  it('register returns v3 URL shape on a freshly-registered device', async () => {
    const screenId = await seedScreen(tenantA, 'Food')
    const setupCode = `TEST-${crypto.randomBytes(3).toString('hex')}`
    await seedDevice(tenantA, {
      setup_code: setupCode,
      screen_2_id: screenId,
    })

    const res = await registerPOST(registerRequest({ setup_code: setupCode }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.device_id).toBeTruthy()
    expect(body.auth_token).toBeTruthy()
    expect(body.screen_2_id).toBe(screenId)
    expect(body.screen_2_url).toBe(`/kds/v3/${body.device_id}/${screenId}`)
    expect(body.screen_1_url).toBeNull()
  })

  // 4
  it('FK SET NULL: deleting a referenced screen nullifies screen_*_id', async () => {
    const screenId = await seedScreen(tenantA, 'TempScreen')
    const { id: deviceId } = await seedDevice(tenantA, {
      status: 'registered',
      screen_1_id: screenId,
    })

    const supabase = getServiceClient()
    await supabase.from('kds_screens').delete().eq('id', screenId)

    const { data: device } = await supabase
      .from('kds_devices')
      .select('screen_1_id')
      .eq('id', deviceId)
      .single()
    expect(device?.screen_1_id).toBeNull()
  })

  // 5 — defense: bad token rejected
  it('device-config returns 401 when bearer token does not match', async () => {
    const { id: deviceId } = await seedDevice(tenantA, { status: 'registered' })
    const res = await configGET(configRequest(deviceId, 'wrong-token'), {
      params: Promise.resolve({ deviceId }),
    })
    expect(res.status).toBe(401)
  })
})
