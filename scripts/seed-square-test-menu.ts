#!/usr/bin/env tsx
/**
 * MOK-151 / KDS v3 — seed a deterministic Square menu for testing the local
 * mirror sync + the v3 renderer (phase 6 / MOK-158).
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T0)
 *
 * Creates (v2 — phase 6 expansion):
 *   - 1 menu category ("KDS Test Menu", MENU_CATEGORY top-level)
 *   - 14 menu groups under the menu
 *   - ~50 items / ~95 variations across the groups
 *
 * Groups are designed to exercise each of phase 6's layout modes:
 *   - simple_list           — Pastries (one variation each, varied prices)
 *   - variation_column_header — Hot Drinks / Cold Drinks / both Frappuccinos /
 *                              Seasonal Specials / Teas (all Tall/Grande/Venti)
 *   - flavor_list           — Muffins (one ITEM, four ITEM_VARIATION flavors,
 *                              all same price)
 *   - compact_list          — Energy Drinks / Smoothies (one variation each,
 *                              all sharing one price)
 *
 * Frappuccinos — Coffee is deliberately overstuffed (7 items × 3 sizes = 21
 * variations) so phase 6's hide-from-KDS override surface can be exercised.
 *
 * Usage:
 *   npx tsx scripts/seed-square-test-menu.ts [--tenant <slug>] [<mode>]
 *   <mode> = --cleanup | --recreate | --archive-orphans (default: apply only)
 *
 * Examples:
 *   npx tsx scripts/seed-square-test-menu.ts                       # apply against .env.local creds
 *   npx tsx scripts/seed-square-test-menu.ts --tenant bigcafe --recreate
 *   npx tsx scripts/seed-square-test-menu.ts --tenant littlecafe
 *
 * Square credentials:
 *   - With --tenant <slug>: looks up the tenant's stored credentials
 *     (Vault for non-default tenants, env fallback for the default tenant).
 *   - Without --tenant: uses SQUARE_ACCESS_TOKEN from .env.local (equivalent
 *     to seeding the default tenant — littlecafe — directly).
 *
 * Note: this script is dev-only; it does NOT ship in the app bundle. Images
 * are intentionally not attached — IMAGE upload is a separate multipart
 * endpoint and the local mirror handles null image_url cleanly.
 */
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

// Parse CLI args: extract --tenant <slug> and treat remaining as a mode flag.
function parseArgs(): { tenantSlug: string | null; mode: string | null } {
  const args = process.argv.slice(2)
  let tenantSlug: string | null = null
  let mode: string | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tenant') {
      tenantSlug = args[i + 1] ?? null
      i++
    } else if (
      args[i] === '--cleanup' ||
      args[i] === '--recreate' ||
      args[i] === '--archive-orphans'
    ) {
      mode = args[i]
    }
  }
  return { tenantSlug, mode }
}

// Square config — resolved lazily once tenant flag is parsed.
let SQUARE_BASE_URL = ''
let SQUARE_VERSION = '2026-01-22'
let ACCESS_TOKEN: string | null = null

async function resolveSquareCredentials(tenantSlug: string | null) {
  if (!tenantSlug) {
    // Default behavior: read from .env.local. Equivalent to seeding the
    // default tenant (littlecafe), which uses env fallback in
    // getTenantSquareConfig anyway.
    ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN ?? null
    SQUARE_BASE_URL =
      process.env.SQUARE_ENVIRONMENT === 'production'
        ? 'https://connect.squareup.com'
        : 'https://connect.squareupsandbox.com'
    if (!ACCESS_TOKEN) {
      console.error('SQUARE_ACCESS_TOKEN missing from .env.local')
      process.exit(1)
    }
    return
  }

  // Look up tenant credentials via the same getTenantSquareConfig helper the
  // app uses. Dynamic import so the script can run without instantiating
  // Next.js context for the env-only path above.
  const { createServiceClient } = await import('@/lib/supabase/server')
  const { getTenantSquareConfig } = await import('@/lib/square/config')

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('slug', tenantSlug)
    .maybeSingle()
  if (error || !data) {
    console.error(`Tenant not found by slug "${tenantSlug}":`, error?.message ?? 'no row')
    process.exit(1)
  }

  const cfg = await getTenantSquareConfig(data.id)
  if (!cfg) {
    console.error(`No Square credentials configured for tenant ${tenantSlug} (${data.id})`)
    process.exit(1)
  }
  ACCESS_TOKEN = cfg.accessToken
  SQUARE_BASE_URL =
    cfg.environment === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com'
  console.log(
    `Resolved tenant "${tenantSlug}" (${data.id}) credentials — env: ${cfg.environment}, app: ${cfg.applicationId}`,
  )
}

