/**
 * MOK-155 / KDS v3 phase 3 — integration tests for the menu-groups list route.
 *
 * Plan: .planning/kds-v3/PHASE-3-PLAN.md (T4)
 *
 * Covers:
 *   M1. GET returns tenant-scoped menu groups with item_count + parent_menu_name
 *   M2. Tenant isolation — tenant A's request doesn't return tenant B's groups
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as menuGroupsGET } from '@/app/api/admin/kds-v3/menu-groups/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  seedTestMenuGroup,
  type TestTenant,
} from './helpers/tenant'

let tenantA: TestTenant
let tenantB: TestTenant

beforeAll(async () => {
  tenantA = await createTenantForTest('kds-v3-mg-a')
  tenantB = await createTenantForTest('kds-v3-mg-b')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function clearMenuMirror(tenantId: string) {
  const supabase = getServiceClient()
  // Order matters because of FK-like relationships: memberships → items → categories.
  await supabase.from('square_menu_item_categories').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_items').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_categories').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  await Promise.all([clearMenuMirror(tenantA.id), clearMenuMirror(tenantB.id)])
})

function listReq(tenant: TestTenant) {
  return buildAuthedRequest({
    tenant,
    method: 'GET',
    url: '/api/admin/kds-v3/menu-groups',
  })
}

describe('MOK-155 — kds-v3 menu-groups route', () => {
  // M1
  it('GET /menu-groups returns the tenant menu groups with item_count + parent_menu_name', async () => {
    const hot = await seedTestMenuGroup(tenantA, {
      name: 'Hot Drinks',
      parentMenuName: 'KDS Test Menu',
      itemCount: 3,
    })
    const cold = await seedTestMenuGroup(tenantA, {
      name: 'Cold Drinks',
      parentMenuId: 'shared-parent',
      parentMenuName: 'KDS Test Menu',
      itemCount: 2,
    })

    const res = await menuGroupsGET(listReq(tenantA))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const rows = body.data as Array<{
      id: string
      name: string
      item_count: number
      is_deleted: boolean
      parent_menu_id: string | null
      parent_menu_name: string | null
    }>
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(hot.id)?.item_count).toBe(3)
    expect(byId.get(hot.id)?.parent_menu_name).toBe('KDS Test Menu')
    expect(byId.get(cold.id)?.item_count).toBe(2)
    expect(byId.get(cold.id)?.is_deleted).toBe(false)
  })

  // M2
  it('GET /menu-groups returns ONLY the calling tenant rows (no cross-tenant leak)', async () => {
    const aGroup = await seedTestMenuGroup(tenantA, { name: 'A-only group' })
    const bGroup = await seedTestMenuGroup(tenantB, { name: 'B-only group' })

    const resA = await menuGroupsGET(listReq(tenantA))
    const bodyA = await resA.json()
    const idsA = (bodyA.data as Array<{ id: string }>).map((r) => r.id)
    expect(idsA).toContain(aGroup.id)
    expect(idsA).not.toContain(bGroup.id)

    const resB = await menuGroupsGET(listReq(tenantB))
    const bodyB = await resB.json()
    const idsB = (bodyB.data as Array<{ id: string }>).map((r) => r.id)
    expect(idsB).toContain(bGroup.id)
    expect(idsB).not.toContain(aGroup.id)
  })

  it('GET /menu-groups surfaces is_deleted=true rows so the editor can flag stale bindings', async () => {
    await seedTestMenuGroup(tenantA, { name: 'Pastries', is_deleted: true })

    const res = await menuGroupsGET(listReq(tenantA))
    const body = await res.json()
    const rows = body.data as Array<{ name: string; is_deleted: boolean }>
    const pastries = rows.find((r) => r.name === 'Pastries')
    expect(pastries).toBeDefined()
    expect(pastries?.is_deleted).toBe(true)
  })
})
