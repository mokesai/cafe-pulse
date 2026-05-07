#!/usr/bin/env tsx
/**
 * MOK-151 / KDS v3 phase 1 — seed a deterministic Square menu for testing
 * the local mirror sync.
 *
 * Plan: .planning/kds-v3/PHASE-1-PLAN.md (T3)
 *
 * Creates:
 *   - 1 menu category ("KDS Test Menu", MENU_CATEGORY top-level)
 *   - 3 menu groups under the menu ("Hot Drinks", "Cold Drinks", "Pastries")
 *   - 6 items spread across the groups, each with 1-2 variations
 *
 * Uses BatchUpsertCatalogObjects with temp IDs so the entire menu tree lands
 * in one atomic Square call. Idempotency: re-running with the same
 * batch_idempotency_key updates in place rather than creating duplicates.
 *
 * Usage:
 *   npx tsx scripts/seed-square-test-menu.ts            # create or update
 *   npx tsx scripts/seed-square-test-menu.ts --cleanup  # delete the test menu
 *
 * Environment:
 *   SQUARE_ACCESS_TOKEN  — must point at the Square sandbox/account you want
 *                           to seed. Sourced from .env.local.
 *
 * Note: this script is dev-only; it does NOT ship in the app bundle. Images
 * are intentionally not attached — IMAGE upload is a separate multipart
 * endpoint and the local mirror handles null image_url cleanly. T7 fixtures
 * include captured image responses for the resolution-path tests.
 */
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const SQUARE_BASE_URL =
  process.env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'

const SQUARE_VERSION = '2026-01-22'
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN

if (!ACCESS_TOKEN) {
  console.error('❌ SQUARE_ACCESS_TOKEN missing from .env.local')
  process.exit(1)
}

// Stable batch_idempotency_key: re-runs with the same key are deduplicated by
// Square but still apply updates. Bumping the version invalidates idempotency.
const SEED_VERSION = 'v1'
const BATCH_IDEMPOTENCY_KEY = `kds-v3-test-menu-seed-${SEED_VERSION}`

// ─────────────────────────────────────────────────────────────────────────────
// Menu structure (deterministic — referenced by T7 fixtures + T8 manual tests)
// ─────────────────────────────────────────────────────────────────────────────

const TEMP_IDS = {
  menu: '#kds-test-menu',
  groups: {
    hot: '#kds-test-group-hot-drinks',
    cold: '#kds-test-group-cold-drinks',
    pastries: '#kds-test-group-pastries',
  },
  items: {
    espresso: '#kds-test-item-espresso',
    latte: '#kds-test-item-latte',
    icedAmericano: '#kds-test-item-iced-americano',
    coldBrew: '#kds-test-item-cold-brew',
    croissant: '#kds-test-item-croissant',
    muffin: '#kds-test-item-muffin',
  },
} as const

interface SquareCatalogObject {
  type: string
  id: string
  present_at_all_locations?: boolean
  category_data?: {
    name: string
    category_type: 'MENU_CATEGORY' | 'REGULAR_CATEGORY'
    parent_category?: { id: string; ordinal?: number }
    is_top_level?: boolean
  }
  item_data?: {
    name: string
    description?: string
    product_type?: string
    categories?: Array<{ id: string; ordinal?: number }>
    variations?: Array<{
      type: 'ITEM_VARIATION'
      id: string
      item_variation_data: {
        item_id?: string
        name: string
        pricing_type: 'FIXED_PRICING'
        price_money: { amount: number; currency: string }
      }
    }>
  }
}

function variation(tempId: string, name: string, priceCents: number) {
  return {
    type: 'ITEM_VARIATION' as const,
    id: tempId,
    item_variation_data: {
      name,
      pricing_type: 'FIXED_PRICING' as const,
      price_money: { amount: priceCents, currency: 'USD' },
    },
  }
}

