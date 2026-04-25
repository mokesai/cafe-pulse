import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { POST as suppliersPOST } from '@/app/api/admin/suppliers/route'
import { POST as suppliersBulkPOST } from '@/app/api/admin/suppliers/bulk-upload/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001'

describe('admin suppliers — tenant isolation', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it('POST /api/admin/suppliers inserts under the calling tenant only', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const uniqueName = `ACME Test Supply ${tenantA.id}`

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/suppliers',
      body: { name: uniqueName, contact_person: 'Jane Doe' },
    })

    const res = await suppliersPOST(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.supplier.name).toBe(uniqueName)

    const svc = getServiceClient()
    const { data: rows } = await svc
      .from('suppliers')
      .select('id, name, tenant_id')
      .eq('name', uniqueName)
    expect(rows).toHaveLength(1)
    expect(rows![0].tenant_id).toBe(tenantA.id)
    expect(rows![0].tenant_id).not.toBe(tenantB.id)
    expect(rows![0].tenant_id).not.toBe(DEFAULT_TENANT)
  })

  it('POST /api/admin/suppliers/bulk-upload tags every row with the calling tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const stamp = `${tenantA.id}-${Date.now()}`
    const names = [`Bulk Supplier One ${stamp}`, `Bulk Supplier Two ${stamp}`, `Bulk Supplier Three ${stamp}`]

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/suppliers/bulk-upload',
      body: {
        suppliers: names.map((name) => ({ name, contact_person: 'QA Bot' })),
      },
    })

    const res = await suppliersBulkPOST(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.result.created).toBe(3)

    const svc = getServiceClient()
    const { data: rows } = await svc
      .from('suppliers')
      .select('name, tenant_id')
      .in('name', names)
    expect(rows).toHaveLength(3)
    for (const row of rows ?? []) {
      expect(row.tenant_id).toBe(tenantA.id)
    }

    const { count: countB } = await svc
      .from('suppliers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantB.id)
      .in('name', names)
    expect(countB).toBe(0)

    const { count: countDefault } = await svc
      .from('suppliers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', DEFAULT_TENANT)
      .in('name', names)
    expect(countDefault).toBe(0)
  })
})
