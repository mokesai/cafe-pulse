/**
 * MOK-144 — `/api/admin/inventory?siblings_of=<id>` returns the pack-pair
 * siblings of a given inventory row (rows sharing its `square_item_id`,
 * minus the row itself). Drives the "Pack-pair siblings" panel in the
 * PriceVarianceForm re-match UI.
 *
 * Coverage:
 *   - returns siblings sharing the same square_item_id (excluding the
 *     anchor row itself)
 *   - empty list when the anchor row has no square_item_id
 *   - tenant isolation: never returns rows from another tenant
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as inventoryGET } from '@/app/api/admin/inventory/route'

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
  tenantA = await createTenantForTest('siblings-a')
  tenantB = await createTenantForTest('siblings-b')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function insertInventoryRow(
  tenantId: string,
  fields: { name: string; pack_size: number; square_item_id: string | null; unit_cost?: number },
): Promise<{ id: string }> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      tenant_id: tenantId,
      item_name: fields.name,
      pack_size: fields.pack_size,
      unit_cost: fields.unit_cost ?? 1.5,
      square_item_id: fields.square_item_id ?? `manual-${Math.random()}`,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertInventoryRow failed: ${error?.message}`)
  return data
}

describe('admin/inventory — MOK-144 pack-pair sibling lookup', () => {
  it('returns siblings sharing square_item_id, excluding the anchor row', async () => {
    const squareId = `sq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const single = await insertInventoryRow(tenantA.id, {
      name: 'Butter Croissant',
      pack_size: 1,
      square_item_id: squareId,
      unit_cost: 1.5,
    })
    const four = await insertInventoryRow(tenantA.id, {
      name: 'Croissant 3oz 4pk',
      pack_size: 4,
      square_item_id: squareId,
      unit_cost: 1.55,
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: `/api/admin/inventory?siblings_of=${single.id}&limit=10`,
    })
    const res = await inventoryGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = ((body.data ?? body.items ?? []) as Array<{ id: string }>).map((r) => r.id)

    expect(ids).toContain(four.id)
    expect(ids).not.toContain(single.id)
  })

  it('returns empty when anchor row has no square_item_id (after MOK-110 manual-* prefix is unique per row)', async () => {
    const orphan = await insertInventoryRow(tenantA.id, {
      name: 'Standalone Item',
      pack_size: 1,
      square_item_id: null,
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: `/api/admin/inventory?siblings_of=${orphan.id}&limit=10`,
    })
    const res = await inventoryGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const rows = (body.data ?? body.items ?? []) as Array<{ id: string }>

    // Each `null`-or-manual square_item_id is unique per row, so siblings is empty.
    expect(rows).toHaveLength(0)
  })

  it('tenant isolation: does not return siblings from another tenant', async () => {
    const sharedSquareId = `sq-cross-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const inA = await insertInventoryRow(tenantA.id, {
      name: 'Item-A',
      pack_size: 1,
      square_item_id: sharedSquareId,
    })
    const inB = await insertInventoryRow(tenantB.id, {
      name: 'Item-B',
      pack_size: 4,
      square_item_id: sharedSquareId,
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'GET',
      url: `/api/admin/inventory?siblings_of=${inA.id}&limit=10`,
    })
    const res = await inventoryGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = ((body.data ?? body.items ?? []) as Array<{ id: string }>).map((r) => r.id)

    expect(ids).not.toContain(inB.id)
    expect(ids).not.toContain(inA.id)
  })
})