function buildSeedBatch(): SquareCatalogObject[] {
  return [
    // Menu (top-level MENU_CATEGORY)
    {
      type: 'CATEGORY',
      id: TEMP_IDS.menu,
      present_at_all_locations: true,
      category_data: {
        name: 'KDS Test Menu',
        category_type: 'MENU_CATEGORY',
        is_top_level: true,
      },
    },

    // Menu groups (MENU_CATEGORY children pointing at the menu)
    {
      type: 'CATEGORY',
      id: TEMP_IDS.groups.hot,
      present_at_all_locations: true,
      category_data: {
        name: 'Hot Drinks',
        category_type: 'MENU_CATEGORY',
        parent_category: { id: TEMP_IDS.menu, ordinal: 1 },
      },
    },
    {
      type: 'CATEGORY',
      id: TEMP_IDS.groups.cold,
      present_at_all_locations: true,
      category_data: {
        name: 'Cold Drinks',
        category_type: 'MENU_CATEGORY',
        parent_category: { id: TEMP_IDS.menu, ordinal: 2 },
      },
    },
    {
      type: 'CATEGORY',
      id: TEMP_IDS.groups.pastries,
      present_at_all_locations: true,
      category_data: {
        name: 'Pastries',
        category_type: 'MENU_CATEGORY',
        parent_category: { id: TEMP_IDS.menu, ordinal: 3 },
      },
    },

    // Items — each in one menu group, with 1-2 variations
    {
      type: 'ITEM',
      id: TEMP_IDS.items.espresso,
      present_at_all_locations: true,
      item_data: {
        name: 'Espresso',
        description: 'Double shot espresso',
        product_type: 'REGULAR',
        categories: [{ id: TEMP_IDS.groups.hot, ordinal: 1 }],
        variations: [
          variation('#kds-var-espresso-single', 'Single', 350),
          variation('#kds-var-espresso-double', 'Double', 450),
        ],
      },
    },
    {
      type: 'ITEM',
      id: TEMP_IDS.items.latte,
      present_at_all_locations: true,
      item_data: {
        name: 'Latte',
        description: 'Espresso with steamed milk',
        product_type: 'REGULAR',
        categories: [{ id: TEMP_IDS.groups.hot, ordinal: 2 }],
        variations: [
          variation('#kds-var-latte-12', '12 oz', 525),
          variation('#kds-var-latte-16', '16 oz', 625),
        ],
      },
    },
    {
      type: 'ITEM',
      id: TEMP_IDS.items.icedAmericano,
      present_at_all_locations: true,
      item_data: {
        name: 'Iced Americano',
        description: 'Espresso over ice',
        product_type: 'REGULAR',
        categories: [{ id: TEMP_IDS.groups.cold, ordinal: 1 }],
        variations: [variation('#kds-var-iced-am-16', '16 oz', 475)],
      },
    },
    {
      type: 'ITEM',
      id: TEMP_IDS.items.coldBrew,
      present_at_all_locations: true,
      item_data: {
        name: 'Cold Brew',
        description: 'Slow-steeped iced coffee',
        product_type: 'REGULAR',
        categories: [{ id: TEMP_IDS.groups.cold, ordinal: 2 }],
        variations: [
          variation('#kds-var-cold-brew-12', '12 oz', 475),
          variation('#kds-var-cold-brew-16', '16 oz', 575),
        ],
      },
    },
    {
      type: 'ITEM',
      id: TEMP_IDS.items.croissant,
      present_at_all_locations: true,
      item_data: {
        name: 'Butter Croissant',
        description: 'Flaky pastry',
        product_type: 'REGULAR',
        categories: [{ id: TEMP_IDS.groups.pastries, ordinal: 1 }],
        variations: [variation('#kds-var-croissant', 'Each', 425)],
      },
    },
    {
      type: 'ITEM',
      id: TEMP_IDS.items.muffin,
      present_at_all_locations: true,
      item_data: {
        name: 'Blueberry Muffin',
        description: 'Fresh-baked daily',
        product_type: 'REGULAR',
        categories: [{ id: TEMP_IDS.groups.pastries, ordinal: 2 }],
        variations: [variation('#kds-var-muffin', 'Each', 395)],
      },
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Square API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function squareFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SQUARE_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Square-Version': SQUARE_VERSION,
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`❌ Square ${path} → ${res.status}`)
    console.error(JSON.stringify(body, null, 2))
    throw new Error(`Square API error ${res.status}`)
  }
  return body
}