// Stable batch_idempotency_key: re-runs with the same key are deduplicated by
// Square but still apply updates. Bump SEED_VERSION when materially changing
// shape (different variation names, group structure, etc.) — the prior version
// of the seed should be wiped via --cleanup before applying the new one.
const SEED_VERSION = 'v2'
const BATCH_IDEMPOTENCY_KEY = `kds-v3-test-menu-seed-${SEED_VERSION}`

// ─────────────────────────────────────────────────────────────────────────────
// Menu definition — declarative; expanded into Square catalog objects below
// ─────────────────────────────────────────────────────────────────────────────

const MENU_TEMP_ID = '#kds-test-menu'

type ItemDef =
  // Sized items: Tall/Grande/Venti variations with distinct prices.
  | {
      kind: 'sized'
      slug: string
      name: string
      description?: string
      prices: [tall: number, grande: number, venti: number]
    }
  // Simple items: one variation, varied prices across the group.
  | {
      kind: 'simple'
      slug: string
      name: string
      description?: string
      priceCents: number
      variationName?: string  // defaults to 'Each'
    }
  // Flavor item: one Square ITEM, multiple ITEM_VARIATION flavors all priced
  // the same. Canonical flavor_list layout shape.
  | {
      kind: 'flavor'
      slug: string
      name: string
      description?: string
      priceCents: number
      flavors: string[]
    }

interface MenuGroupDef {
  slug: string
  name: string
  items: ItemDef[]
}

const SIZE_NAMES = ['Tall', 'Grande', 'Venti'] as const

