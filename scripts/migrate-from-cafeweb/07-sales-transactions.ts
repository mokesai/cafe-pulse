#!/usr/bin/env node
/**
 * MOK-94 — Phase 2.6: Migrate sales_transactions + sales_transaction_items.
 *
 * Biggest phase of the migration:
 *   - sales_transactions       4,930 rows — order history from Square sync
 *   - sales_transaction_items  7,308 rows — line items per order
 *   - total                   12,238 rows
 *
 * Schema deltas: both tables gain +tenant_id only.
 *
 * Design decisions:
 *
 *   - Preserve source UUIDs. sales_transaction_items.transaction_id FK lines up.
 *   - NULL out sales_transactions.sync_run_id during migration. The target FK
 *     points to inventory_sales_sync_runs which we're NOT migrating (12 rows
 *     of operational metadata with no business value). sync_run_id is nullable.
 *   - Preserve source square_order_id. Target has a UNIQUE constraint on
 *     square_order_id alone (not composite with tenant_id). Collision with
 *     other tenants' Square orders is astronomically unlikely.
 *   - impact_type values validated as subset of target CHECK: {auto, manual, ignored}.
 *   - sales_transaction_items with inventory_item_id that doesn't exist on target
 *     get NULLed out rather than dropped (graceful degrade — historical item
 *     attribution loss is acceptable; dropping the whole sale line would hurt
 *     revenue totals).
 *
 * Usage:
 *   npx tsx scripts/migrate-from-cafeweb/07-sales-transactions.ts [--dry-run]
 */

import fs from 'fs'
import path from 'path'
import { sourcePool, targetPool, withClient, closePools } from './shared/clients'
import type { PoolClient } from 'pg'

const DRY_RUN = process.argv.includes('--dry-run')
const STATE_DIR = path.resolve(__dirname, 'state')

interface TenantConfig { tenantId: string; slug: string }

function loadTenantConfig(): TenantConfig {
  const file = path.join(STATE_DIR, 'tenant-config.json')
  if (!fs.existsSync(file)) throw new Error('tenant-config.json missing. Run 01-bootstrap-tenant.ts.')
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

async function existingIds(c: PoolClient, table: string, tenantId: string): Promise<Set<string>> {
  const { rows } = await c.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE tenant_id = $1`,
    [tenantId]
  )
  return new Set(rows.map((r) => r.id))
}

async function migrateSalesTransactions(tenantId: string): Promise<{ ids: Set<string>; stats: { inserted: number; updated: number; conflicts: number } }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, square_order_id, location_id, order_number, tender_total_money,
             tender_currency, tender_type, customer_name, ordered_at, synced_at,
             raw_payload
      FROM sales_transactions ORDER BY ordered_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source sales_transactions: ${source.length}`)

  let inserted = 0, updated = 0, conflicts = 0
  const ids = new Set<string>()
  const t0 = Date.now()

  await withClient(targetPool, async (c) => {
    for (let i = 0; i < source.length; i++) {
      const row = source[i]
      if (DRY_RUN) { ids.add(row.id); continue }

      try {
        const { rows } = await c.query<{ action: string }>(
          `
          INSERT INTO sales_transactions (
            id, tenant_id, square_order_id, location_id, order_number, tender_total_money,
            tender_currency, tender_type, customer_name, ordered_at, synced_at,
            sync_run_id, raw_payload
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12)
          ON CONFLICT (id) DO UPDATE SET
            square_order_id    = EXCLUDED.square_order_id,
            location_id        = EXCLUDED.location_id,
            order_number       = EXCLUDED.order_number,
            tender_total_money = EXCLUDED.tender_total_money,
            tender_currency    = EXCLUDED.tender_currency,
            tender_type        = EXCLUDED.tender_type,
            customer_name      = EXCLUDED.customer_name,
            ordered_at         = EXCLUDED.ordered_at,
            synced_at          = EXCLUDED.synced_at,
            raw_payload        = EXCLUDED.raw_payload
          RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
          `,
          [
            row.id, tenantId, row.square_order_id, row.location_id, row.order_number,
            row.tender_total_money, row.tender_currency, row.tender_type, row.customer_name,
            row.ordered_at, row.synced_at, row.raw_payload,
          ]
        )
        if (rows[0].action === 'inserted') inserted++; else updated++
        ids.add(row.id)
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('sales_transactions_square_order_id_key')) {
          // Another tenant already claimed this square_order_id. Extremely rare.
          conflicts++
          console.log(`  ⚠️  square_order_id=${row.square_order_id} collides across tenants — skipping`)
          continue
        }
        throw err
      }

      if ((i + 1) % 1000 === 0) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
        console.log(`    ...processed ${i + 1}/${source.length} (${elapsed}s)`)
      }
    }
  })
  return { ids, stats: { inserted, updated, conflicts } }
}

