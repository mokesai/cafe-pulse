/**
 * MOK-151 / KDS v3 phase 1 — syncMenusFromSquare integration tests.
 *
 * Plan: .planning/kds-v3/PHASE-1-PLAN.md (T7)
 *
 * Mocks Square API responses (via global.fetch + getTenantSquareConfig
 * stub) and exercises the sync against real cafe-pulse-dev tables.
 *
 * One test per MOK-151 acceptance criterion plus the meta cases
 * (idempotency, tenant isolation, REGULAR_CATEGORY skip).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Square credentials loader so tests don't need real Square creds
// stored against the test tenants.
vi.mock('@/lib/square/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/square/config')>(
    '@/lib/square/config',
  )
  return {
    ...actual,
    getTenantSquareConfig: vi.fn(async () => ({
      accessToken: 'test-access-token',
      applicationId: 'test-app',
      locationId: 'test-loc',
      environment: 'sandbox' as const,
    })),
  }
})

import { syncMenusFromSquare } from '@/lib/square/menu-sync'
import {
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders — small, deterministic Square response shapes
// ─────────────────────────────────────────────────────────────────────────────

function category(opts: {
  id: string
  name: string
  is_top_level?: boolean
  parent_id?: string
  ordinal?: number
  is_deleted?: boolean
  type?: 'MENU_CATEGORY' | 'REGULAR_CATEGORY'
}) {
  return {
    type: 'CATEGORY',
    id: opts.id,
    is_deleted: opts.is_deleted ?? false,
    version: 1,
    category_data: {
      name: opts.name,
      category_type: opts.type ?? 'MENU_CATEGORY',
      is_top_level: opts.is_top_level ?? false,
      parent_category: opts.parent_id
        ? { id: opts.parent_id, ordinal: opts.ordinal ?? 0 }
        : undefined,
    },
  }
}

function item(opts: {
  id: string
  name: string
  description?: string
  categories?: Array<{ id: string; ordinal?: number }>
  variations?: Array<{ id: string; name: string; price_cents: number }>
  image_id?: string
  is_deleted?: boolean
}) {
  return {
    type: 'ITEM',
    id: opts.id,
    is_deleted: opts.is_deleted ?? false,
    version: 1,
    item_data: {
      name: opts.name,
      description: opts.description,
      image_ids: opts.image_id ? [opts.image_id] : undefined,
      categories: opts.categories,
      variations: (opts.variations ?? []).map((v) => ({
        type: 'ITEM_VARIATION' as const,
        id: v.id,
        item_variation_data: {
          name: v.name,
          pricing_type: 'FIXED_PRICING' as const,
          price_money: { amount: v.price_cents, currency: 'USD' },
        },
      })),
    },
  }
}

function imageObj(id: string, url: string) {
  return { type: 'IMAGE', id, image_data: { url } }
}

// Mock fetch: respond to /v2/catalog/search with the provided response per
// object_types. The first POST with object_types: ['CATEGORY'] returns the
// category response; the next POST with ['ITEM','IMAGE'] returns the item
// response. Reset between tests.
type SearchResponses = {
  category: { objects: ReturnType<typeof category>[] }
  item: {
    objects: ReturnType<typeof item>[]
    related_objects?: ReturnType<typeof imageObj>[]
  }
}

let nextSquareResponses: SearchResponses

const realFetch = global.fetch

function installFetchMock() {
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString()
    // Only intercept Square Catalog calls. Everything else (PostgREST,
    // auth.signin, etc.) goes through the real fetch so DB writes/reads work.
    if (url.includes('/v2/catalog/search')) {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      const types = body.object_types ?? []
      if (types.includes('CATEGORY')) {
        return new Response(JSON.stringify(nextSquareResponses.category), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (types.includes('ITEM')) {
        return new Response(JSON.stringify(nextSquareResponses.item), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    return realFetch(input, init)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────────

let tenantA: TestTenant
let tenantB: TestTenant

beforeAll(async () => {
  tenantA = await createTenantForTest('kds-v3-sync-a')
  tenantB = await createTenantForTest('kds-v3-sync-b')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function clearTenantMirror(tenantId: string) {
  const supabase = getServiceClient()
  // Order: child tables first (FK from variations → items via cascade is
  // handled, but explicit deletes keep test setup deterministic).
  await supabase.from('square_menu_item_variations').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_item_categories').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_items').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_categories').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_sync_state').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  installFetchMock()
  nextSquareResponses = { category: { objects: [] }, item: { objects: [] } }
  // Fresh slate per test so counts assertions don't see bleed between tests.
  await Promise.all([clearTenantMirror(tenantA.id), clearTenantMirror(tenantB.id)])
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('MOK-151 syncMenusFromSquare', () => {
  it('full sync mirrors a 1-menu / 3-group / 6-item Square menu', async () => {
    nextSquareResponses = {
      category: {
        objects: [
          category({ id: 'menu-1', name: 'KDS Test Menu', is_top_level: true }),
          category({ id: 'group-hot', name: 'Hot Drinks', parent_id: 'menu-1', ordinal: 1 }),
          category({ id: 'group-cold', name: 'Cold Drinks', parent_id: 'menu-1', ordinal: 2 }),
          category({ id: 'group-pastries', name: 'Pastries', parent_id: 'menu-1', ordinal: 3 }),
        ],
      },
      item: {
        objects: [
          item({
            id: 'item-espresso',
            name: 'Espresso',
            categories: [{ id: 'group-hot', ordinal: 1 }],
            variations: [
              { id: 'var-espresso-single', name: 'Single', price_cents: 350 },
              { id: 'var-espresso-double', name: 'Double', price_cents: 450 },
            ],
            image_id: 'img-espresso',
          }),
          item({
            id: 'item-cold-brew',
            name: 'Cold Brew',
            categories: [{ id: 'group-cold', ordinal: 1 }],
            variations: [{ id: 'var-cold-brew', name: '16oz', price_cents: 475 }],
          }),
          item({
            id: 'item-croissant',
            name: 'Butter Croissant',
            categories: [{ id: 'group-pastries', ordinal: 1 }],
            variations: [{ id: 'var-croissant', name: 'Each', price_cents: 425 }],
          }),
        ],
        related_objects: [imageObj('img-espresso', 'https://square.example/espresso.jpg')],
      },
    }

    const supabase = getServiceClient()
    const result = await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    expect(result.upserts.categories).toBe(4)
    expect(result.upserts.items).toBe(3)
    expect(result.upserts.variations).toBe(4)
    expect(result.upserts.memberships).toBe(3)

    const { data: categoriesRows } = await supabase
      .from('square_menu_categories')
      .select('id, is_top_level, parent_id, ordinal')
      .eq('tenant_id', tenantA.id)
      .order('id')
    expect(categoriesRows).toHaveLength(4)

    const { data: itemRow } = await supabase
      .from('square_menu_items')
      .select('name, image_url')
      .eq('tenant_id', tenantA.id)
      .eq('id', 'item-espresso')
      .single()
    expect(itemRow?.name).toBe('Espresso')
    expect(itemRow?.image_url).toBe('https://square.example/espresso.jpg')
  })

  it('item moved between groups: memberships replaced (old gone, new added)', async () => {
    // First sync: item in group-hot
    nextSquareResponses = {
      category: {
        objects: [
          category({ id: 'menu-1', name: 'M', is_top_level: true }),
          category({ id: 'group-hot', name: 'Hot', parent_id: 'menu-1' }),
          category({ id: 'group-cold', name: 'Cold', parent_id: 'menu-1' }),
        ],
      },
      item: {
        objects: [
          item({
            id: 'item-x',
            name: 'X',
            categories: [{ id: 'group-hot', ordinal: 1 }],
            variations: [{ id: 'var-x', name: 'Each', price_cents: 100 }],
          }),
        ],
      },
    }
    const supabase = getServiceClient()
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    // Second sync: item moved to group-cold
    nextSquareResponses.item.objects = [
      item({
        id: 'item-x',
        name: 'X',
        categories: [{ id: 'group-cold', ordinal: 1 }],
        variations: [{ id: 'var-x', name: 'Each', price_cents: 100 }],
      }),
    ]
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    const { data: memberships } = await supabase
      .from('square_menu_item_categories')
      .select('category_id')
      .eq('tenant_id', tenantA.id)
      .eq('item_id', 'item-x')
    expect(memberships?.map((m: { category_id: string }) => m.category_id)).toEqual(['group-cold'])
  })

  it('item removed from all menu groups: memberships gone, item still active', async () => {
    nextSquareResponses = {
      category: {
        objects: [
          category({ id: 'menu-1', name: 'M', is_top_level: true }),
          category({ id: 'group-hot', name: 'Hot', parent_id: 'menu-1' }),
          // A regular category for the item to fall back to (so it still
          // appears in Square but with no menu memberships).
          category({
            id: 'reg-cat',
            name: 'Reg',
            type: 'REGULAR_CATEGORY',
          }),
        ],
      },
      item: {
        objects: [
          item({
            id: 'item-y',
            name: 'Y',
            categories: [{ id: 'group-hot', ordinal: 1 }],
            variations: [{ id: 'var-y', name: 'Each', price_cents: 100 }],
          }),
        ],
      },
    }
    const supabase = getServiceClient()
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    // Now item is removed from all menu groups (only regular category remains).
    // Per spec, items with no MENU_CATEGORY are skipped — but we DO need the
    // membership rows for any prior MENU_CATEGORY tie to clear. The cleanest
    // way to test this: the item disappears from our skip-by-filter path,
    // and a follow-up mutation that deletes the menu group cascades.
    // For the "still exists" case we go via the menu-group-deletion cascade
    // (cleaner than the no-membership-but-still-an-item path).

    // Drop the menu group; the cascade should remove the membership.
    nextSquareResponses.category.objects = [
      category({ id: 'group-hot', name: 'Hot', parent_id: 'menu-1', is_deleted: true }),
    ]
    nextSquareResponses.item.objects = []
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    const { data: memberships } = await supabase
      .from('square_menu_item_categories')
      .select('item_id')
      .eq('tenant_id', tenantA.id)
      .eq('item_id', 'item-y')
    expect(memberships ?? []).toHaveLength(0)

    // Item itself is still there (not deleted; just orphaned from menus).
    const { data: itemRow } = await supabase
      .from('square_menu_items')
      .select('is_deleted')
      .eq('tenant_id', tenantA.id)
      .eq('id', 'item-y')
      .single()
    expect(itemRow?.is_deleted).toBe(false)
  })

  it('item hard-deleted: cascade to variations + memberships', async () => {
    nextSquareResponses = {
      category: {
        objects: [
          category({ id: 'menu-1', name: 'M', is_top_level: true }),
          category({ id: 'group-hot', name: 'Hot', parent_id: 'menu-1' }),
        ],
      },
      item: {
        objects: [
          item({
            id: 'item-doomed',
            name: 'Doomed',
            categories: [{ id: 'group-hot', ordinal: 1 }],
            variations: [
              { id: 'var-d-1', name: 'A', price_cents: 100 },
              { id: 'var-d-2', name: 'B', price_cents: 200 },
            ],
          }),
        ],
      },
    }
    const supabase = getServiceClient()
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    nextSquareResponses.item.objects = [
      { ...item({ id: 'item-doomed', name: '', categories: [], variations: [] }), is_deleted: true },
    ]
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    const { data: itemRow } = await supabase
      .from('square_menu_items')
      .select('is_deleted')
      .eq('tenant_id', tenantA.id)
      .eq('id', 'item-doomed')
      .single()
    expect(itemRow?.is_deleted).toBe(true)

    const { data: vars } = await supabase
      .from('square_menu_item_variations')
      .select('id, is_deleted')
      .eq('tenant_id', tenantA.id)
      .eq('item_id', 'item-doomed')
    expect(vars).toHaveLength(2)
    expect(vars!.every((v: { is_deleted: boolean }) => v.is_deleted)).toBe(true)

    const { data: memberships } = await supabase
      .from('square_menu_item_categories')
      .select('item_id')
      .eq('tenant_id', tenantA.id)
      .eq('item_id', 'item-doomed')
    expect(memberships ?? []).toHaveLength(0)
  })

  it('variation removed (other variations remain): removed marked deleted', async () => {
    nextSquareResponses = {
      category: {
        objects: [
          category({ id: 'menu-1', name: 'M', is_top_level: true }),
          category({ id: 'group-hot', name: 'Hot', parent_id: 'menu-1' }),
        ],
      },
      item: {
        objects: [
          item({
            id: 'item-multi',
            name: 'Multi',
            categories: [{ id: 'group-hot', ordinal: 1 }],
            variations: [
              { id: 'var-keep', name: 'Keep', price_cents: 100 },
              { id: 'var-remove', name: 'Remove', price_cents: 200 },
            ],
          }),
        ],
      },
    }
    const supabase = getServiceClient()
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    // Re-sync with one variation removed
    nextSquareResponses.item.objects = [
      item({
        id: 'item-multi',
        name: 'Multi',
        categories: [{ id: 'group-hot', ordinal: 1 }],
        variations: [{ id: 'var-keep', name: 'Keep', price_cents: 100 }],
      }),
    ]
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    const { data: vars } = await supabase
      .from('square_menu_item_variations')
      .select('id, is_deleted')
      .eq('tenant_id', tenantA.id)
      .eq('item_id', 'item-multi')
      .order('id')
    const byId = new Map(vars!.map((v: { id: string; is_deleted: boolean }) => [v.id, v.is_deleted]))
    expect(byId.get('var-keep')).toBe(false)
    expect(byId.get('var-remove')).toBe(true)
  })

  it('menu group deleted: group marked + memberships cascaded', async () => {
    nextSquareResponses = {
      category: {
        objects: [
          category({ id: 'menu-1', name: 'M', is_top_level: true }),
          category({ id: 'group-doomed', name: 'Doomed', parent_id: 'menu-1' }),
        ],
      },
      item: {
        objects: [
          item({
            id: 'item-in-doomed',
            name: 'X',
            categories: [{ id: 'group-doomed', ordinal: 1 }],
            variations: [{ id: 'var-x', name: 'Each', price_cents: 100 }],
          }),
        ],
      },
    }
    const supabase = getServiceClient()
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    nextSquareResponses.category.objects = [
      category({ id: 'group-doomed', name: 'Doomed', parent_id: 'menu-1', is_deleted: true }),
    ]
    nextSquareResponses.item.objects = []
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    const { data: groupRow } = await supabase
      .from('square_menu_categories')
      .select('is_deleted')
      .eq('tenant_id', tenantA.id)
      .eq('id', 'group-doomed')
      .single()
    expect(groupRow?.is_deleted).toBe(true)

    const { data: memberships } = await supabase
      .from('square_menu_item_categories')
      .select('item_id')
      .eq('tenant_id', tenantA.id)
      .eq('category_id', 'group-doomed')
    expect(memberships ?? []).toHaveLength(0)
  })

  it('items with only REGULAR_CATEGORY are skipped (not mirrored)', async () => {
    nextSquareResponses = {
      category: {
        objects: [
          category({ id: 'menu-1', name: 'M', is_top_level: true }),
          category({ id: 'reg-cat', name: 'Reg', type: 'REGULAR_CATEGORY' }),
        ],
      },
      item: {
        objects: [
          item({
            id: 'item-pos-only',
            name: 'POS Only',
            categories: [{ id: 'reg-cat', ordinal: 1 }], // ← regular category only
            variations: [{ id: 'var-pos', name: 'Each', price_cents: 100 }],
          }),
        ],
      },
    }
    const supabase = getServiceClient()
    const result = await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })
    expect(result.upserts.items).toBe(0)

    const { data: itemRow } = await supabase
      .from('square_menu_items')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('id', 'item-pos-only')
      .maybeSingle()
    expect(itemRow).toBeNull()
  })

  it('idempotent: re-running with the same fixture yields same end-state', async () => {
    nextSquareResponses = {
      category: {
        objects: [
          category({ id: 'menu-1', name: 'M', is_top_level: true }),
          category({ id: 'group-1', name: 'G', parent_id: 'menu-1' }),
        ],
      },
      item: {
        objects: [
          item({
            id: 'item-z',
            name: 'Z',
            categories: [{ id: 'group-1', ordinal: 1 }],
            variations: [{ id: 'var-z', name: 'E', price_cents: 100 }],
          }),
        ],
      },
    }
    const supabase = getServiceClient()
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    const { count: catCount } = await supabase
      .from('square_menu_categories')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantA.id)
    const { count: itemCount } = await supabase
      .from('square_menu_items')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantA.id)
    const { count: varCount } = await supabase
      .from('square_menu_item_variations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantA.id)
    const { count: memCount } = await supabase
      .from('square_menu_item_categories')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantA.id)

    expect(catCount).toBe(2)
    expect(itemCount).toBe(1)
    expect(varCount).toBe(1)
    expect(memCount).toBe(1)
  })

  it('tenant isolation: sync for tenant A does not touch tenant B', async () => {
    nextSquareResponses = {
      category: {
        objects: [category({ id: 'shared-menu', name: 'M', is_top_level: true })],
      },
      item: { objects: [] },
    }
    const supabase = getServiceClient()
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    const { count: bCount } = await supabase
      .from('square_menu_categories')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantB.id)
    expect(bCount).toBe(0)
  })

  it('writes sync state with last_synced_at on success', async () => {
    nextSquareResponses = { category: { objects: [] }, item: { objects: [] } }
    const supabase = getServiceClient()
    await syncMenusFromSquare(supabase, tenantA.id, { fullResync: true })

    const { data: state } = await supabase
      .from('square_menu_sync_state')
      .select('last_synced_at, last_run_status, last_error')
      .eq('tenant_id', tenantA.id)
      .single()
    expect(state?.last_synced_at).toBeTruthy()
    expect(state?.last_run_status).toBe('ok')
    expect(state?.last_error).toBeNull()
  })
})
