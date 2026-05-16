/**
 * MOK-152 / KDS v3 phase 2 — integration tests for the screens CRUD routes.
 * Extended in MOK-154 / phase 2.5 with box-division coverage (cases 10-15).
 *
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T7), .planning/kds-v3/PHASE-2.5-PLAN.md (T5)
 *
 * Covers:
 *   Phase 2 (MOK-152):
 *     1. POST /screens — creates a screen
 *     2. POST /screens — 422 KDS_SCREEN_LIMIT_REACHED at cap of 2
 *     3. GET /screens — lists tenant's screens with box counts + cap info
 *     4. GET /screens/[id] — returns screen + boxes; 404 cross-tenant
 *     5. PUT /screens/[id] — replaces boxes atomically; position numbers stable
 *     6. PUT /screens/[id] — 422 KDS_SCREEN_LAYOUT_INVALID on overlap
 *     7. PUT /screens/[id] — 422 KDS_SCREEN_LAYOUT_INVALID on out-of-bounds
 *     8. DELETE /screens/[id] — cascade deletes boxes
 *     9. Tenant isolation — cross-tenant operations 404 / don't leak data
 *
 *   Phase 2.5 (MOK-154):
 *    10. PUT /screens/[id] — divided box round-trips (division + slot-B fields)
 *    11. PUT /screens/[id] — undivided → divided lifecycle
 *    12. PUT /screens/[id] — divided → undivided clears _b fields
 *    13. PUT /screens/[id] — 422 when divided but missing box_type_b
 *    14. PUT /screens/[id] — 422 when undivided but stray slot-B data
 *    15. PUT /screens/[id] — position stability across division toggle
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as listGET, POST as listPOST } from '@/app/api/admin/kds-v3/screens/route'
import {
  GET as itemGET,
  PUT as itemPUT,
  DELETE as itemDELETE,
} from '@/app/api/admin/kds-v3/screens/[id]/route'

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
  tenantA = await createTenantForTest('kds-v3-screens-a')
  tenantB = await createTenantForTest('kds-v3-screens-b')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function clearScreens(tenantId: string) {
  const supabase = getServiceClient()
  // FK CASCADE drops boxes when screens go.
  await supabase.from('kds_screens').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  await Promise.all([clearScreens(tenantA.id), clearScreens(tenantB.id)])
})

function createReq(tenant: TestTenant, body: unknown) {
  return buildAuthedRequest({
    tenant,
    method: 'POST',
    url: '/api/admin/kds-v3/screens',
    body,
  })
}

function listReq(tenant: TestTenant) {
  return buildAuthedRequest({
    tenant,
    method: 'GET',
    url: '/api/admin/kds-v3/screens',
  })
}

function itemReq(tenant: TestTenant, id: string, method: 'GET' | 'PUT' | 'DELETE', body?: unknown) {
  return buildAuthedRequest({
    tenant,
    method,
    url: `/api/admin/kds-v3/screens/${id}`,
    body,
  })
}

async function createScreen(tenant: TestTenant, name: string, rows = 4, cols = 6) {
  const res = await listPOST(
    createReq(tenant, { name, grid_rows: rows, grid_cols: cols, theme: 'warm' }),
  )
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body.success).toBe(true)
  return body.data as {
    id: string
    name: string
    grid_rows: number
    grid_cols: number
    theme: string
  }
}

describe('MOK-152 — kds-v3 screens routes', () => {
  // 1
  it('POST /screens creates a screen for the tenant', async () => {
    const created = await createScreen(tenantA, 'Drinks')
    expect(created.name).toBe('Drinks')
    expect(created.grid_rows).toBe(4)
    expect(created.grid_cols).toBe(6)
    expect(created.theme).toBe('warm')

    const supabase = getServiceClient()
    const { data } = await supabase
      .from('kds_screens')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(data ?? []).toHaveLength(1)
  })

  // 2
  it('POST /screens returns 422 KDS_SCREEN_LIMIT_REACHED at the cap of 2', async () => {
    await createScreen(tenantA, 'Drinks')
    await createScreen(tenantA, 'Food')

    const res = await listPOST(createReq(tenantA, { name: 'Extra', grid_rows: 2, grid_cols: 2 }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_LIMIT_REACHED')
  })

  // 3
  it('GET /screens lists tenant screens with box counts + cap info', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    // Seed two boxes directly
    const supabase = getServiceClient()
    await supabase.from('kds_grid_boxes').insert([
      {
        tenant_id: tenantA.id,
        screen_id: drinks.id,
        position: 1,
        row_start: 1,
        col_start: 1,
        row_span: 1,
        col_span: 1,
        box_type: 'menu_group',
      },
      {
        tenant_id: tenantA.id,
        screen_id: drinks.id,
        position: 2,
        row_start: 1,
        col_start: 2,
        row_span: 1,
        col_span: 1,
        box_type: 'image_only',
      },
    ])

    const res = await listGET(listReq(tenantA))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].box_count).toBe(2)
    expect(body.cap).toEqual({ current: 1, max: 2, reached: false })
  })

  // 4 (and tenant isolation on read)
  it('GET /screens/[id] returns screen+boxes; cross-tenant returns 404', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')

    const res = await itemGET(
      itemReq(tenantA, drinks.id, 'GET'),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.boxes).toEqual([])

    // Cross-tenant
    const crossRes = await itemGET(
      itemReq(tenantB, drinks.id, 'GET'),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(crossRes.status).toBe(404)
  })

  // 5
  it('PUT /screens/[id] replaces boxes atomically and preserves stable position numbers', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')

    // Initial: 3 boxes at positions 1, 2, 3
    const initialPut = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'menu_group' },
          { position: 2, row_start: 1, col_start: 2, row_span: 1, col_span: 1, box_type: 'menu_group' },
          { position: 3, row_start: 1, col_start: 3, row_span: 1, col_span: 1, box_type: 'image_only' },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(initialPut.status).toBe(200)

    // Now delete position 2; box at position 3 should keep its position number (NOT renumber to 2).
    const updated = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'menu_group' },
          { position: 3, row_start: 1, col_start: 3, row_span: 1, col_span: 1, box_type: 'image_only' },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(updated.status).toBe(200)
    const updatedBody = await updated.json()
    const positions = (updatedBody.data.boxes as Array<{ position: number }>).map((b) => b.position).sort()
    expect(positions).toEqual([1, 3]) // gap preserved — NOT compacted to [1, 2]
  })

  // 6
  it('PUT /screens/[id] returns 422 KDS_SCREEN_LAYOUT_INVALID on overlap', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const res = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 2, col_span: 2, box_type: 'menu_group' },
          { position: 2, row_start: 2, col_start: 2, row_span: 2, col_span: 2, box_type: 'menu_group' }, // overlaps at (2,2)
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_LAYOUT_INVALID')
    expect((body.validation_errors as string[]).some((e) => /overlap/.test(e))).toBe(true)
  })

  // 7
  it('PUT /screens/[id] returns 422 when a box exceeds grid bounds', async () => {
    const drinks = await createScreen(tenantA, 'Drinks', 4, 6)
    const res = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 6, row_span: 1, col_span: 3, box_type: 'menu_group' }, // col 6..8 on 6-col grid
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_LAYOUT_INVALID')
    expect((body.validation_errors as string[]).some((e) => /extends beyond/.test(e))).toBe(true)
  })

  // 8
  it('DELETE /screens/[id] cascade-deletes boxes', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const supabase = getServiceClient()
    await supabase.from('kds_grid_boxes').insert({
      tenant_id: tenantA.id,
      screen_id: drinks.id,
      position: 1,
      row_start: 1,
      col_start: 1,
      row_span: 1,
      col_span: 1,
      box_type: 'menu_group',
    })

    const res = await itemDELETE(
      itemReq(tenantA, drinks.id, 'DELETE'),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(200)

    const { data: boxes } = await supabase
      .from('kds_grid_boxes')
      .select('id')
      .eq('screen_id', drinks.id)
    expect(boxes ?? []).toHaveLength(0)
  })

  // 9
  it('tenant isolation: tenant A cannot mutate tenant B screens', async () => {
    const drinks = await createScreen(tenantB, 'Drinks')

    // Cross-tenant PUT
    const putRes = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', { name: 'Stolen' }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(putRes.status).toBe(404)

    // Cross-tenant DELETE
    const delRes = await itemDELETE(
      itemReq(tenantA, drinks.id, 'DELETE'),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(delRes.status).toBe(404)

    // Confirm tenant B's screen still exists and is unmodified
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('kds_screens')
      .select('name')
      .eq('id', drinks.id)
      .single()
    expect(data?.name).toBe('Drinks')
  })

  // ───────────────────────────────────────────────────────────────────────
  // MOK-154 — phase 2.5 box division. Same test file (integration suite is
  // organized per route, not per spec).
  // ───────────────────────────────────────────────────────────────────────

  // T5 #1 — divided box round-trips
  it('PUT /screens/[id] persists division=vertical + slot-B fields', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')

    const putRes = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 2,
            box_type: 'menu_group',
            division: 'vertical',
            box_type_b: 'image_only',
            header_override_b: 'Specials',
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(putRes.status).toBe(200)

    // GET back and check the row reflects the slot-B fields
    const getRes = await itemGET(
      itemReq(tenantA, drinks.id, 'GET'),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    const body = await getRes.json()
    const boxes = body.data.boxes as Array<{
      position: number
      division: string
      box_type_b: string | null
      header_override_b: string | null
    }>
    expect(boxes).toHaveLength(1)
    expect(boxes[0].division).toBe('vertical')
    expect(boxes[0].box_type_b).toBe('image_only')
    expect(boxes[0].header_override_b).toBe('Specials')
  })

  // T5 #2 — undivided → divided lifecycle
  it('PUT /screens/[id] transitions an undivided box to divided', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')

    // First save: undivided
    await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 2, col_span: 1, box_type: 'menu_group' },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )

    // Second save: same position, now divided horizontally
    const putRes = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 2,
            col_span: 1,
            box_type: 'menu_group',
            division: 'horizontal',
            box_type_b: 'image_only',
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(putRes.status).toBe(200)
    const body = await putRes.json()
    const boxes = body.data.boxes as Array<{ position: number; division: string; box_type_b: string | null }>
    expect(boxes[0].position).toBe(1)
    expect(boxes[0].division).toBe('horizontal')
    expect(boxes[0].box_type_b).toBe('image_only')
  })

  // T5 #3 — divided → undivided clears _b fields
  it('PUT /screens/[id] clears slot-B fields when reverting to division=none', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')

    // Save divided first
    await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 2,
            box_type: 'menu_group',
            division: 'vertical',
            box_type_b: 'image_only',
            header_override_b: 'temp',
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )

    // Revert to undivided. PUT semantics replace boxes wholesale.
    const putRes = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 2,
            box_type: 'menu_group',
            division: 'none',
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(putRes.status).toBe(200)

    // Confirm via raw DB select that slot-B columns are NULL on the saved row.
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('kds_grid_boxes')
      .select('division, box_type_b, header_override_b, square_menu_group_id_b, aesthetic_image_id_b')
      .eq('screen_id', drinks.id)
      .eq('position', 1)
      .single()
    expect(data?.division).toBe('none')
    expect(data?.box_type_b).toBeNull()
    expect(data?.header_override_b).toBeNull()
    expect(data?.square_menu_group_id_b).toBeNull()
    expect(data?.aesthetic_image_id_b).toBeNull()
  })

  // T5 #4 — invariant rejection: divided but missing box_type_b
  it('PUT /screens/[id] returns 422 when divided box lacks box_type_b', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')

    const res = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 2,
            col_span: 1,
            box_type: 'menu_group',
            division: 'horizontal',
            // box_type_b intentionally omitted
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_LAYOUT_INVALID')
    expect((body.validation_errors as string[]).some((e) => /box_type_b is not set/.test(e))).toBe(true)
  })

  // T5 #5 — invariant rejection: undivided but stray _b set
  it('PUT /screens/[id] returns 422 when undivided box has stray slot-B data', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')

    const res = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'menu_group',
            division: 'none',
            box_type_b: 'image_only', // stray
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_LAYOUT_INVALID')
    expect((body.validation_errors as string[]).some((e) => /slot-B fields are populated/.test(e))).toBe(true)
  })

  // T5 #6 — position stability across division toggle
  it('PUT /screens/[id] preserves position numbers across division toggle', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')

    // Three boxes; mark middle one as divided
    const initial = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'menu_group' },
          { position: 2, row_start: 1, col_start: 2, row_span: 1, col_span: 2, box_type: 'menu_group', division: 'vertical', box_type_b: 'image_only' },
          { position: 3, row_start: 2, col_start: 1, row_span: 1, col_span: 1, box_type: 'image_only' },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(initial.status).toBe(200)

    // Toggle box 2 back to undivided
    const updated = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'menu_group' },
          { position: 2, row_start: 1, col_start: 2, row_span: 1, col_span: 2, box_type: 'menu_group', division: 'none' },
          { position: 3, row_start: 2, col_start: 1, row_span: 1, col_span: 1, box_type: 'image_only' },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(updated.status).toBe(200)
    const body = await updated.json()
    const positions = (body.data.boxes as Array<{ position: number; division: string }>).sort(
      (a, b) => a.position - b.position,
    )
    expect(positions.map((b) => b.position)).toEqual([1, 2, 3]) // unchanged
    expect(positions[1].division).toBe('none')
  })
})