async function migrateSalesTransactionItems(tenantId: string, txIds: Set<string>): Promise<{ inserted: number; updated: number; orphans: number; nullifiedInvRefs: number }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, transaction_id, inventory_item_id, square_catalog_object_id, name,
             quantity, impact_type, impact_reason, unit, metadata, created_at
      FROM sales_transaction_items ORDER BY created_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source sales_transaction_items: ${source.length}`)

  let inserted = 0, updated = 0, orphans = 0, nullifiedInvRefs = 0
  const t0 = Date.now()

  await withClient(targetPool, async (c) => {
    const invIds = await existingIds(c, 'inventory_items', tenantId)

    for (let i = 0; i < source.length; i++) {
      const row = source[i]
      if (!txIds.has(row.transaction_id)) { orphans++; continue }

      // Graceful degrade on inventory_item_id — NULL it if missing rather than
      // dropping the row (which would hurt revenue reporting).
      let invId = row.inventory_item_id
      if (invId && !invIds.has(invId)) { invId = null; nullifiedInvRefs++ }

      if (DRY_RUN) continue

      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO sales_transaction_items (
          id, tenant_id, transaction_id, inventory_item_id, square_catalog_object_id, name,
          quantity, impact_type, impact_reason, unit, metadata, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO UPDATE SET
          transaction_id           = EXCLUDED.transaction_id,
          inventory_item_id        = EXCLUDED.inventory_item_id,
          square_catalog_object_id = EXCLUDED.square_catalog_object_id,
          name                     = EXCLUDED.name,
          quantity                 = EXCLUDED.quantity,
          impact_type              = EXCLUDED.impact_type,
          impact_reason            = EXCLUDED.impact_reason,
          unit                     = EXCLUDED.unit,
          metadata                 = EXCLUDED.metadata
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          row.id, tenantId, row.transaction_id, invId, row.square_catalog_object_id, row.name,
          row.quantity, row.impact_type, row.impact_reason, row.unit, row.metadata, row.created_at,
        ]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++

      if ((i + 1) % 1000 === 0) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
        console.log(`    ...processed ${i + 1}/${source.length} (${elapsed}s)`)
      }
    }
  })
  return { inserted, updated, orphans, nullifiedInvRefs }
}

async function main() {
  const tenant = loadTenantConfig()
  console.log('💰 Phase 2.6: Migrate sales_transactions + sales_transaction_items')
  console.log(`   Tenant:  ${tenant.slug} (${tenant.tenantId})`)
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log('')

  console.log('── sales_transactions ──')
  const txs = await migrateSalesTransactions(tenant.tenantId)
  console.log(DRY_RUN
    ? `  [dry-run] Would process ${txs.ids.size}`
    : `  ✅ ${txs.stats.inserted} inserted, ${txs.stats.updated} updated${txs.stats.conflicts ? `, ${txs.stats.conflicts} cross-tenant conflicts` : ''}`)

  console.log('\n── sales_transaction_items ──')
  const items = await migrateSalesTransactionItems(tenant.tenantId, txs.ids)
  console.log(DRY_RUN
    ? `  [dry-run] Would process (orphans=${items.orphans}, invRefs NULLed=${items.nullifiedInvRefs})`
    : `  ✅ ${items.inserted} inserted, ${items.updated} updated, ${items.orphans} orphans, ${items.nullifiedInvRefs} invRefs NULLed`)

  // Verify + revenue parity
  console.log('\n→ Verification:')
  await withClient(targetPool, async (c) => {
    const { rows: tc } = await c.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM sales_transactions WHERE tenant_id = $1`,
      [tenant.tenantId]
    )
    const { rows: ic } = await c.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM sales_transaction_items WHERE tenant_id = $1`,
      [tenant.tenantId]
    )
    const { rows: rev } = await c.query<{ revenue: string }>(
      `SELECT COALESCE(SUM(tender_total_money), 0)::text AS revenue FROM sales_transactions WHERE tenant_id = $1`,
      [tenant.tenantId]
    )
    console.log(`  sales_transactions       target=${tc[0].c}`)
    console.log(`  sales_transaction_items  target=${ic[0].c}`)
    console.log(`  total revenue (target):  $${Number(rev[0].revenue).toFixed(2)}`)
  })

  await withClient(sourcePool, async (c) => {
    const { rows } = await c.query<{ revenue: string }>(
      `SELECT COALESCE(SUM(tender_total_money), 0)::text AS revenue FROM sales_transactions`
    )
    console.log(`  total revenue (source):  $${Number(rows[0].revenue).toFixed(2)}`)
  })

  console.log('\n' + '─'.repeat(60))
  console.log('✅ Sales transactions migration complete')
  console.log('─'.repeat(60))
}

main()
  .catch((err) => {
    console.error('💥 Migration failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => closePools())
