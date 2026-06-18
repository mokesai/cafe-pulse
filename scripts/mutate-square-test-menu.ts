#!/usr/bin/env tsx
/**
 * MOK-151 / KDS v3 phase 1 — mutation scenarios for the seeded test menu.
 *
 * Plan: .planning/kds-v3/PHASE-1-PLAN.md (T8)
 *
 * Companion to scripts/seed-square-test-menu.ts. Each scenario is one
 * Square API call (or two — retrieve then upsert) that triggers exactly
 * one of the deletion / membership change paths from MOK-151's acceptance
 * criteria. After each mutation, run the menu-sync from DevTools and
 * verify the local mirror reflects the change.
 *
 * Usage:
 *   npx tsx scripts/mutate-square-test-menu.ts <scenario>
 *
 * Scenarios:
 *   rename-espresso        — rename "Espresso" to "Strong Espresso"
 *   move-espresso-cold     — move Espresso item from Hot Drinks to Cold Drinks
 *   remove-espresso-double — soft-delete the "Double" variation of Espresso
 *   delete-muffin          — hard-delete the Blueberry Muffin item
 *   delete-pastries-group  — hard-delete the Pastries menu group
 *   restore-state          — re-run the seed (recreates everything)
 *
 * Environment: SQUARE_ACCESS_TOKEN from .env.local. Must point at the same
 * Square sandbox bigcafe's vault credentials are configured for.
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

interface CatalogObject {
  type: string
  id: string
  version?: number
  item_data?: {
    name?: string
    description?: string
    categories?: Array<{ id?: string; ordinal?: number }>
    variations?: Array<{
      type: 'ITEM_VARIATION'
      id: string
      item_variation_data: Record<string, unknown>
    }>
    [key: string]: unknown
  }
  category_data?: Record<string, unknown>
}

async function squareFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SQUARE_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Square-Version': SQUARE_VERSION,
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    console.error(`❌ Square ${path} → ${res.status}`)
    console.error(JSON.stringify(body, null, 2))
    throw new Error(`Square API error ${res.status}`)
  }
  return body as T
}

async function findByName(
  type: 'CATEGORY' | 'ITEM',
  ...nameCandidates: string[]
): Promise<CatalogObject> {
  // Try each candidate name in order — scripts may re-find an item that an
  // earlier mutation renamed (e.g. Espresso → Strong Espresso).
  for (const name of nameCandidates) {
    const body = await squareFetch<{ objects?: CatalogObject[] }>('/v2/catalog/search', {
      method: 'POST',
      body: JSON.stringify({
        object_types: [type],
        query: { exact_query: { attribute_name: 'name', attribute_value: name } },
      }),
    })
    const obj = (body.objects ?? []).find((o) => {
      if (type === 'ITEM') return o.item_data?.name === name
      return (o.category_data as { name?: string } | undefined)?.name === name
    })
    if (obj) return obj
  }
  throw new Error(`No ${type} found with name in [${nameCandidates.join(', ')}]`)
}

// Convenience wrappers for the mutation scenarios so callers don't need to
// repeat the name-history tuple every time.
const ESPRESSO_NAMES = ['Strong Espresso', 'Espresso'] as const
const findEspresso = () => findByName('ITEM', ...ESPRESSO_NAMES)

async function retrieveCurrent(id: string): Promise<CatalogObject> {
  const body = await squareFetch<{ object?: CatalogObject }>(`/v2/catalog/object/${id}`)
  if (!body.object) throw new Error(`Object ${id} not found`)
  return body.object
}

async function upsert(object: CatalogObject) {
  const idempotencyKey = `kds-mutate-${object.id}-${Date.now()}`
  return squareFetch('/v2/catalog/object', {
    method: 'POST',
    body: JSON.stringify({ idempotency_key: idempotencyKey, object }),
  })
}

async function deleteObject(id: string) {
  return squareFetch(`/v2/catalog/object/${id}`, { method: 'DELETE' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────────────────────

async function renameEspresso(newName = 'Strong Espresso') {
  const espresso = await findEspresso()
  const fresh = await retrieveCurrent(espresso.id)
  fresh.item_data!.name = newName
  await upsert(fresh)
  console.log(`✓ renamed Espresso (${espresso.id}) → "${newName}"`)
}

async function moveEspressoToCold() {
  const espresso = await findEspresso()
  const cold = await findByName('CATEGORY', 'Cold Drinks')
  const fresh = await retrieveCurrent(espresso.id)
  fresh.item_data!.categories = [{ id: cold.id, ordinal: 3 }] // append at end of cold
  await upsert(fresh)
  console.log(`✓ moved Espresso (${espresso.id}) → Cold Drinks (${cold.id})`)
}

async function removeEspressoDouble() {
  const espresso = await findEspresso()
  const fresh = await retrieveCurrent(espresso.id)
  const variations = fresh.item_data?.variations ?? []
  const before = variations.length
  fresh.item_data!.variations = variations.filter(
    (v) => (v.item_variation_data as { name?: string })?.name !== 'Double',
  )
  if (fresh.item_data!.variations!.length === before) {
    console.log('  (no "Double" variation to remove — may already be gone)')
  }
  await upsert(fresh)
  console.log(`✓ removed "Double" variation from Espresso`)
}

async function deleteMuffin(explicitId?: string) {
  // Allow an explicit Square ID to bypass name-search (useful when prior
  // seed runs left duplicate "Blueberry Muffin" objects in Square and
  // findByName returns the wrong one).
  const id = explicitId ?? (await findByName('ITEM', 'Blueberry Muffin')).id
  await deleteObject(id)
  console.log(`✓ hard-deleted Blueberry Muffin (${id})`)
}

async function deleteByIds(type: string, ids: string[]) {
  if (ids.length === 0) return
  for (const id of ids) {
    await deleteObject(id)
    console.log(`✓ hard-deleted ${type} (${id})`)
  }
}

async function deletePastriesGroup() {
  const pastries = await findByName('CATEGORY', 'Pastries')
  await deleteObject(pastries.id)
  console.log(`✓ hard-deleted Pastries group (${pastries.id})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI dispatch
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIOS: Record<string, (arg?: string) => Promise<void>> = {
  'rename-espresso': () => renameEspresso(),
  'move-espresso-cold': moveEspressoToCold,
  'remove-espresso-double': removeEspressoDouble,
  'delete-muffin': (id) => deleteMuffin(id),
  'delete-pastries-group': deletePastriesGroup,
  // Generic helper: delete a specific Square object by id
  // npm run mutate-kds-test-menu delete-by-id <id> [<id> …]
  'delete-by-id': async () => {
    const ids = process.argv.slice(3)
    if (ids.length === 0) throw new Error('Usage: delete-by-id <id> [<id> …]')
    await deleteByIds('object', ids)
  },
}

async function main() {
  const scenario = process.argv[2]
  if (!scenario || scenario === '--help') {
    console.log('Available scenarios:')
    for (const name of Object.keys(SCENARIOS)) console.log(`  ${name}`)
    process.exit(scenario ? 0 : 1)
  }
  const fn = SCENARIOS[scenario]
  if (!fn) {
    console.error(`Unknown scenario: ${scenario}`)
    process.exit(1)
  }
  const arg = process.argv[3]
  console.log(`🔧 Mutating: ${scenario}${arg ? ` ${arg}` : ''}`)
  await fn(arg)
  console.log('  Now trigger the menu-sync (DevTools) to propagate to the local mirror.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
