/**
 * A2 / MOK-170 — one square_item_id can map to multiple packaged products per
 * supplier, distinguished by a free-form package_label.
 *
 * Coverage:
 *   - two rows (same supplier + square_item_id + pack_size, different
 *     package_label) both persist via the admin API
 *   - the duplicate guard still fires for two *unlabeled* rows (same key,
 *     NULL label) with an actionable 409 message
 *   - tenant isolation: rows never leak to another tenant
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as inventoryPOST } from '@/app/api/admin/inventory/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenantA: TestTenant
let tenantB: TestTenant
let supplierA: { id: string; name: string }

beforeAll(async () => {
  tenantA = await createTenantForTest('pkglabel-a')
  tenantB = await createTenantForTest('pkglabel-b')
  supplierA = await createSupplier(tenantA, { name: 'Bluepoint Bakery' })
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

interface CreateBody {
  square_item_id: string
  item_name: string
  current_stock: number
  item_type: 'prepackaged'
  supplier_id: string
  pack_size: number
  package_label?: string
}

async function postItem(tenant: TestTenant, body: CreateBody) {
  const req = buildAuthedRequest({
    tenant,
    method: 'POST',
    url: '/api/admin/inventory',
    body,
  })
  const res = await inventoryPOST(req)
  return { res, json: await res.json() }
}

describe('admin/inventory — MOK-170 package_label discriminator', () => {
  it('allows two products with the same supplier + square_item_id + pack_size but different package_label', async () => {
    const squareId = `sq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const base = {
      square_item_id: squareId,
      item_name: 'Coke Zero 12oz',
      current_stock: 0,
      item_type: 'prepackaged' as const,
      supplier_id: supplierA.id,
      pack_size: 12,
    }

    const first = await postItem(tenantA, { ...base, package_label: 'Standalone case' })
    expect(first.res.status).toBe(200)
    expect(first.json.success).toBe(true)

    const second = await postItem(tenantA, { ...base, package_label: 'From variety pack' })
    expect(second.res.status).toBe(200)
    expect(second.json.success).toBe(true)

    const supabase = getServiceClient()
    const { data } = await supabase
      .from('inventory_items')
      .select('id, package_label')
      .eq('tenant_id', tenantA.id)
      .eq('square_item_id', squareId)
      .eq('supplier_id', supplierA.id)
      .eq('pack_size', 12)
    const labels = (data ?? []).map((r) => r.package_label).sort()
    expect(labels).toEqual(['From variety pack', 'Standalone case'])
  })

  it('still rejects two unlabeled rows on the same (supplier, square_item_id, pack_size) with an actionable 409', async () => {
    const squareId = `sq-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const base = {
      square_item_id: squareId,
      item_name: 'Sprite 12oz',
      current_stock: 0,
      item_type: 'prepackaged' as const,
      supplier_id: supplierA.id,
      pack_size: 24,
    }

    const first = await postItem(tenantA, base)
    expect(first.res.status).toBe(200)

    const dup = await postItem(tenantA, base)
    expect(dup.res.status).toBe(409)
    expect(dup.json.error).toMatch(/Package Label/i)
  })

  it('tenant isolation: package_label rows never leak to another tenant', async () => {
    const squareId = `sq-iso-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const created = await postItem(tenantA, {
      square_item_id: squareId,
      item_name: 'Fanta 12oz',
      current_stock: 0,
      item_type: 'prepackaged',
      supplier_id: supplierA.id,
      pack_size: 6,
      package_label: 'Tenant A only',
    })
    expect(created.res.status).toBe(200)

    const supabase = getServiceClient()
    const { data: leaked } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('tenant_id', tenantB.id)
      .eq('square_item_id', squareId)
    expect(leaked ?? []).toHaveLength(0)
  })
})
