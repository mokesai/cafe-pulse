/**
 * MOK-157 / KDS v3 phase 5 — integration tests for the display-overrides
 * routes.
 *
 * Plan: .planning/kds-v3/PHASE-5-PLAN.md (T5)
 *
 * Covers (1:1 with MOK-157 acceptance criteria):
 *   1. PUT items/[id] creates target_kind='item' row
 *   2. PUT variations/[id] creates target_kind='variation' row
 *   3. PUT with all defaults → auto-delete
 *   4. PUT to a non-existent square_item_id → 422
 *   5. PUT to a non-existent square_variation_id → 422
 *   6. PUT with cross-tenant alt_image_aesthetic_image_id → 422
 *   7. PUT round-trip: GET list returns the row with alt_image_thumbnail_url
 *   8. Re-PUT updates existing row (idempotent upsert)
 *   9. DELETE removes the row; second DELETE is idempotent (200)
 *  10. Tenant isolation on GET
 *  11. PUT bound to is_deleted=true aesthetic image is accepted
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as listGET } from '@/app/api/admin/kds-v3/display-overrides/route'
import {
  PUT as itemPUT,
  DELETE as itemDELETE,
} from '@/app/api/admin/kds-v3/display-overrides/items/[id]/route'
import {
  PUT as variationPUT,
  DELETE as variationDELETE,
} from '@/app/api/admin/kds-v3/display-overrides/variations/[id]/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  seedTestAestheticImage,
  seedTestSquareItem,
  seedTestSquareVariation,
  type TestTenant,
} from './helpers/tenant'

let tenantA: TestTenant
let tenantB: TestTenant

beforeAll(async () => {
  tenantA = await createTenantForTest('kds-v3-do-a')
  tenantB = await createTenantForTest('kds-v3-do-b')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function clearAll(tenantId: string) {
  const supabase = getServiceClient()
  await supabase.from('kds_display_overrides').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_item_variations').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_items').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_aesthetic_images').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  await Promise.all([clearAll(tenantA.id), clearAll(tenantB.id)])
})

function reqJson(
  tenant: TestTenant,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
) {
  return buildAuthedRequest({ tenant, method, url, body })
}

describe('MOK-157 — kds-v3 display-overrides routes', () => {
  // 1
  it('PUT items/[id] creates an item-level override row', async () => {
    const item = await seedTestSquareItem(tenantA, { name: 'Espresso' })
    const res = await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${item.id}`, {
        alt_display_name: 'Strong Espresso',
      }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.target_kind).toBe('item')
    expect(body.data.target_id).toBe(item.id)
    expect(body.data.alt_display_name).toBe('Strong Espresso')
    expect(body.data.hidden_from_kds).toBe(false)
  })

  // 2
  it('PUT variations/[id] creates a variation-level override row', async () => {
    const item = await seedTestSquareItem(tenantA, { name: 'Espresso' })
    const variation = await seedTestSquareVariation(tenantA, { item_id: item.id, name: 'Single' })
    const res = await variationPUT(
      reqJson(
        tenantA,
        'PUT',
        `/api/admin/kds-v3/display-overrides/variations/${variation.id}`,
        { hidden_from_kds: true },
      ),
      { params: Promise.resolve({ id: variation.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.target_kind).toBe('variation')
    expect(body.data.target_id).toBe(variation.id)
    expect(body.data.hidden_from_kds).toBe(true)
  })

  // 3
  it('PUT with all defaults auto-deletes the row', async () => {
    const item = await seedTestSquareItem(tenantA, { name: 'Espresso' })

    // Seed a row first
    await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${item.id}`, {
        alt_display_name: 'Strong Espresso',
      }),
      { params: Promise.resolve({ id: item.id }) },
    )

    // Now PUT with all defaults — auto-delete fires
    const res = await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${item.id}`, {
        alt_display_name: null,
        alt_image_aesthetic_image_id: null,
        hidden_from_kds: false,
      }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.deleted).toBe(true)

    // Confirm via direct DB select
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('kds_display_overrides')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('target_kind', 'item')
      .eq('target_id', item.id)
    expect(data ?? []).toHaveLength(0)
  })

  // 4
  it('PUT items/[id] returns 422 when the square_item_id does not exist for the tenant', async () => {
    const res = await itemPUT(
      reqJson(
        tenantA,
        'PUT',
        '/api/admin/kds-v3/display-overrides/items/never-existed',
        { alt_display_name: 'Whatever' },
      ),
      { params: Promise.resolve({ id: 'never-existed' }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_DISPLAY_OVERRIDE_TARGET_NOT_FOUND')
  })

  // 5
  it('PUT variations/[id] returns 422 when the square_variation_id does not exist for the tenant', async () => {
    const res = await variationPUT(
      reqJson(
        tenantA,
        'PUT',
        '/api/admin/kds-v3/display-overrides/variations/no-such-var',
        { hidden_from_kds: true },
      ),
      { params: Promise.resolve({ id: 'no-such-var' }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_DISPLAY_OVERRIDE_TARGET_NOT_FOUND')
  })

  // 6
  it('PUT items/[id] returns 422 when alt_image_aesthetic_image_id belongs to another tenant', async () => {
    const item = await seedTestSquareItem(tenantA, { name: 'Espresso' })
    const bImage = await seedTestAestheticImage(tenantB, { name: 'B-only' })

    const res = await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${item.id}`, {
        alt_image_aesthetic_image_id: bImage.id,
      }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_DISPLAY_OVERRIDE_IMAGE_NOT_FOUND')
  })

  // 7
  it('GET list returns rows with alt_image_thumbnail_url populated when an image is bound', async () => {
    const item = await seedTestSquareItem(tenantA, { name: 'Espresso' })
    const img = await seedTestAestheticImage(tenantA, {
      name: 'Banner',
      external_url: 'https://example.com/banner.png',
    })

    await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${item.id}`, {
        alt_display_name: 'Strong',
        alt_image_aesthetic_image_id: img.id,
      }),
      { params: Promise.resolve({ id: item.id }) },
    )

    const res = await listGET(reqJson(tenantA, 'GET', '/api/admin/kds-v3/display-overrides'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const rows = body.data as Array<{
      target_id: string
      alt_image_aesthetic_image_id: string | null
      alt_image_thumbnail_url: string | null
    }>
    const match = rows.find((r) => r.target_id === item.id)
    expect(match).toBeDefined()
    expect(match?.alt_image_aesthetic_image_id).toBe(img.id)
    expect(match?.alt_image_thumbnail_url).toBe('https://example.com/banner.png')
  })

  // 8
  it('Re-PUT updates the existing row (idempotent upsert; UNIQUE not violated)', async () => {
    const item = await seedTestSquareItem(tenantA, { name: 'Espresso' })

    const first = await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${item.id}`, {
        alt_display_name: 'First',
      }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    const firstId = firstBody.data.id

    const second = await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${item.id}`, {
        alt_display_name: 'Second',
      }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    // Same row id (upsert, not new insert)
    expect(secondBody.data.id).toBe(firstId)
    expect(secondBody.data.alt_display_name).toBe('Second')
  })

  // 9
  it('DELETE removes the row; second DELETE returns 200 (idempotent)', async () => {
    const item = await seedTestSquareItem(tenantA, { name: 'Espresso' })
    await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${item.id}`, {
        hidden_from_kds: true,
      }),
      { params: Promise.resolve({ id: item.id }) },
    )

    const firstDel = await itemDELETE(
      reqJson(tenantA, 'DELETE', `/api/admin/kds-v3/display-overrides/items/${item.id}`),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(firstDel.status).toBe(200)

    const secondDel = await itemDELETE(
      reqJson(tenantA, 'DELETE', `/api/admin/kds-v3/display-overrides/items/${item.id}`),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(secondDel.status).toBe(200)
  })

  // 10
  it('GET / does not return cross-tenant rows', async () => {
    const aItem = await seedTestSquareItem(tenantA, { name: 'A-only item' })
    const bItem = await seedTestSquareItem(tenantB, { name: 'B-only item' })

    await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${aItem.id}`, {
        alt_display_name: 'A name',
      }),
      { params: Promise.resolve({ id: aItem.id }) },
    )
    await itemPUT(
      reqJson(tenantB, 'PUT', `/api/admin/kds-v3/display-overrides/items/${bItem.id}`, {
        alt_display_name: 'B name',
      }),
      { params: Promise.resolve({ id: bItem.id }) },
    )

    const resA = await listGET(reqJson(tenantA, 'GET', '/api/admin/kds-v3/display-overrides'))
    const bodyA = await resA.json()
    const targetIdsA = (bodyA.data as Array<{ target_id: string }>).map((r) => r.target_id)
    expect(targetIdsA).toContain(aItem.id)
    expect(targetIdsA).not.toContain(bItem.id)
  })

  // 11 — soft-deleted aesthetic image still acceptable as alt_image
  it('PUT accepts an alt_image_aesthetic_image_id that is is_deleted=true', async () => {
    const item = await seedTestSquareItem(tenantA, { name: 'Espresso' })
    const stale = await seedTestAestheticImage(tenantA, {
      name: 'Stale image',
      is_deleted: true,
    })

    const res = await itemPUT(
      reqJson(tenantA, 'PUT', `/api/admin/kds-v3/display-overrides/items/${item.id}`, {
        alt_image_aesthetic_image_id: stale.id,
      }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.alt_image_aesthetic_image_id).toBe(stale.id)
  })
})
