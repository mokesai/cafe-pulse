#!/usr/bin/env node
/**
 * MOK-90 — Phase 2.2: Migrate catalog (cogs_products + cogs_sellables).
 *
 * The "menu" in cafe-pulse is expressed through the COGS lens:
 *   - cogs_products    — Square catalog items (e.g. "Latte")           [212 rows]
 *   - cogs_sellables   — Square variations (e.g. "Latte / Large")     [391 rows]
 *                         cogs_sellables.product_id → cogs_products.id
 *
 * Strategy:
 *   - Preserve source UUIDs. Avoids a product UUID remap for sellables.
 *     Collision with existing rows (other tenants) is negligible — gen_random_uuid.
 *   - Insert with explicit tenant_id = JMC (default is littlecafe's UUID).
 *   - ON CONFLICT (tenant_id, square_*_id) DO UPDATE — idempotent.
 *
 * Ordering: cogs_products first (parent), then cogs_sellables (FK).
 *
 * Usage:
 *   npx tsx scripts/migrate-from-cafeweb/03-catalog.ts [--dry-run]
 */

import fs from 'fs'
import path from 'path'
import { sourcePool, targetPool, withClient, closePools } from './shared/clients'

const DRY_RUN = process.argv.includes('--dry-run')
const STATE_DIR = path.resolve(__dirname, 'state')

interface TenantConfig {
  tenantId: string
  slug: string
  businessName: string
}

interface SourceProduct {
  id: string
  square_item_id: string
  name: string
  category: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  product_code: string | null
}

interface SourceSellable {
  id: string
  square_variation_id: string
  product_id: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

function loadTenantConfig(): TenantConfig {
  const file = path.join(STATE_DIR, 'tenant-config.json')
  if (!fs.existsSync(file)) {
    throw new Error(
      `tenant-config.json not found. Run 01-bootstrap-tenant.ts first.`
    )
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

async function main() {
  const tenant = loadTenantConfig()
  console.log('📦 Phase 2.2: Migrate catalog (cogs_products + cogs_sellables)')
  console.log(`   Tenant:  ${tenant.slug} (${tenant.tenantId})`)
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log('')

  // ── Read source ───────────────────────────────────────────────────────
  const [products, sellables] = await withClient(sourcePool, async (c) => {
    const { rows: products } = await c.query<SourceProduct>(
      `SELECT id, square_item_id, name, category, is_active, created_at, updated_at, product_code
       FROM cogs_products ORDER BY created_at`
    )
    const { rows: sellables } = await c.query<SourceSellable>(
      `SELECT id, square_variation_id, product_id, name, is_active, created_at, updated_at
       FROM cogs_sellables ORDER BY created_at`
    )
    return [products, sellables]
  })
  console.log(`→ Source: ${products.length} cogs_products, ${sellables.length} cogs_sellables`)

  // ── Watch-out: check for duplicate product_codes in source ────────────
  // Target has a partial unique index on (tenant_id, lower(product_code))
  // WHERE product_code IS NOT NULL. Duplicates in source would fail.
  const codeMap = new Map<string, number>()
  for (const p of products) {
    if (p.product_code) {
      const key = p.product_code.toLowerCase()
      codeMap.set(key, (codeMap.get(key) ?? 0) + 1)
    }
  }
  const dupes = [...codeMap.entries()].filter(([, n]) => n > 1)
  if (dupes.length > 0) {
    console.log('')
    console.log('  ⚠️  Duplicate product_codes detected in source (will fail partial unique index on target):')
    for (const [code, count] of dupes) console.log(`    ${code} × ${count}`)
    throw new Error(`Duplicate product_code values in source. Resolve before re-running.`)
  }

  // ── Migrate cogs_products ─────────────────────────────────────────────
  console.log('')
  console.log('→ Migrating cogs_products...')
  let productsInserted = 0, productsUpdated = 0

  await withClient(targetPool, async (c) => {
    for (const p of products) {
      if (DRY_RUN) continue
      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO cogs_products (
          id, tenant_id, square_item_id, name, category,
          is_active, created_at, updated_at, product_code
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (tenant_id, square_item_id) DO UPDATE SET
          name         = EXCLUDED.name,
          category     = EXCLUDED.category,
          is_active    = EXCLUDED.is_active,
          product_code = EXCLUDED.product_code,
          updated_at   = EXCLUDED.updated_at
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          p.id, tenant.tenantId, p.square_item_id, p.name, p.category,
          p.is_active, p.created_at, p.updated_at, p.product_code,
        ]
      )
      if (rows[0].action === 'inserted') productsInserted++
      else productsUpdated++
    }
  })

  if (DRY_RUN) {
    console.log(`  [dry-run] Would process ${products.length} cogs_products`)
  } else {
    console.log(`  ✅ ${productsInserted} inserted, ${productsUpdated} updated`)
  }

  // ── Migrate cogs_sellables ────────────────────────────────────────────
  console.log('')
  console.log('→ Migrating cogs_sellables...')
  let sellablesInserted = 0, sellablesUpdated = 0, sellablesSkippedOrphan = 0

  // Build product_id set for orphan check (sellable rows whose parent doesn't
  // exist in source — likely soft-deletes).
  const productIdSet = new Set(products.map((p) => p.id))

  await withClient(targetPool, async (c) => {
    for (const s of sellables) {
      if (!productIdSet.has(s.product_id)) {
        console.log(`  ⚠️  Sellable ${s.square_variation_id} references missing product_id=${s.product_id} — skipping`)
        sellablesSkippedOrphan++
        continue
      }
      if (DRY_RUN) continue
      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO cogs_sellables (
          id, tenant_id, square_variation_id, product_id, name,
          is_active, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (tenant_id, square_variation_id) DO UPDATE SET
          product_id = EXCLUDED.product_id,
          name       = EXCLUDED.name,
          is_active  = EXCLUDED.is_active,
          updated_at = EXCLUDED.updated_at
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          s.id, tenant.tenantId, s.square_variation_id, s.product_id, s.name,
          s.is_active, s.created_at, s.updated_at,
        ]
      )
      if (rows[0].action === 'inserted') sellablesInserted++
      else sellablesUpdated++
    }
  })

  if (DRY_RUN) {
    console.log(`  [dry-run] Would process ${sellables.length - sellablesSkippedOrphan} cogs_sellables (${sellablesSkippedOrphan} orphans skipped)`)
  } else {
    console.log(`  ✅ ${sellablesInserted} inserted, ${sellablesUpdated} updated${sellablesSkippedOrphan ? `, ${sellablesSkippedOrphan} orphans skipped` : ''}`)
  }

  // ── Verify target row counts ──────────────────────────────────────────
  console.log('')
  console.log('→ Verifying target row counts...')
  await withClient(targetPool, async (c) => {
    const { rows: pc } = await c.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM cogs_products WHERE tenant_id = $1`,
      [tenant.tenantId]
    )
    const { rows: sc } = await c.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM cogs_sellables WHERE tenant_id = $1`,
      [tenant.tenantId]
    )
    console.log(`  cogs_products:  target=${pc[0].c}, source=${products.length}`)
    console.log(`  cogs_sellables: target=${sc[0].c}, source=${sellables.length - sellablesSkippedOrphan} (expected after orphan skip)`)
  })

  console.log('')
  console.log('─'.repeat(60))
  console.log('✅ Catalog migration complete')
  console.log('─'.repeat(60))
}

main()
  .catch((err) => {
    console.error('💥 Catalog migration failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => closePools())