const MENU_GROUPS: MenuGroupDef[] = [
  {
    slug: 'hot-drinks',
    name: 'Hot Drinks',
    items: [
      { kind: 'sized', slug: 'latte', name: 'Latte', description: 'Espresso with steamed milk', prices: [495, 555, 615] },
      { kind: 'sized', slug: 'cappuccino', name: 'Cappuccino', description: 'Espresso with foamed milk', prices: [495, 555, 615] },
      { kind: 'sized', slug: 'mocha', name: 'Mocha', description: 'Espresso with chocolate and steamed milk', prices: [545, 605, 665] },
      { kind: 'sized', slug: 'caramel-macchiato', name: 'Caramel Macchiato', description: 'Espresso layered with vanilla and caramel', prices: [545, 605, 665] },
    ],
  },
  {
    slug: 'cold-drinks',
    name: 'Cold Drinks',
    items: [
      { kind: 'sized', slug: 'iced-latte', name: 'Iced Latte', description: 'Espresso over ice with cold milk', prices: [525, 585, 645] },
      { kind: 'sized', slug: 'iced-caramel-macchiato', name: 'Iced Caramel Macchiato', description: 'Iced espresso with vanilla and caramel', prices: [565, 625, 685] },
      { kind: 'sized', slug: 'iced-americano', name: 'Iced Americano', description: 'Espresso over ice with water', prices: [475, 535, 595] },
      { kind: 'sized', slug: 'cold-brew', name: 'Cold Brew', description: 'Slow-steeped iced coffee', prices: [495, 555, 615] },
    ],
  },
  {
    slug: 'frappuccinos-coffee',
    name: 'Frappuccinos — Coffee',
    // Deliberately overstuffed (7 items × 3 sizes = 21 variations) so phase 6's
    // hide_from_kds override workflow can be exercised in the manual walk.
    items: [
      { kind: 'sized', slug: 'caffe-frappuccino', name: 'Caffè Frappuccino', prices: [595, 655, 715] },
      { kind: 'sized', slug: 'mocha-frappuccino', name: 'Mocha Frappuccino', prices: [625, 685, 745] },
      { kind: 'sized', slug: 'caramel-frappuccino', name: 'Caramel Frappuccino', prices: [625, 685, 745] },
      { kind: 'sized', slug: 'java-chip-frappuccino', name: 'Java Chip Frappuccino', prices: [655, 715, 775] },
      { kind: 'sized', slug: 'mocha-cookie-crumble', name: 'Mocha Cookie Crumble', prices: [655, 715, 775] },
      { kind: 'sized', slug: 'white-mocha-frappuccino', name: 'White Chocolate Mocha Frappuccino', prices: [655, 715, 775] },
      { kind: 'sized', slug: 'caramel-brulee-frappuccino', name: 'Caramel Brulée Frappuccino', prices: [685, 745, 805] },
    ],
  },
  {
    slug: 'frappuccinos-creme',
    name: 'Frappuccinos — Crème',
    items: [
      { kind: 'sized', slug: 'vanilla-bean-creme', name: 'Vanilla Bean Crème', prices: [595, 655, 715] },
      { kind: 'sized', slug: 'strawberry-creme', name: 'Strawberry Crème', prices: [595, 655, 715] },
      { kind: 'sized', slug: 'double-chocolaty-chip', name: 'Double Chocolaty Chip', prices: [625, 685, 745] },
      { kind: 'sized', slug: 'matcha-creme', name: 'Matcha Crème', prices: [625, 685, 745] },
    ],
  },
  {
    slug: 'seasonal-specials',
    name: 'Seasonal Specials',
    items: [
      { kind: 'sized', slug: 'pumpkin-spice-latte', name: 'Pumpkin Spice Latte', prices: [595, 655, 715] },
      { kind: 'sized', slug: 'iced-pumpkin-spice-latte', name: 'Iced Pumpkin Spice Latte', prices: [595, 655, 715] },
      { kind: 'sized', slug: 'pumpkin-cream-cold-brew', name: 'Pumpkin Cream Cold Brew', prices: [595, 655, 715] },
      { kind: 'sized', slug: 'apple-crisp-macchiato', name: 'Apple Crisp Macchiato', prices: [595, 655, 715] },
    ],
  },
  {
    slug: 'teas',
    name: 'Teas',
    items: [
      { kind: 'sized', slug: 'green-tea', name: 'Green Tea', prices: [395, 455, 515] },
      { kind: 'sized', slug: 'earl-grey', name: 'Earl Grey', prices: [395, 455, 515] },
      { kind: 'sized', slug: 'chai-latte', name: 'Chai Latte', prices: [495, 555, 615] },
      { kind: 'sized', slug: 'matcha-latte', name: 'Matcha Latte', prices: [545, 605, 665] },
    ],
  },
  {
    slug: 'energy-drinks',
    name: 'Energy Drinks',
    items: [
      // Canonical compact_list shape: one variation each, all same price.
      { kind: 'simple', slug: 'peach-energy', name: 'Peach Energy', priceCents: 595 },
      { kind: 'simple', slug: 'berry-energy', name: 'Berry Energy', priceCents: 595 },
      { kind: 'simple', slug: 'mango-energy', name: 'Mango Energy', priceCents: 595 },
      { kind: 'simple', slug: 'passion-fruit-energy', name: 'Passion Fruit Energy', priceCents: 595 },
    ],
  },
  {
    slug: 'smoothies',
    name: 'Smoothies',
    items: [
      // Sized variations matching the canonical Tall/Grande/Venti set used
      // by Hot Drinks / Cold Drinks / Frappuccinos / Seasonal / Teas — so
      // variation_column_header renders cleanly across the menu.
      { kind: 'sized', slug: 'strawberry-banana-smoothie', name: 'Strawberry Banana', prices: [625, 695, 765] },
      { kind: 'sized', slug: 'mango-pineapple-smoothie', name: 'Mango Pineapple', prices: [625, 695, 765] },
      { kind: 'sized', slug: 'mixed-berry-smoothie', name: 'Mixed Berry', prices: [625, 695, 765] },
      { kind: 'sized', slug: 'green-detox-smoothie', name: 'Green Detox', prices: [675, 745, 815] },
    ],
  },
  {
    slug: 'pastries',
    name: 'Pastries',
    items: [
      // Canonical simple_list shape: one variation each, varied prices.
      { kind: 'simple', slug: 'butter-croissant', name: 'Butter Croissant', description: 'Flaky pastry', priceCents: 425 },
      { kind: 'simple', slug: 'pain-au-chocolat', name: 'Pain au Chocolat', priceCents: 475 },
      { kind: 'simple', slug: 'almond-croissant', name: 'Almond Croissant', priceCents: 495 },
      { kind: 'simple', slug: 'cinnamon-roll', name: 'Cinnamon Roll', priceCents: 525 },
    ],
  },
  {
    slug: 'muffins',
    name: 'Muffins',
    items: [
      // Canonical flavor_list shape: ONE item with multiple variations.
      {
        kind: 'flavor',
        slug: 'muffin',
        name: 'Muffin',
        description: 'Fresh-baked daily',
        priceCents: 425,
        flavors: ['Blueberry', 'Banana Walnut', 'Lemon Poppyseed', 'Chocolate Chip'],
      },
    ],
  },
  {
    slug: 'savory-croissants',
    name: 'Savory Croissants',
    items: [
      { kind: 'simple', slug: 'ham-cheese-croissant', name: 'Ham & Cheese Croissant', priceCents: 695 },
      { kind: 'simple', slug: 'spinach-feta-croissant', name: 'Spinach & Feta Croissant', priceCents: 695 },
      { kind: 'simple', slug: 'bacon-egg-croissant', name: 'Bacon & Egg Croissant', priceCents: 745 },
    ],
  },
  {
    slug: 'panini-sandwiches',
    name: 'Panini Sandwiches',
    items: [
      { kind: 'simple', slug: 'turkey-swiss-panini', name: 'Turkey & Swiss Panini', priceCents: 995 },
      { kind: 'simple', slug: 'caprese-panini', name: 'Caprese Panini', priceCents: 895 },
      { kind: 'simple', slug: 'italian-panini', name: 'Italian Panini', priceCents: 1095 },
    ],
  },
  {
    slug: 'other-sandwiches',
    name: 'Other Sandwiches',
    items: [
      { kind: 'simple', slug: 'turkey-avocado-wrap', name: 'Turkey Avocado Wrap', priceCents: 945 },
      { kind: 'simple', slug: 'egg-salad-sandwich', name: 'Egg Salad Sandwich', priceCents: 795 },
      { kind: 'simple', slug: 'tuna-salad-sandwich', name: 'Tuna Salad Sandwich', priceCents: 845 },
    ],
  },
  {
    slug: 'burritos',
    name: 'Burritos',
    items: [
      { kind: 'simple', slug: 'breakfast-burrito', name: 'Breakfast Burrito', priceCents: 895 },
      { kind: 'simple', slug: 'chicken-burrito', name: 'Chicken Burrito', priceCents: 995 },
      { kind: 'simple', slug: 'veggie-burrito', name: 'Veggie Burrito', priceCents: 895 },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Square catalog object builder
// ─────────────────────────────────────────────────────────────────────────────

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

function groupTempId(groupSlug: string) {
  return `#kds-test-group-${groupSlug}`
}

function itemTempId(itemSlug: string) {
  return `#kds-test-item-${itemSlug}`
}

function variationTempId(itemSlug: string, variationSlug: string) {
  return `#kds-var-${itemSlug}-${variationSlug}`
}

function slugifyVariation(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function buildVariation(itemSlug: string, name: string, priceCents: number) {
  return {
    type: 'ITEM_VARIATION' as const,
    id: variationTempId(itemSlug, slugifyVariation(name)),
    item_variation_data: {
      name,
      pricing_type: 'FIXED_PRICING' as const,
      price_money: { amount: priceCents, currency: 'USD' },
    },
  }
}

function buildItemObject(item: ItemDef, groupSlug: string, ordinal: number): SquareCatalogObject {
  const baseVariations =
    item.kind === 'sized'
      ? SIZE_NAMES.map((sizeName, i) => buildVariation(item.slug, sizeName, item.prices[i]))
      : item.kind === 'simple'
        ? [buildVariation(item.slug, item.variationName ?? 'Each', item.priceCents)]
        : item.flavors.map((flavor) => buildVariation(item.slug, flavor, item.priceCents))

  return {
    type: 'ITEM',
    id: itemTempId(item.slug),
    present_at_all_locations: true,
    item_data: {
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
      product_type: 'REGULAR',
      categories: [{ id: groupTempId(groupSlug), ordinal }],
      variations: baseVariations,
    },
  }
}

function buildSeedBatch(): SquareCatalogObject[] {
  const objects: SquareCatalogObject[] = []

  // Top-level menu category
  objects.push({
    type: 'CATEGORY',
    id: MENU_TEMP_ID,
    present_at_all_locations: true,
    category_data: {
      name: 'KDS Test Menu',
      category_type: 'MENU_CATEGORY',
      is_top_level: true,
    },
  })

  // Menu groups
  MENU_GROUPS.forEach((group, i) => {
    objects.push({
      type: 'CATEGORY',
      id: groupTempId(group.slug),
      present_at_all_locations: true,
      category_data: {
        name: group.name,
        category_type: 'MENU_CATEGORY',
        parent_category: { id: MENU_TEMP_ID, ordinal: i + 1 },
      },
    })
  })

  // Items
  for (const group of MENU_GROUPS) {
    group.items.forEach((item, i) => {
      objects.push(buildItemObject(item, group.slug, i + 1))
    })
  }

  return objects
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
    console.error(`Square ${path} → ${res.status}`)
    console.error(JSON.stringify(body, null, 2))
    throw new Error(`Square API error ${res.status}`)
  }
  return body
}

async function applySeed(): Promise<{ liveMenuId: string | null }> {
  const objects = buildSeedBatch()
  const groupCount = MENU_GROUPS.length
  const itemCount = MENU_GROUPS.reduce((sum, g) => sum + g.items.length, 0)
  const variationCount = MENU_GROUPS.reduce(
    (sum, g) =>
      sum +
      g.items.reduce(
        (s, it) =>
          s +
          (it.kind === 'sized'
            ? SIZE_NAMES.length
            : it.kind === 'simple'
              ? 1
              : it.flavors.length),
        0,
      ),
    0,
  )
  console.log(
    `Upserting ${objects.length} catalog objects (1 menu + ${groupCount} groups + ${itemCount} items / ${variationCount} variations)…`,
  )

  // Fresh batch idempotency key per run — Square caches idempotency-key
  // responses for 24h, and our batch may include reverse-edits across runs
  // that have to actually apply (not return the cached prior response). The
  // upsert itself is idempotent on client_object_id within a single batch.
  const idemKey = `${BATCH_IDEMPOTENCY_KEY}-${Date.now()}`

  const result = await squareFetch('/v2/catalog/batch-upsert', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: idemKey,
      batches: [{ objects }],
    }),
  })

  const idMap = (result.id_mappings ?? []) as Array<{
    client_object_id: string
    object_id: string
  }>

  console.log(`Seed applied. Categories + items mapped (variations elided):`)
  for (const m of idMap.filter((m) => !m.client_object_id.startsWith('#kds-var-'))) {
    console.log(`  ${m.client_object_id.padEnd(48)} → ${m.object_id}`)
  }

  const liveMenuId = idMap.find((m) => m.client_object_id === MENU_TEMP_ID)?.object_id ?? null
  return { liveMenuId }
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

async function findAllNamedTestMenus(): Promise<Array<{ id: string; name: string }>> {
  const body = await squareFetch('/v2/catalog/list?types=CATEGORY', { method: 'GET' })
  type Cat = {
    id: string
    category_data?: {
      name?: string
      category_type?: string
      is_top_level?: boolean
    }
  }
  return (body.objects ?? [])
    .filter(
      (o: Cat) =>
        o.category_data?.category_type === 'MENU_CATEGORY' &&
        o.category_data?.is_top_level === true &&
        (o.category_data?.name === 'KDS Test Menu' ||
          o.category_data?.name?.startsWith('KDS Test Menu (archive')),
    )
    .map((o: Cat) => ({ id: o.id, name: o.category_data?.name ?? '' }))
}

async function archiveOrphanMenus(liveMenuId: string | null = null) {
  // Square sandbox blocks DELETE on MENU_CATEGORY. When a major SEED_VERSION
  // bump creates a fresh menu tree, the old menu + its groups remain as orphans
  // in Square (with their child items deleted via batch-delete). Rename them
  // with an "(archive)" suffix so the mirror sync + UI binding picker can
  // visually distinguish them from the live menu.
  //
  // Caller MAY pass `liveMenuId` (the freshly-created menu's Square ID from
  // applySeed's id_mappings). When provided, that menu is treated as the
  // canonical "live" — every other menu named "KDS Test Menu" is archived.
  // When omitted, fall back to picking the first match by name (fragile if
  // multiple menus already share the name; pre-apply use only).
  const menus = await findAllNamedTestMenus()
  const liveMenu = liveMenuId
    ? menus.find((m) => m.id === liveMenuId)
    : menus.find((m) => m.name === 'KDS Test Menu')
  const orphans = menus.filter((m) => m.id !== liveMenu?.id && m.name === 'KDS Test Menu')

  if (orphans.length === 0) return

  console.log(`  archiving ${orphans.length} orphan menu(s)…`)
  const stamp = new Date().toISOString().slice(0, 10)
  const runId = Date.now()
  for (const orphan of orphans) {
    // Fetch current version + full object first (Square requires version match on update)
    const orphanBody = await squareFetch(`/v2/catalog/object/${orphan.id}`, { method: 'GET' })
    const orphanObj = orphanBody.object
    await squareFetch('/v2/catalog/object', {
      method: 'POST',
      body: JSON.stringify({
        idempotency_key: `kds-archive-menu-${orphan.id}-${runId}`,
        object: {
          ...orphanObj,
          category_data: {
            ...orphanObj.category_data,
            name: `KDS Test Menu (archive ${stamp})`,
          },
        },
      }),
    })
    // Rename each child group
    const groupIds = await findChildrenOfMenu(orphan.id)
    for (const gid of groupIds) {
      const groupBody = await squareFetch(`/v2/catalog/object/${gid}`, { method: 'GET' })
      const obj = groupBody.object
      const currentName = obj?.category_data?.name ?? 'unknown'
      if (currentName.includes('(archive')) continue
      await squareFetch('/v2/catalog/object', {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: `kds-archive-group-${gid}-${runId}`,
          object: {
            ...obj,
            category_data: {
              ...obj.category_data,
              name: `${currentName} (archive ${stamp})`,
            },
          },
        }),
      })
    }
  }
  console.log(`  archived ${orphans.length} orphan menu(s) + their groups`)
}

