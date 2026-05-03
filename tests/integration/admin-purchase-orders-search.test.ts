/**
 * MOK-142 — GET /api/admin/purchase-orders search + limit support.
 *
 * Pre-MOK-142 the route ignored `?search=` and `?limit=` query params
 * entirely. NoPOMatchForm.tsx called the route with both, expecting the
 * tenant's POs filtered by order_number ILIKE %search% capped at 10 — got
 * the entire unfiltered list keyed under `orders`, while the form read
 * `data.data` (undefined). Search appeared broken even though the route
 * returned rows.
 *
 * This file covers the route-side fixes:
 *  - search filters by order_number (case-insensitive substring)
 *  - limit caps the result count
 *  - response shape includes both `orders` (legacy) and `data` (alias)
 *  - tenant isolation is preserved
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as listPOsGET } from '@/app/api/admin/purchase-orders/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInventoryItem,
  createPurchaseOrder,
  createSupplier,
  createTenantForTest,
  type TestTenant,
} from './helpers/tenant'

describe('GET /api/admin/purchase-orders — search + limit (MOK-142)', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined
  // PO order numbers seeded under tenantA for this test run. createPurchaseOrder
  // generates random suffixes, so capture them to assert presence/absence.
  const tenantAOrderNumbers: string[] = []
  let alphaPONumber = ''
  let bravoPONumber = ''

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
    if (!tenantA || !tenantB) throw new Error('test setup failed')

    const supplierA = await createSupplier(tenantA)
    const inventoryA = await createInventoryItem(tenantA)
    // 3 POs under tenant A — distinct order_number patterns
    const alpha = await createPurchaseOrder(tenantA, {
      supplier_id: supplierA.id,
      inventory_item_id: inventoryA.id,
      order_number: `ALPHA-PO-${Date.now()}`,
    })
    alphaPONumber = alpha.order_number
    const bravo = await createPurchaseOrder(tenantA, {
      supplier_id: supplierA.id,
      inventory_item_id: inventoryA.id,
      order_number: `BRAVO-PO-${Date.now()}`,
    })
    bravoPONumber = bravo.order_number
    const charlie = await createPurchaseOrder(tenantA, {
      supplier_id: supplierA.id,
      inventory_item_id: inventoryA.id,
      order_number: `CHARLIE-${Date.now()}`,
    })
    tenantAOrderNumbers.push(alpha.order_number, bravo.order_number, charlie.order_number)

    // Seed 1 PO under tenant B with a name that would match a tenantA search
    // term, to verify isolation.
    const supplierB = await createSupplier(tenantB)
    const inventoryB = await createInventoryItem(tenantB)
    await createPurchaseOrder(tenantB, {
      supplier_id: supplierB.id,
      inventory_item_id: inventoryB.id,
      order_number: `ALPHA-LEAK-${Date.now()}`,
    })
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it('search by order_number prefix returns matching POs only', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: '/api/admin/purchase-orders?search=ALPHA-PO',
    })
    const res = await listPOsGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const orderNumbers = (body.data ?? body.orders ?? []).map((po: { order_number: string }) => po.order_number)
    expect(orderNumbers).toContain(alphaPONumber)
    expect(orderNumbers).not.toContain(bravoPONumber)
  })

  it('search is case-insensitive substring match', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: '/api/admin/purchase-orders?search=alpha',
    })
    const res = await listPOsGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const orderNumbers = (body.data ?? []).map((po: { order_number: string }) => po.order_number)
    expect(orderNumbers).toContain(alphaPONumber)
  })

  it('limit caps the response count', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: '/api/admin/purchase-orders?limit=2',
    })
    const res = await listPOsGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect((body.data ?? []).length).toBeLessThanOrEqual(2)
  })

  it('response includes both `orders` and `data` for caller compat', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: '/api/admin/purchase-orders?search=ALPHA-PO',
    })
    const res = await listPOsGET(req)
    const body = await res.json()
    expect(body.orders).toBeDefined()
    expect(body.data).toBeDefined()
    // Both keys point at the same array
    expect((body.orders as Array<unknown>).length).toBe((body.data as Array<unknown>).length)
  })

  it('tenant isolation: tenant A search does not see tenant B POs even with matching pattern', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: '/api/admin/purchase-orders?search=ALPHA',
    })
    const res = await listPOsGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const orderNumbers = (body.data ?? []).map((po: { order_number: string }) => po.order_number)
    // tenant B's ALPHA-LEAK PO must not appear
    expect(orderNumbers.some((n: string) => n.startsWith('ALPHA-LEAK'))).toBe(false)
  })
})
