import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { POST as suppliersPOST } from '@/app/api/admin/suppliers/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

describe('POST /api/admin/suppliers — tenant isolation', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
  })

  afterAll(async () => {
    await cleanupTenant(tenantA)
    await cleanupTenant(tenantB)
  })

  it('inserts the supplier under the calling tenant only', async () => {
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
    const { data: rows, error } = await svc
      .from('suppliers')
      .select('id, name, tenant_id')
      .eq('name', uniqueName)
    expect(error).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows![0].tenant_id).toBe(tenantA.id)
    expect(rows![0].tenant_id).not.toBe(tenantB.id)
    expect(rows![0].tenant_id).not.toBe('00000000-0000-0000-0000-000000000001')
  })
})
