/**
 * B3 / MOK-175 — the price-review endpoint flags only inventory items whose supplier cost jumped
 * >= threshold recently, and the dashboard cogs-status endpoint surfaces the count.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as priceReviewGET } from '@/app/api/admin/inventory/price-review/route'
import { GET as cogsStatusGET } from '@/app/api/admin/dashboard/cogs-status/route'
import {
  buildAuthedRequest,
  cleanupTenant,
  createInventoryItem,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenant: TestTenant
let jumpedItemId: string

beforeAll(async () => {
  tenant = await createTenantForTest('pricereview')
  const supabase = getServiceClient()
  const jumped = await createInventoryItem(tenant, { item_name: 'Espresso Beans', unit_cost: 46 })
  jumpedItemId = jumped.id
  const steady = await createInventoryItem(tenant, { item_name: 'Whole Milk', unit_cost: 3.3 })

  const now = new Date().toISOString()
  await supabase.from('inventory_item_cost_history').insert([
    // +15% jump (40 → 46) — flagged
    { tenant_id: tenant.id, inventory_item_id: jumped.id, previous_unit_cost: 40, new_unit_cost: 46, source: 'manual_edit', changed_at: now },
    // +3% (3.2 → 3.3) — below threshold
    { tenant_id: tenant.id, inventory_item_id: steady.id, previous_unit_cost: 3.2, new_unit_cost: 3.3, source: 'manual_edit', changed_at: now },
  ])
})

afterAll(async () => {
  const supabase = getServiceClient()
  await supabase.from('inventory_item_cost_history').delete().eq('tenant_id', tenant.id)
  await cleanupTenant(tenant)
})

describe('inventory price-review — MOK-175 cost-jump', () => {
  it('flags only items with a >= threshold recent cost jump', async () => {
    const res = await priceReviewGET(
      buildAuthedRequest({ tenant, method: 'GET', url: '/api/admin/inventory/price-review' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.items[0].id).toBe(jumpedItemId)
    expect(body.items[0].pct_change).toBe(15)
  })

  it('surfaces the count on the dashboard cogs-status endpoint', async () => {
    const res = await cogsStatusGET(
      buildAuthedRequest({ tenant, method: 'GET', url: '/api/admin/dashboard/cogs-status' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.itemsNeedingPriceReview).toBe(1)
  })
})
