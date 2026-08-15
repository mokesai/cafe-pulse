/**
 * A3 / MOK-171 — package_cost is stored as the canonical pack/case price so an
 * operator-entered package cost does not drift when unit_cost is rounded to 4dp.
 *
 * Coverage:
 *   - POST with a non-divisible package_cost ($10.00 / pack 3) round-trips
 *     unchanged; unit_cost is the derived 3.3333 (not re-derived back to 9.9999)
 *   - PUT updating package_cost preserves the new value and re-derives unit_cost
 *   - POST with only unit_cost derives a consistent package_cost
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as inventoryPOST, PUT as inventoryPUT } from '@/app/api/admin/inventory/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenantA: TestTenant
let supplierA: { id: string; name: string }

beforeAll(async () => {
  tenantA = await createTenantForTest('pkgcost-a')
  supplierA = await createSupplier(tenantA, { name: 'Cost Test Supplier' })
})

afterAll(async () => {
  await cleanupTenant(tenantA)
})

function squareId() {
  return `sq-cost-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

async function post(body: Record<string, unknown>) {
  const req = buildAuthedRequest({ tenant: tenantA, method: 'POST', url: '/api/admin/inventory', body })
  const res = await inventoryPOST(req)
  return { res, json: await res.json() }
}

async function put(body: Record<string, unknown>) {
  const req = buildAuthedRequest({ tenant: tenantA, method: 'PUT', url: '/api/admin/inventory', body })
  const res = await inventoryPUT(req)
  return { res, json: await res.json() }
}

async function fetchRow(id: string) {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('inventory_items')
    .select('unit_cost, package_cost, pack_size')
    .eq('id', id)
    .single()
  return data as { unit_cost: number; package_cost: number; pack_size: number }
}

describe('admin/inventory — MOK-171 package_cost is canonical (no drift)', () => {
  it('round-trips a non-divisible package cost unchanged and derives unit_cost', async () => {
    const { res, json } = await post({
      square_item_id: squareId(),
      item_name: 'Croissant case',
      current_stock: 0,
      item_type: 'prepackaged',
      supplier_id: supplierA.id,
      pack_size: 3,
      package_cost: 10.0,
    })
    expect(res.status).toBe(200)

    const row = await fetchRow(json.item.id)
    expect(Number(row.package_cost)).toBe(10) // exact — not 9.9999
    expect(Number(row.unit_cost)).toBeCloseTo(3.3333, 4)
  })

  it('PUT preserves an updated package cost and re-derives unit_cost', async () => {
    const created = await post({
      square_item_id: squareId(),
      item_name: 'Muffin case',
      current_stock: 0,
      item_type: 'prepackaged',
      supplier_id: supplierA.id,
      pack_size: 3,
      package_cost: 10.0,
    })
    const { res } = await put({ id: created.json.item.id, package_cost: 20.0, pack_size: 3 })
    expect(res.status).toBe(200)

    const row = await fetchRow(created.json.item.id)
    expect(Number(row.package_cost)).toBe(20)
    expect(Number(row.unit_cost)).toBeCloseTo(6.6667, 4)
  })

  it('derives a consistent package_cost when only unit_cost is supplied', async () => {
    const { json } = await post({
      square_item_id: squareId(),
      item_name: 'Bulk sugar',
      current_stock: 0,
      item_type: 'supply',
      supplier_id: supplierA.id,
      pack_size: 4,
      unit_cost: 1.5475,
    })
    const row = await fetchRow(json.item.id)
    expect(Number(row.unit_cost)).toBeCloseTo(1.5475, 4)
    expect(Number(row.package_cost)).toBeCloseTo(6.19, 2)
  })
})