async function cleanup() {
  console.log('Cleanup: searching for test menu…')
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

  // Two-pass deletion to work around the Square sandbox restriction that
  // blocks DELETE on MENU_CATEGORY objects. ITEM deletion is allowed; menu /
  // group deletion is rejected with INVALID_REQUEST_ERROR in sandbox.
  if (itemIds.length > 0) {
    console.log(`  deleting ${itemIds.length} items via batch-delete…`)
    await squareFetch('/v2/catalog/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ object_ids: itemIds }),
    })
  }

  const categoryIds = [menu.id, ...groupIds]
  console.log(`  attempting to delete ${categoryIds.length} categories…`)
  try {
    await squareFetch('/v2/catalog/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ object_ids: categoryIds }),
    })
    console.log('Cleanup complete (menus + groups + items deleted)')
  } catch {
    console.log(
      '  ⚠️  category deletion rejected (Square sandbox restriction on MENU_CATEGORY).',
    )
    console.log(
      '      Falling back: items are deleted; menu + groups will be archive-renamed on next apply.',
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const { tenantSlug, mode } = parseArgs()
  await resolveSquareCredentials(tenantSlug)
  console.log(
    `KDS v3 test menu seed (${SEED_VERSION}) — env: ${SQUARE_BASE_URL}${tenantSlug ? ` (tenant: ${tenantSlug})` : ' (.env.local)'}`,
  )

  if (mode === '--cleanup') {
    await cleanup()
  } else if (mode === '--recreate') {
    await cleanup()
    const { liveMenuId } = await applySeed()
    await archiveOrphanMenus(liveMenuId)
  } else if (mode === '--archive-orphans') {
    await archiveOrphanMenus()
  } else {
    const { liveMenuId } = await applySeed()
    await archiveOrphanMenus(liveMenuId)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
