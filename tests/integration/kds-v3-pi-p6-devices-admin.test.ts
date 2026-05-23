/**
 * MOK-162 / KDS Pi Deployment phase 6 — admin devices routes integration
 * tests.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-162
 * Plan: .planning/kds-v3-pi/PHASE-6-PLAN.md (T5)
 *
 * Covers:
 *   1. GET /devices — lists tenant's devices with screen names + computed_status
 *   2. POST /devices — creates pending device, returns plaintext setup_code
 *   3. POST /devices — 422 KDS_DEVICE_LIMIT_REACHED at cap (1)
 *   4. POST /devices — 400 KDS_DEVICE_BAD_REQUEST on empty name
 *   5. PATCH /devices/[id] — renames
 *   6. PATCH /devices/[id] — binds screen_1_id + screen_2_id to owned screens
 *   7. PATCH /devices/[id] — 422 KDS_DEVICE_SCREEN_NOT_OWNED on cross-tenant id
 *   8. PATCH /devices/[id] — unbind via screen_*_id: null
 *   9. DELETE /devices/[id] — removes row + Pi heartbeat then returns 401
 *  10. Tenant isolation — A's admin cannot read/modify B's device (404)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as listGET, POST as listPOST } from '@/app/api/admin/kds-v3/devices/route'
import {
  PATCH as itemPATCH,
  DELETE as itemDELETE,
} from '@/app/api/admin/kds-v3/devices/[deviceId]/route'
import { POST as heartbeatPOST } from '@/app/api/kds/heartbeat/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenantA: TestTenant
let tenantB: TestTenant

beforeAll(async () => {
  tenantA = await createTenantForTest('kds-pi-p6-a')
  tenantB = await createTenantForTest('kds-pi-p6-b')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function clearAll(tenantId: string) {
  const supabase = getServiceClient()
  await supabase.from('kds_devices').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_grid_boxes').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_screens').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  await Promise.all([clearAll(tenantA.id), clearAll(tenantB.id)])
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

function listReq(tenant: TestTenant) {
  return buildAuthedRequest({ tenant, method: 'GET', url: '/api/admin/kds-v3/devices' })
}
function createReq(tenant: TestTenant, body: unknown) {
  return buildAuthedRequest({
    tenant,
    method: 'POST',
    url: '/api/admin/kds-v3/devices',
    body,
  })
}
function itemReq(
  tenant: TestTenant,
  deviceId: string,
  method: 'PATCH' | 'DELETE',
  body?: unknown,
) {
  return buildAuthedRequest({
    tenant,
    method,
    url: `/api/admin/kds-v3/devices/${deviceId}`,
    body,
  })
}

interface DeviceRowSummary {
  id: string
  name: string
  computed_status: 'online' | 'stale' | 'offline' | 'pending'
  setup_code: string | null
  screen_1_id: string | null
  screen_2_id: string | null
  screen_1_name: string | null
  screen_2_name: string | null
}

interface CreateOk {
  success: true
  data: DeviceRowSummary
}

async function createDevice(tenant: TestTenant, name: string): Promise<DeviceRowSummary> {
  const res = await listPOST(createReq(tenant, { name }))
  expect(res.status).toBe(201)
  const body = (await res.json()) as CreateOk
  expect(body.success).toBe(true)
  return body.data
}

describe('MOK-162 — kds-v3 devices admin routes', () => {
  // 1
  it('GET /devices lists tenant devices with screen names + computed_status', async () => {
    const screenId = await seedScreen(tenantA, 'Drinks')
    const created = await createDevice(tenantA, 'Kitchen Pi')
    // Bind a screen so we can see the joined name come through.
    const patchRes = await itemPATCH(itemReq(tenantA, created.id, 'PATCH', { screen_1_id: screenId }), {
      params: Promise.resolve({ deviceId: created.id }),
    })
    expect(patchRes.status).toBe(200)

    const res = await listGET(listReq(tenantA))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Kitchen Pi')
    expect(body.data[0].screen_1_id).toBe(screenId)
    expect(body.data[0].screen_1_name).toBe('Drinks')
    expect(body.data[0].screen_2_id).toBeNull()
    expect(body.data[0].screen_2_name).toBeNull()
    expect(body.data[0].computed_status).toBe('pending') // no heartbeat yet
    expect(body.cap).toEqual({ current: 1, max: 1, reached: true })
  })

  // 2
  it('POST /devices creates a pending device with a plaintext setup_code', async () => {
    const created = await createDevice(tenantA, 'Kitchen Pi')
    expect(created.setup_code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/)
    expect(created.computed_status).toBe('pending')

    // The setup_code should be persisted (the operator can come back later).
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('kds_devices')
      .select('id, status, setup_code, auth_token')
      .eq('id', created.id)
      .single()
    expect(data?.status).toBe('pending')
    expect(data?.setup_code).toBe(created.setup_code)
    expect(data?.auth_token).toBeNull()
  })

  // 3
  it('POST /devices returns 422 KDS_DEVICE_LIMIT_REACHED when the tenant already has one device', async () => {
    await createDevice(tenantA, 'First Pi')
    const res = await listPOST(createReq(tenantA, { name: 'Second Pi' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.code).toBe('KDS_DEVICE_LIMIT_REACHED')
  })

  // 4
  it('POST /devices rejects an empty name with 400 KDS_DEVICE_BAD_REQUEST', async () => {
    const res = await listPOST(createReq(tenantA, { name: '   ' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('KDS_DEVICE_BAD_REQUEST')
  })

  // 5
  it('PATCH /devices/[id] renames a device', async () => {
    const created = await createDevice(tenantA, 'Kitchen Pi')
    const res = await itemPATCH(itemReq(tenantA, created.id, 'PATCH', { name: 'Counter Pi' }), {
      params: Promise.resolve({ deviceId: created.id }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.name).toBe('Counter Pi')
  })

  // 6
  it('PATCH /devices/[id] binds screen_1_id and screen_2_id to owned screens', async () => {
    const s1 = await seedScreen(tenantA, 'Drinks')
    const s2 = await seedScreen(tenantA, 'Food')
    const created = await createDevice(tenantA, 'Kitchen Pi')

    const res = await itemPATCH(
      itemReq(tenantA, created.id, 'PATCH', { screen_1_id: s1, screen_2_id: s2 }),
      { params: Promise.resolve({ deviceId: created.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.screen_1_id).toBe(s1)
    expect(body.data.screen_2_id).toBe(s2)
  })

  // 7
  it('PATCH /devices/[id] returns 422 KDS_DEVICE_SCREEN_NOT_OWNED for a cross-tenant screen id', async () => {
    const sB = await seedScreen(tenantB, 'B-Drinks')
    const created = await createDevice(tenantA, 'Kitchen Pi')

    const res = await itemPATCH(itemReq(tenantA, created.id, 'PATCH', { screen_1_id: sB }), {
      params: Promise.resolve({ deviceId: created.id }),
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_DEVICE_SCREEN_NOT_OWNED')
  })

  // 8
  it('PATCH /devices/[id] unbinds via screen_*_id: null', async () => {
    const s1 = await seedScreen(tenantA, 'Drinks')
    const created = await createDevice(tenantA, 'Kitchen Pi')
    await itemPATCH(itemReq(tenantA, created.id, 'PATCH', { screen_1_id: s1 }), {
      params: Promise.resolve({ deviceId: created.id }),
    })

    const res = await itemPATCH(itemReq(tenantA, created.id, 'PATCH', { screen_1_id: null }), {
      params: Promise.resolve({ deviceId: created.id }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.screen_1_id).toBeNull()
  })

  // 9
  it('DELETE /devices/[id] revokes the device and a subsequent Pi heartbeat returns 401', async () => {
    // Create a fully-registered device with a known auth token so we can
    // simulate a heartbeat after revoke.
    const supabase = getServiceClient()
    const plain = 'a'.repeat(64)
    const hashed = require('crypto').createHash('sha256').update(plain).digest('hex')
    const { data: device } = await supabase
      .from('kds_devices')
      .insert({
        tenant_id: tenantA.id,
        name: 'Revoke Me',
        status: 'registered',
        auth_token: hashed,
        registered_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    expect(device?.id).toBeTruthy()
    const deviceId = device!.id as string

    const delRes = await itemDELETE(itemReq(tenantA, deviceId, 'DELETE'), {
      params: Promise.resolve({ deviceId }),
    })
    expect(delRes.status).toBe(200)

    const hbReq = new Request('http://localhost:3000/api/kds/heartbeat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${plain}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    })
    const hbRes = await heartbeatPOST(hbReq as Parameters<typeof heartbeatPOST>[0])
    expect(hbRes.status).toBe(401)
  })

  // 10
  it('tenant isolation: A cannot read or modify B device (404)', async () => {
    const bDevice = await createDevice(tenantB, 'B Pi')

    // From A's session, PATCH B's device → 404
    const patchRes = await itemPATCH(
      itemReq(tenantA, bDevice.id, 'PATCH', { name: 'pwned' }),
      { params: Promise.resolve({ deviceId: bDevice.id }) },
    )
    expect(patchRes.status).toBe(404)

    // DELETE → 404
    const delRes = await itemDELETE(itemReq(tenantA, bDevice.id, 'DELETE'), {
      params: Promise.resolve({ deviceId: bDevice.id }),
    })
    expect(delRes.status).toBe(404)

    // LIST as A shouldn't include B's device
    const listRes = await listGET(listReq(tenantA))
    const listBody = await listRes.json()
    expect(listBody.data.map((d: { id: string }) => d.id)).not.toContain(bDevice.id)

    // B's row in DB is untouched
    const supabase = getServiceClient()
    const { data: stillThere } = await supabase
      .from('kds_devices')
      .select('id, name')
      .eq('id', bDevice.id)
      .single()
    expect(stillThere?.name).toBe('B Pi')
  })
})
