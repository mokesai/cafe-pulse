/**
 * MOK-152 / KDS v3 phase 2 — integration tests for the screens CRUD routes.
 * Extended in MOK-154 (phase 2.5 box division) and MOK-155 (phase 3
 * menu-group binding).
 *
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T7),
 *       .planning/kds-v3/PHASE-2.5-PLAN.md (T5),
 *       .planning/kds-v3/PHASE-3-PLAN.md (T4)
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
 *
 *   Phase 3 (MOK-155):
 *    16. PUT /screens/[id] — square_menu_group_id + header_override round-trip
 *    17. PUT /screens/[id] — unbind (NULL) clears the binding
 *    18. PUT /screens/[id] — slot-A + slot-B bindings on a divided box
 *    19. PUT /screens/[id] — cross-tenant rejection (422)
 *    20. PUT /screens/[id] — 400 when image_only slot carries a group binding
 *    21. PUT /screens/[id] — 422 when binding to a fabricated id
 *    22. PUT /screens/[id] — accepts binding to is_deleted=true group
 *    23. PUT /screens/[id] — position stability across binding changes
 *
 *   Phase 4 (MOK-156):
 *    24. PUT /screens/[id] — aesthetic_image_id + header_override round-trip
 *    25. PUT /screens/[id] — cross-tenant image binding (422)
 *    26. PUT /screens/[id] — 400 when menu_group slot carries an image binding
 *    27. PUT /screens/[id] — 422 when binding to a fabricated image id
 *    28. PUT /screens/[id] — accepts binding to is_deleted=true image
 *    29. PUT /screens/[id] — position stability across image-binding changes
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
  seedTestMenuGroup,
  seedTestAestheticImage,
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

async function clearMenuMirror(tenantId: string) {
  const supabase = getServiceClient()
  await supabase.from('square_menu_item_categories').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_items').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_categories').delete().eq('tenant_id', tenantId)
}

async function clearImages(tenantId: string) {
  // Must run AFTER clearScreens because kds_grid_boxes references
  // kds_aesthetic_images via FK (ON DELETE SET NULL). If we delete images
  // first while boxes still reference them, the FK trigger fires and
  // nulls those columns — harmless but extra work.
  const supabase = getServiceClient()
  await supabase.from('kds_aesthetic_images').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  // Order: screens first (which cascades boxes), then images.
  await Promise.all([clearScreens(tenantA.id), clearScreens(tenantB.id)])
  await Promise.all([
    clearMenuMirror(tenantA.id),
    clearMenuMirror(tenantB.id),
    clearImages(tenantA.id),
    clearImages(tenantB.id),
  ])
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

  // ───────────────────────────────────────────────────────────────────────
  // MOK-155 — phase 3 menu group binding. Tests #16-23.
  // ───────────────────────────────────────────────────────────────────────

  // T4 #16
  it('PUT /screens/[id] persists square_menu_group_id and header_override on slot A', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const hot = await seedTestMenuGroup(tenantA, { name: 'Hot Drinks' })

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
            square_menu_group_id: hot.id,
            header_override: '☕ Brewed Hot',
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    const box = (body.data.boxes as Array<{ square_menu_group_id: string; header_override: string }>)[0]
    expect(box.square_menu_group_id).toBe(hot.id)
    expect(box.header_override).toBe('☕ Brewed Hot')
  })

  // T4 #17
  it('PUT /screens/[id] clears the menu-group binding when square_menu_group_id is null', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const hot = await seedTestMenuGroup(tenantA, { name: 'Hot Drinks' })

    await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'menu_group', square_menu_group_id: hot.id },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    const unbind = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'menu_group', square_menu_group_id: null },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(unbind.status).toBe(200)
    const body = await unbind.json()
    const box = (body.data.boxes as Array<{ square_menu_group_id: string | null }>)[0]
    expect(box.square_menu_group_id).toBeNull()
  })

  // T4 #18
  it('PUT /screens/[id] persists slot-A and slot-B menu-group bindings on a divided box', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const hot = await seedTestMenuGroup(tenantA, { name: 'Hot Drinks' })
    const cold = await seedTestMenuGroup(tenantA, { name: 'Cold Drinks' })

    const res = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 2,
            box_type: 'menu_group',
            square_menu_group_id: hot.id,
            header_override: 'Hot',
            division: 'vertical',
            box_type_b: 'menu_group',
            square_menu_group_id_b: cold.id,
            header_override_b: 'Cold',
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    const box = (body.data.boxes as Array<{
      square_menu_group_id: string
      square_menu_group_id_b: string
      header_override: string
      header_override_b: string
    }>)[0]
    expect(box.square_menu_group_id).toBe(hot.id)
    expect(box.square_menu_group_id_b).toBe(cold.id)
    expect(box.header_override).toBe('Hot')
    expect(box.header_override_b).toBe('Cold')
  })

  // T4 #19 — cross-tenant rejection (load-bearing security boundary)
  it('PUT /screens/[id] returns 422 when binding to a square_menu_group_id from another tenant', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const bGroup = await seedTestMenuGroup(tenantB, { name: 'B-only group' })

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
            square_menu_group_id: bGroup.id, // belongs to tenant B
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_LAYOUT_INVALID')
    expect(
      (body.validation_errors as string[]).some((e) =>
        e.includes(bGroup.id) && /does not exist for this tenant/.test(e),
      ),
    ).toBe(true)
  })

  // T4 #20 — image_only-with-group rejection
  it('PUT /screens/[id] returns 400 when image_only slot carries square_menu_group_id', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const hot = await seedTestMenuGroup(tenantA, { name: 'Hot Drinks' })

    const res = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'image_only',
            square_menu_group_id: hot.id, // illegal on image_only
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(
      (body.validation_errors as string[]).some((e) => /image_only/.test(e)),
    ).toBe(true)
  })

  // T4 #21 — nonexistent-group rejection
  it('PUT /screens/[id] returns 422 when binding to a fabricated square_menu_group_id', async () => {
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
            square_menu_group_id: 'fabricated-id-that-doesnt-exist',
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_LAYOUT_INVALID')
    expect(
      (body.validation_errors as string[]).some((e) =>
        e.includes('fabricated-id-that-doesnt-exist'),
      ),
    ).toBe(true)
  })

  // T4 #22 — bound group with is_deleted=true accepted (binding stays for operator's awareness)
  it('PUT /screens/[id] accepts a binding to an is_deleted=true menu group', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const stale = await seedTestMenuGroup(tenantA, { name: 'Pastries', is_deleted: true })

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
            square_menu_group_id: stale.id,
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect((body.data.boxes as Array<{ square_menu_group_id: string }>)[0].square_menu_group_id).toBe(
      stale.id,
    )
  })

  // T4 #23 — position stability across menu-group binding changes
  it('PUT /screens/[id] preserves position numbers when changing menu-group bindings', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const hot = await seedTestMenuGroup(tenantA, { name: 'Hot Drinks' })
    const cold = await seedTestMenuGroup(tenantA, { name: 'Cold Drinks' })

    // Initial: 3 boxes, only box 2 bound
    await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'menu_group' },
          { position: 2, row_start: 1, col_start: 2, row_span: 1, col_span: 1, box_type: 'menu_group', square_menu_group_id: hot.id },
          { position: 3, row_start: 1, col_start: 3, row_span: 1, col_span: 1, box_type: 'menu_group' },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )

    // Now rebind box 2 to a different group + bind box 3 too
    const updated = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'menu_group' },
          { position: 2, row_start: 1, col_start: 2, row_span: 1, col_span: 1, box_type: 'menu_group', square_menu_group_id: cold.id },
          { position: 3, row_start: 1, col_start: 3, row_span: 1, col_span: 1, box_type: 'menu_group', square_menu_group_id: hot.id },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(updated.status).toBe(200)
    const body = await updated.json()
    const boxes = (body.data.boxes as Array<{ position: number; square_menu_group_id: string | null }>)
      .sort((a, b) => a.position - b.position)
    expect(boxes.map((b) => b.position)).toEqual([1, 2, 3])
    expect(boxes[0].square_menu_group_id).toBeNull()
    expect(boxes[1].square_menu_group_id).toBe(cold.id)
    expect(boxes[2].square_menu_group_id).toBe(hot.id)
  })

  // ───────────────────────────────────────────────────────────────────────
  // MOK-156 — phase 4 aesthetic image binding. Tests #24-29.
  // ───────────────────────────────────────────────────────────────────────

  // T8 #24
  it('PUT /screens/[id] persists aesthetic_image_id on image_only slot', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const banner = await seedTestAestheticImage(tenantA, { name: 'Banner' })

    const res = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'image_only',
            aesthetic_image_id: banner.id,
            header_override: 'Welcome',
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    const box = (body.data.boxes as Array<{ aesthetic_image_id: string; header_override: string }>)[0]
    expect(box.aesthetic_image_id).toBe(banner.id)
    expect(box.header_override).toBe('Welcome')
  })

  // T8 #25 — cross-tenant rejection
  it('PUT /screens/[id] returns 422 when binding to a cross-tenant aesthetic_image_id', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const bImg = await seedTestAestheticImage(tenantB, { name: 'B image' })

    const res = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'image_only',
            aesthetic_image_id: bImg.id,
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_LAYOUT_INVALID')
    expect(
      (body.validation_errors as string[]).some(
        (e) => e.includes(bImg.id) && /does not exist for this tenant/.test(e),
      ),
    ).toBe(true)
  })

  // T8 #26 — menu_group-with-image rejection
  it('PUT /screens/[id] returns 400 when menu_group slot has aesthetic_image_id', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const img = await seedTestAestheticImage(tenantA, { name: 'Stray' })

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
            aesthetic_image_id: img.id, // illegal on menu_group
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(
      (body.validation_errors as string[]).some((e) =>
        /aesthetic_image_id must be null when box_type='menu_group'/.test(e),
      ),
    ).toBe(true)
  })

  // T8 #27 — fabricated image id rejection
  it('PUT /screens/[id] returns 422 when binding to a fabricated aesthetic_image_id', async () => {
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
            box_type: 'image_only',
            aesthetic_image_id: '00000000-0000-0000-0000-000000000001',
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_LAYOUT_INVALID')
    expect(
      (body.validation_errors as string[]).some((e) =>
        e.includes('00000000-0000-0000-0000-000000000001'),
      ),
    ).toBe(true)
  })

  // T8 #28 — bound to is_deleted=true image accepted
  it('PUT /screens/[id] accepts a binding to an is_deleted=true aesthetic image', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const stale = await seedTestAestheticImage(tenantA, { name: 'Stale', is_deleted: true })

    const res = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'image_only',
            aesthetic_image_id: stale.id,
          },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect((body.data.boxes as Array<{ aesthetic_image_id: string }>)[0].aesthetic_image_id).toBe(
      stale.id,
    )
  })

  // T8 #29 — position stability across image-binding changes
  it('PUT /screens/[id] preserves position numbers when changing image bindings', async () => {
    const drinks = await createScreen(tenantA, 'Drinks')
    const a = await seedTestAestheticImage(tenantA, { name: 'A' })
    const b = await seedTestAestheticImage(tenantA, { name: 'B' })

    await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'image_only' },
          { position: 2, row_start: 1, col_start: 2, row_span: 1, col_span: 1, box_type: 'image_only', aesthetic_image_id: a.id },
          { position: 3, row_start: 1, col_start: 3, row_span: 1, col_span: 1, box_type: 'image_only' },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )

    const updated = await itemPUT(
      itemReq(tenantA, drinks.id, 'PUT', {
        boxes: [
          { position: 1, row_start: 1, col_start: 1, row_span: 1, col_span: 1, box_type: 'image_only' },
          { position: 2, row_start: 1, col_start: 2, row_span: 1, col_span: 1, box_type: 'image_only', aesthetic_image_id: b.id },
          { position: 3, row_start: 1, col_start: 3, row_span: 1, col_span: 1, box_type: 'image_only', aesthetic_image_id: a.id },
        ],
      }),
      { params: Promise.resolve({ id: drinks.id }) },
    )
    expect(updated.status).toBe(200)
    const body = await updated.json()
    const boxes = (body.data.boxes as Array<{ position: number; aesthetic_image_id: string | null }>)
      .sort((x, y) => x.position - y.position)
    expect(boxes.map((bx) => bx.position)).toEqual([1, 2, 3])
    expect(boxes[0].aesthetic_image_id).toBeNull()
    expect(boxes[1].aesthetic_image_id).toBe(b.id)
    expect(boxes[2].aesthetic_image_id).toBe(a.id)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // MOK-158 phase 6 — layout / price / whitespace round-trip + validation
  // ─────────────────────────────────────────────────────────────────────────

  // T11 #30 — slot-A layout / price / whitespace round-trips cleanly
  it('PUT /screens/[id] persists slot-A layout_mode + price_display_mode + density + title_size + title_align', async () => {
    const screen = await createScreen(tenantA, 'P6 Slot A')
    const res = await itemPUT(
      itemReq(tenantA, screen.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'menu_group',
            layout_mode: 'flavor_list',
            price_display_mode: 'base',
            density: 'compact',
            title_size: 'large',
            title_align: 'center',
          },
        ],
      }),
      { params: Promise.resolve({ id: screen.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    const box = body.data.boxes[0]
    expect(box.layout_mode).toBe('flavor_list')
    expect(box.price_display_mode).toBe('base')
    expect(box.density).toBe('compact')
    expect(box.title_size).toBe('large')
    expect(box.title_align).toBe('center')
    // Undivided box → all slot-B formatting columns null
    expect(box.layout_mode_b).toBeNull()
    expect(box.price_display_mode_b).toBeNull()
    expect(box.density_b).toBeNull()
    expect(box.title_size_b).toBeNull()
    expect(box.title_align_b).toBeNull()
  })

  // T11 #31 — divided box round-trips distinct slot-A vs slot-B formatting
  it('PUT /screens/[id] round-trips a divided box with distinct slot-A vs slot-B layout/density combos', async () => {
    const screen = await createScreen(tenantA, 'P6 Divided')
    const res = await itemPUT(
      itemReq(tenantA, screen.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 2,
            col_span: 2,
            box_type: 'menu_group',
            division: 'horizontal',
            box_type_b: 'menu_group',
            layout_mode: 'variation_column_header',
            density: 'loose',
            title_size: 'large',
            title_align: 'left',
            layout_mode_b: 'compact_list',
            density_b: 'compact',
            title_size_b: 'small',
            title_align_b: 'right',
          },
        ],
      }),
      { params: Promise.resolve({ id: screen.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    const box = body.data.boxes[0]
    expect(box.layout_mode).toBe('variation_column_header')
    expect(box.density).toBe('loose')
    expect(box.title_size).toBe('large')
    expect(box.layout_mode_b).toBe('compact_list')
    expect(box.density_b).toBe('compact')
    expect(box.title_size_b).toBe('small')
    expect(box.title_align_b).toBe('right')
    // Default price_display_mode applied to slot B since not specified
    expect(box.price_display_mode_b).toBe('lowest')
  })

  // Phase 6 addendum #33 — featured_list + subtitle + box chrome round-trip
  it('PUT /screens/[id] persists featured_list + subtitle_override + per-box chrome', async () => {
    const screen = await createScreen(tenantA, 'P6 Featured')
    const res = await itemPUT(
      itemReq(tenantA, screen.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'menu_group',
            layout_mode: 'featured_list',
            subtitle_override: 'Popular Flavors',
            box_border: 'thick',
            box_radius: 'lg',
            box_background: 'accent',
          },
        ],
      }),
      { params: Promise.resolve({ id: screen.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    const box = body.data.boxes[0]
    expect(box.layout_mode).toBe('featured_list')
    expect(box.subtitle_override).toBe('Popular Flavors')
    expect(box.box_border).toBe('thick')
    expect(box.box_radius).toBe('lg')
    expect(box.box_background).toBe('accent')
    // subtitle_override_b must be null when undivided.
    expect(box.subtitle_override_b).toBeNull()
  })

  // Phase 6 addendum #34 — chrome defaults on existing boxes
  it('PUT /screens/[id] defaults box chrome to "none" when not provided', async () => {
    const screen = await createScreen(tenantA, 'P6 Chrome Default')
    const res = await itemPUT(
      itemReq(tenantA, screen.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'menu_group',
          },
        ],
      }),
      { params: Promise.resolve({ id: screen.id }) },
    )
    expect(res.status).toBe(200)
    const box = (await res.json()).data.boxes[0]
    expect(box.box_border).toBe('none')
    expect(box.box_radius).toBe('none')
    expect(box.box_background).toBe('none')
    expect(box.subtitle_override).toBeNull()
  })

  // Phase 6 addendum #35 — invalid chrome value rejected
  it('PUT /screens/[id] returns 400 when box_background is not a recognized enum', async () => {
    const screen = await createScreen(tenantA, 'P6 Bad Chrome')
    const res = await itemPUT(
      itemReq(tenantA, screen.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'menu_group',
            box_background: 'neon-pink',
          },
        ],
      }),
      { params: Promise.resolve({ id: screen.id }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_BAD_REQUEST')
    expect(body.error).toContain('box_background')
  })

  // T11 #32 — invalid enum value rejected at route layer with structured error
  it('PUT /screens/[id] returns 400 when layout_mode is not a recognized enum', async () => {
    const screen = await createScreen(tenantA, 'P6 Bad Enum')
    const res = await itemPUT(
      itemReq(tenantA, screen.id, 'PUT', {
        boxes: [
          {
            position: 1,
            row_start: 1,
            col_start: 1,
            row_span: 1,
            col_span: 1,
            box_type: 'menu_group',
            layout_mode: 'not_a_layout',
          },
        ],
      }),
      { params: Promise.resolve({ id: screen.id }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_BAD_REQUEST')
    expect(body.error).toContain('layout_mode')
  })
})
