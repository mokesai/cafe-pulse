import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  POST as inventoryPOST,
  PUT as inventoryPUT,
} from '@/app/api/admin/inventory/route'
import { POST as inventoryRestockPOST } from '@/app/api/admin/inventory/restock/route'
import { POST as inventoryAdjustPOST } from '@/app/api/admin/inventory/adjust/route'
import { POST as inventoryBulkPOST } from '@/app/api/admin/inventory/bulk-upload/route'
import { POST as inventoryLocationsPOST } from '@/app/api/admin/inventory/locations/route'
import { POST as inventorySettingsPOST } from '@/app/api/admin/inventory/settings/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInventoryItem,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001'

async function assertTenantScoped(
  table: string,
  filter: Record<string, string>,
  expectedTenant: TestTenant,
  otherTenant: TestTenant,
  expectedCount = 1,
) {
  const svc = getServiceClient()
  let query = svc.from(table).select('tenant_id')
  for (const [k, v] of Object.entries(filter)) query = query.eq(k, v)
  const { data: rows } = await query
  expect(rows).toHaveLength(expectedCount)
  for (const row of rows ?? []) {
    expect(row.tenant_id).toBe(expectedTenant.id)
    expect(row.tenant_id).not.toBe(otherTenant.id)
    expect(row.tenant_id).not.toBe(DEFAULT_TENANT)
  }
}

describe('admin inventory — tenant isolation', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it('POST /api/admin/inventory creates the item + opening stock_movement under the calling tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const itemName = `Test Widget ${tenantA.id}`

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/inventory',
      body: { item_name: itemName, current_stock: 5, item_type: 'supply' },
    })
    const res = await inventoryPOST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    const itemId: string = json.item.id

    await assertTenantScoped('inventory_items', { id: itemId }, tenantA, tenantB)
    await assertTenantScoped(
      'stock_movements',
      { inventory_item_id: itemId },
      tenantA,
      tenantB,
    )
  })

  it('PUT /api/admin/inventory writes a tenant-scoped cost_history row when unit_cost changes', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const item = await createInventoryItem(tenantA, { unit_cost: 1.0 })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'PUT',
      url: '/api/admin/inventory',
      body: { id: item.id, unit_cost: 2.5 },
    })
    const res = await inventoryPUT(req)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)

    await assertTenantScoped(
      'inventory_item_cost_history',
      { inventory_item_id: item.id },
      tenantA,
      tenantB,
    )
  })

  it('POST /api/admin/inventory/restock writes a tenant-scoped stock_movement', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const item = await createInventoryItem(tenantA, { current_stock: 3 })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/inventory/restock',
      body: { inventory_item_id: item.id, quantity: 7, unit_cost: 1.25 },
    })
    const res = await inventoryRestockPOST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).newStock).toBe(10)

    const svc = getServiceClient()
    const { data: mv } = await svc
      .from('stock_movements')
      .select('tenant_id, movement_type')
      .eq('inventory_item_id', item.id)
      .eq('movement_type', 'purchase')
    expect(mv).toHaveLength(1)
    expect(mv![0].tenant_id).toBe(tenantA.id)
    expect(mv![0].tenant_id).not.toBe(tenantB.id)
    expect(mv![0].tenant_id).not.toBe(DEFAULT_TENANT)
  })

  it('POST /api/admin/inventory/adjust writes a tenant-scoped stock_movement', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const item = await createInventoryItem(tenantA, { current_stock: 10 })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/inventory/adjust',
      body: { inventory_item_id: item.id, new_stock: 4, reason: 'shrinkage' },
    })
    const res = await inventoryAdjustPOST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).newStock).toBe(4)

    const svc = getServiceClient()
    const { data: mv } = await svc
      .from('stock_movements')
      .select('tenant_id, movement_type, quantity_change')
      .eq('inventory_item_id', item.id)
      .eq('movement_type', 'adjustment')
    expect(mv).toHaveLength(1)
    expect(mv![0].tenant_id).toBe(tenantA.id)
    expect(mv![0].quantity_change).toBe(-6)
  })

  it('POST /api/admin/inventory/bulk-upload tags all items (and their movements) with the calling tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const stamp = `${tenantA.id}-${Date.now()}`
    const squareIds = [`bulk-${stamp}-1`, `bulk-${stamp}-2`, `bulk-${stamp}-3`]

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/inventory/bulk-upload',
      body: {
        items: squareIds.map((sid, i) => ({
          square_item_id: sid,
          item_name: `Bulk Test ${sid}`,
          current_stock: i + 1,
          unit_cost: 0.5,
          is_ingredient: false,
        })),
      },
    })

    const res = await inventoryBulkPOST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).stats.totalItems).toBe(3)

    const svc = getServiceClient()
    const { data: items } = await svc
      .from('inventory_items')
      .select('id, tenant_id')
      .in('square_item_id', squareIds)
    expect(items).toHaveLength(3)
    for (const row of items ?? []) {
      expect(row.tenant_id).toBe(tenantA.id)
      expect(row.tenant_id).not.toBe(DEFAULT_TENANT)
    }

    const itemIds = (items ?? []).map((i) => i.id)
    const { data: moves } = await svc
      .from('stock_movements')
      .select('tenant_id')
      .in('inventory_item_id', itemIds)
    for (const row of moves ?? []) {
      expect(row.tenant_id).toBe(tenantA.id)
    }
  })

  it('POST /api/admin/inventory/locations creates a location under the calling tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const name = `Back Room ${tenantA.id}`

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/inventory/locations',
      body: { name, description: 'Test location' },
    })
    const res = await inventoryLocationsPOST(req)
    expect(res.status).toBe(200)

    await assertTenantScoped('inventory_locations', { name }, tenantA, tenantB)
  })

  it('POST /api/admin/inventory/settings creates/updates settings under the calling tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/inventory/settings',
      body: {
        global_low_stock_threshold: 7,
        global_critical_stock_threshold: 3,
        currency: 'USD',
        default_unit_type: 'each',
      },
    })
    const res = await inventorySettingsPOST(req)
    expect(res.status).toBe(200)

    const svc = getServiceClient()
    const { data: rowsA } = await svc
      .from('inventory_settings')
      .select('tenant_id, global_low_stock_threshold')
      .eq('tenant_id', tenantA.id)
    expect(rowsA).toHaveLength(1)
    expect(rowsA![0].global_low_stock_threshold).toBe(7)

    const { count: countB } = await svc
      .from('inventory_settings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantB.id)
    expect(countB).toBe(0)
  })
})
