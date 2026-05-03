/**
 * MOK-142 — GET /api/admin/inventory search + limit support.
 *
 * Mirror of the PO search test. Pre-MOK-142 the route ignored ?search=
 * and ?limit= and returned all rows under `items`, while NoItemMatchForm
 * read `data.data` (undefined). Search appeared broken.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as listInventoryGET } from '@/app/api/admin/inventory/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInventoryItem,
  createTenantForTest,
  type TestTenant,
} from './helpers/tenant'

describe('GET /api/admin/inventory — search + limit (MOK-142)', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined
  let alphaName = ''
  let bravoName = ''

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
    if (!tenantA || !tenantB) throw new Error('test setup failed')

    const stamp = Date.now()
    const alpha = await createInventoryItem(tenantA, { item_name: `Alpha Croissant ${stamp}` })
    alphaName = alpha.item_name
    const bravo = await createInventoryItem(tenantA, { item_name: `Bravo Bagel ${stamp}` })
    bravoName = bravo.item_name
    await createInventoryItem(tenantA, { item_name: `Charlie Coffee ${stamp}` })

    // Cross-tenant control row that would match an alpha search
    await createInventoryItem(tenantB, { item_name: `Alpha LEAK ${stamp}` })
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it('search by item_name (case-insensitive substring) returns matching items only', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: '/api/admin/inventory?search=alpha',
    })
    const res = await listInventoryGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const names = (body.data ?? []).map((it: { item_name: string }) => it.item_name)
    expect(names).toContain(alphaName)
    expect(names).not.toContain(bravoName)
  })

  it('limit caps the response count', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: '/api/admin/inventory?limit=2',
    })
    const res = await listInventoryGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect((body.data ?? []).length).toBeLessThanOrEqual(2)
  })

  it('response includes both `items` and `data` for caller compat', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: '/api/admin/inventory?search=alpha',
    })
    const res = await listInventoryGET(req)
    const body = await res.json()
    expect(body.items).toBeDefined()
    expect(body.data).toBeDefined()
    expect((body.items as Array<unknown>).length).toBe((body.data as Array<unknown>).length)
  })

  it('tenant isolation: tenant A search does not see tenant B items even with matching pattern', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: '/api/admin/inventory?search=alpha',
    })
    const res = await listInventoryGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const names = (body.data ?? []).map((it: { item_name: string }) => it.item_name)
    expect(names.some((n: string) => n.startsWith('Alpha LEAK'))).toBe(false)
  })
})