async function applySeed() {
  const objects = buildSeedBatch()
  console.log(`📤 Upserting ${objects.length} catalog objects (1 menu + 3 groups + 6 items)…`)

  const result = await squareFetch('/v2/catalog/batch-upsert', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: BATCH_IDEMPOTENCY_KEY,
      batches: [{ objects }],
    }),
  })

  const idMap = (result.id_mappings ?? []) as Array<{
    client_object_id: string
    object_id: string
  }>

  console.log(`✓ Seed applied. Square assigned IDs:`)
  for (const m of idMap.filter((m) => !m.client_object_id.startsWith('#kds-var-'))) {
    console.log(`  ${m.client_object_id.padEnd(32)} → ${m.object_id}`)
  }
}

async function findTestMenu() {
  const body = await squareFetch('/v2/catalog/search', {
    method: 'POST',
    body: JSON.stringify({
      object_types: ['CATEGORY'],
      query: {
        exact_query: { attribute_name: 'name', attribute_value: 'KDS Test Menu' },
      },
    }),
  })
  return (body.objects ?? []).find(
    (o: { category_data?: { name: string; category_type: string } }) =>
      o.category_data?.name === 'KDS Test Menu' &&
      o.category_data?.category_type === 'MENU_CATEGORY',
  ) as { id: string } | undefined
}

async function findChildrenOfMenu(menuId: string): Promise<string[]> {
  // Find all MENU_CATEGORY rows whose parent_category.id matches the test menu.
  const body = await squareFetch('/v2/catalog/list?types=CATEGORY', { method: 'GET' })
  type Cat = {
    id: string
    category_data?: {
      category_type?: string
      parent_category?: { id: string }
    }
  }
  return (body.objects ?? [])
    .filter(
      (o: Cat) =>
        o.category_data?.category_type === 'MENU_CATEGORY' &&
        o.category_data?.parent_category?.id === menuId,
    )
    .map((o: Cat) => o.id)
}

async function findItemsInGroups(groupIds: string[]): Promise<string[]> {
  if (groupIds.length === 0) return []
  const body = await squareFetch('/v2/catalog/search', {
    method: 'POST',
    body: JSON.stringify({
      object_types: ['ITEM'],
      query: {
        set_query: { attribute_name: 'categories', attribute_values: groupIds },
      },
    }),
  })
  return (body.objects ?? []).map((o: { id: string }) => o.id)
}

async function cleanup() {
  console.log('🧹 Cleanup: searching for test menu…')
  const menu = await findTestMenu()
  if (!menu) {
    console.log('  no KDS Test Menu found — nothing to clean up')
    return
  }
  console.log(`  found menu: ${menu.id}`)

  const groupIds = await findChildrenOfMenu(menu.id)
  console.log(`  found ${groupIds.length} groups`)

  const itemIds = await findItemsInGroups(groupIds)
  console.log(`  found ${itemIds.length} items`)

  const allIds = [menu.id, ...groupIds, ...itemIds]
  if (allIds.length === 0) return

  console.log(`  deleting ${allIds.length} objects via batch-delete…`)
  await squareFetch('/v2/catalog/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ object_ids: allIds }),
  })
  console.log('✓ cleanup complete')
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2]
  console.log(`🌱 KDS v3 test menu seed — env: ${SQUARE_BASE_URL}`)

  if (mode === '--cleanup') {
    await cleanup()
  } else if (mode === '--recreate') {
    await cleanup()
    await applySeed()
  } else {
    await applySeed()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
