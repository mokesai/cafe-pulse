#!/usr/bin/env node
/**
 * MOK-92 — Phase 2.4: Migrate purchase orders + items + receipts + status history
 *                     + attachments + stock movements.
 *
 * Row counts (source):
 *   - purchase_orders                106
 *   - purchase_order_items           625
 *   - purchase_order_receipts        345
 *   - purchase_order_status_history  502
 *   - purchase_order_attachments       4
 *   - stock_movements                337
 *
 * Schema deltas on target: all six tables gain +tenant_id, nothing else.
 *
 * Status enums (all source values validated as subset of target CHECKs):
 *   - purchase_orders.status, purchase_order_status_history.new_status:
 *     {draft, pending_approval, approved, sent, received, cancelled, confirmed}
 *   - stock_movements.movement_type: {purchase, sale, adjustment, waste, transfer}
 *
 * Strategy:
 *   - Preserve source UUIDs.
 *   - ON CONFLICT (id) DO UPDATE for idempotency.
 *   - Explicit tenant_id on every insert.
 *   - Orphan guards on every FK (po_id, inventory_item_id, po_item_id).
 *
 * Ordering: purchase_orders → (items, receipts, status_history, attachments) → stock_movements.
 *
 * Usage:
 *   npx tsx scripts/migrate-from-cafeweb/05-purchase-orders.ts [--dry-run]
 */

import fs from 'fs'
import path from 'path'
import { sourcePool, targetPool, withClient, closePools } from './shared/clients'
import { buildUserIdRemap, remapUser } from './shared/user-remap'
import type { PoolClient } from 'pg'

const DRY_RUN = process.argv.includes('--dry-run')
const STATE_DIR = path.resolve(__dirname, 'state')

// Module-scope user remap (source UUID → target UUID | null).
// Initialized in main(); each `*_by` write uses remapUser(USER_MAP, srcId).
let USER_MAP: Map<string, string | null> = new Map()

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

async function migratePurchaseOrders(tenantId: string): Promise<{ ids: Set<string>; stats: { inserted: number; updated: number } }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, supplier_id, order_number, status, order_date, expected_delivery_date,
             actual_delivery_date, total_amount, notes, created_by, created_at, updated_at,
             sent_at, sent_by, sent_via, sent_notes, received_at, approved_at, confirmed_at
      FROM purchase_orders ORDER BY created_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source purchase_orders: ${source.length}`)

  let inserted = 0, updated = 0
  const ids = new Set<string>()
  if (DRY_RUN) {
    for (const po of source) ids.add(po.id)
    return { ids, stats: { inserted: 0, updated: 0 } }
  }

  await withClient(targetPool, async (c) => {
    for (const po of source) {
      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO purchase_orders (
          id, tenant_id, supplier_id, order_number, status, order_date, expected_delivery_date,
          actual_delivery_date, total_amount, notes, created_by, created_at, updated_at,
          sent_at, sent_by, sent_via, sent_notes, received_at, approved_at, confirmed_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (id) DO UPDATE SET
          supplier_id            = EXCLUDED.supplier_id,
          order_number           = EXCLUDED.order_number,
          status                 = EXCLUDED.status,
          order_date             = EXCLUDED.order_date,
          expected_delivery_date = EXCLUDED.expected_delivery_date,
          actual_delivery_date   = EXCLUDED.actual_delivery_date,
          total_amount           = EXCLUDED.total_amount,
          notes                  = EXCLUDED.notes,
          created_by             = EXCLUDED.created_by,
          updated_at             = EXCLUDED.updated_at,
          sent_at                = EXCLUDED.sent_at,
          sent_by                = EXCLUDED.sent_by,
          sent_via               = EXCLUDED.sent_via,
          sent_notes             = EXCLUDED.sent_notes,
          received_at            = EXCLUDED.received_at,
          approved_at            = EXCLUDED.approved_at,
          confirmed_at           = EXCLUDED.confirmed_at
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          po.id, tenantId, po.supplier_id, po.order_number, po.status, po.order_date,
          po.expected_delivery_date, po.actual_delivery_date, po.total_amount, po.notes,
          remapUser(USER_MAP, po.created_by), po.created_at, po.updated_at,
          po.sent_at, remapUser(USER_MAP, po.sent_by), po.sent_via, po.sent_notes, po.received_at,
          po.approved_at, po.confirmed_at,
        ]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
      ids.add(po.id)
    }
  })
  return { ids, stats: { inserted, updated } }
}

async function migratePoItems(
  tenantId: string, poIds: Set<string>
): Promise<{ ids: Set<string>; stats: { inserted: number; updated: number; orphans: number; invalidQty: number } }> {
  // total_cost is a GENERATED ALWAYS column on target (= quantity_ordered * unit_cost).
  // Don't select or insert it.
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, purchase_order_id, inventory_item_id, quantity_ordered, quantity_received,
             unit_cost, created_at, updated_at, is_excluded, exclusion_reason,
             excluded_at, excluded_by, exclusion_phase, ordered_pack_qty, pack_size
      FROM purchase_order_items ORDER BY created_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source purchase_order_items: ${source.length}`)

  let inserted = 0, updated = 0, orphans = 0, invalidQty = 0
  const ids = new Set<string>()

  await withClient(targetPool, async (c) => {
    // Also need to verify inventory_item_id exists on target under this tenant.
    const invIds = await existingIds(c, 'inventory_items', tenantId)
    for (const row of source) {
      if (!poIds.has(row.purchase_order_id)) { orphans++; continue }
      if (!invIds.has(row.inventory_item_id)) { orphans++; continue }
      if (!row.quantity_ordered || row.quantity_ordered <= 0) { invalidQty++; continue }  // target CHECK: > 0
      if (DRY_RUN) { ids.add(row.id); continue }

      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO purchase_order_items (
          id, tenant_id, purchase_order_id, inventory_item_id, quantity_ordered, quantity_received,
          unit_cost, created_at, updated_at, is_excluded, exclusion_reason,
          excluded_at, excluded_by, exclusion_phase, ordered_pack_qty, pack_size
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (id) DO UPDATE SET
          quantity_ordered  = EXCLUDED.quantity_ordered,
          quantity_received = EXCLUDED.quantity_received,
          unit_cost         = EXCLUDED.unit_cost,
          updated_at        = EXCLUDED.updated_at,
          is_excluded       = EXCLUDED.is_excluded,
          exclusion_reason  = EXCLUDED.exclusion_reason,
          excluded_at       = EXCLUDED.excluded_at,
          excluded_by       = EXCLUDED.excluded_by,
          exclusion_phase   = EXCLUDED.exclusion_phase,
          ordered_pack_qty  = EXCLUDED.ordered_pack_qty,
          pack_size         = EXCLUDED.pack_size
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          row.id, tenantId, row.purchase_order_id, row.inventory_item_id, row.quantity_ordered,
          row.quantity_received, row.unit_cost, row.created_at, row.updated_at,
          row.is_excluded, row.exclusion_reason, row.excluded_at, remapUser(USER_MAP, row.excluded_by),
          row.exclusion_phase, row.ordered_pack_qty, row.pack_size,
        ]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
      ids.add(row.id)
    }
  })
  return { ids, stats: { inserted, updated, orphans, invalidQty } }
}

async function migratePoReceipts(
  tenantId: string, poIds: Set<string>, poItemIds: Set<string>
): Promise<{ inserted: number; updated: number; orphans: number; invalidQty: number }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, purchase_order_id, purchase_order_item_id, quantity_received, weight, weight_unit,
             notes, photo_path, photo_url, received_by, received_at, created_at
      FROM purchase_order_receipts ORDER BY created_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source purchase_order_receipts: ${source.length}`)

  let inserted = 0, updated = 0, orphans = 0, invalidQty = 0

  await withClient(targetPool, async (c) => {
    for (const row of source) {
      if (!poIds.has(row.purchase_order_id)) { orphans++; continue }
      if (!poItemIds.has(row.purchase_order_item_id)) { orphans++; continue }
      if (!row.quantity_received || row.quantity_received <= 0) { invalidQty++; continue }  // target CHECK: > 0
      if (DRY_RUN) continue

      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO purchase_order_receipts (
          id, tenant_id, purchase_order_id, purchase_order_item_id, quantity_received,
          weight, weight_unit, notes, photo_path, photo_url, received_by, received_at, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO UPDATE SET
          quantity_received = EXCLUDED.quantity_received,
          weight            = EXCLUDED.weight,
          weight_unit       = EXCLUDED.weight_unit,
          notes             = EXCLUDED.notes,
          photo_path        = EXCLUDED.photo_path,
          photo_url         = EXCLUDED.photo_url,
          received_by       = EXCLUDED.received_by,
          received_at       = EXCLUDED.received_at
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          row.id, tenantId, row.purchase_order_id, row.purchase_order_item_id, row.quantity_received,
          row.weight, row.weight_unit, row.notes, row.photo_path, row.photo_url,
          remapUser(USER_MAP, row.received_by), row.received_at, row.created_at,
        ]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
    }
  })
  return { inserted, updated, orphans, invalidQty }
}

async function migratePoStatusHistory(
  tenantId: string, poIds: Set<string>
): Promise<{ inserted: number; updated: number; orphans: number }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, purchase_order_id, previous_status, new_status, changed_by, note, changed_at
      FROM purchase_order_status_history ORDER BY changed_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source purchase_order_status_history: ${source.length}`)

  let inserted = 0, updated = 0, orphans = 0

  await withClient(targetPool, async (c) => {
    for (const row of source) {
      if (!poIds.has(row.purchase_order_id)) { orphans++; continue }
      if (DRY_RUN) continue

      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO purchase_order_status_history (
          id, tenant_id, purchase_order_id, previous_status, new_status, changed_by, note, changed_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET
          previous_status = EXCLUDED.previous_status,
          new_status      = EXCLUDED.new_status,
          changed_by      = EXCLUDED.changed_by,
          note            = EXCLUDED.note,
          changed_at      = EXCLUDED.changed_at
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [row.id, tenantId, row.purchase_order_id, row.previous_status, row.new_status,
         remapUser(USER_MAP, row.changed_by), row.note, row.changed_at]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
    }
  })
  return { inserted, updated, orphans }
}

async function migratePoAttachments(
  tenantId: string, poIds: Set<string>
): Promise<{ inserted: number; updated: number; orphans: number }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, purchase_order_id, file_name, file_url, storage_path, file_type, file_size,
             uploaded_by, notes, uploaded_at
      FROM purchase_order_attachments ORDER BY uploaded_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source purchase_order_attachments: ${source.length}`)

  let inserted = 0, updated = 0, orphans = 0

  await withClient(targetPool, async (c) => {
    for (const row of source) {
      if (!poIds.has(row.purchase_order_id)) { orphans++; continue }
      if (DRY_RUN) continue

      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO purchase_order_attachments (
          id, tenant_id, purchase_order_id, file_name, file_url, storage_path,
          file_type, file_size, uploaded_by, notes, uploaded_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO UPDATE SET
          file_name    = EXCLUDED.file_name,
          file_url     = EXCLUDED.file_url,
          storage_path = EXCLUDED.storage_path,
          file_type    = EXCLUDED.file_type,
          file_size    = EXCLUDED.file_size,
          uploaded_by  = EXCLUDED.uploaded_by,
          notes        = EXCLUDED.notes
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [row.id, tenantId, row.purchase_order_id, row.file_name, row.file_url, row.storage_path,
         row.file_type, row.file_size, remapUser(USER_MAP, row.uploaded_by), row.notes, row.uploaded_at]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
    }
  })
  return { inserted, updated, orphans }
}

async function migrateStockMovements(
  tenantId: string
): Promise<{ inserted: number; updated: number; orphans: number }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, inventory_item_id, movement_type, quantity_change, previous_stock, new_stock,
             unit_cost, reference_id, notes, created_by, created_at
      FROM stock_movements ORDER BY created_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source stock_movements: ${source.length}`)

  let inserted = 0, updated = 0, orphans = 0

  await withClient(targetPool, async (c) => {
    const invIds = await existingIds(c, 'inventory_items', tenantId)
    for (const row of source) {
      if (!invIds.has(row.inventory_item_id)) { orphans++; continue }
      if (DRY_RUN) continue

      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO stock_movements (
          id, tenant_id, inventory_item_id, movement_type, quantity_change, previous_stock,
          new_stock, unit_cost, reference_id, notes, created_by, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO UPDATE SET
          movement_type   = EXCLUDED.movement_type,
          quantity_change = EXCLUDED.quantity_change,
          previous_stock  = EXCLUDED.previous_stock,
          new_stock       = EXCLUDED.new_stock,
          unit_cost       = EXCLUDED.unit_cost,
          reference_id    = EXCLUDED.reference_id,
          notes           = EXCLUDED.notes,
          created_by      = EXCLUDED.created_by
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [row.id, tenantId, row.inventory_item_id, row.movement_type, row.quantity_change,
         row.previous_stock, row.new_stock, row.unit_cost, row.reference_id, row.notes,
         remapUser(USER_MAP, row.created_by), row.created_at]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
    }
  })
  return { inserted, updated, orphans }
}

async function main() {
  const tenant = loadTenantConfig()
  console.log('📋 Phase 2.4: Migrate purchase order family + stock movements')
  console.log(`   Tenant:  ${tenant.slug} (${tenant.tenantId})`)
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log('')

  // Build source → target user ID remap (null for any source user not on target).
  USER_MAP = await buildUserIdRemap()
  const mappedCount = [...USER_MAP.values()].filter((v) => v !== null).length
  const unmappedCount = USER_MAP.size - mappedCount
  console.log(`→ User remap: ${mappedCount} mapped, ${unmappedCount} unmapped (will set *_by = NULL)`)
  console.log('')

  console.log('── purchase_orders ──')
  const pos = await migratePurchaseOrders(tenant.tenantId)
  console.log(DRY_RUN
    ? `  [dry-run] Would process ${pos.ids.size}`
    : `  ✅ ${pos.stats.inserted} inserted, ${pos.stats.updated} updated`)

  console.log('\n── purchase_order_items ──')
  const items = await migratePoItems(tenant.tenantId, pos.ids)
  console.log(DRY_RUN
    ? `  [dry-run] Would process ${items.ids.size} (orphans=${items.stats.orphans}, invalidQty=${items.stats.invalidQty})`
    : `  ✅ ${items.stats.inserted} inserted, ${items.stats.updated} updated, ${items.stats.orphans} orphans, ${items.stats.invalidQty} invalidQty skipped`)

  console.log('\n── purchase_order_receipts ──')
  const receipts = await migratePoReceipts(tenant.tenantId, pos.ids, items.ids)
  console.log(DRY_RUN
    ? `  [dry-run] Would process (orphans=${receipts.orphans}, invalidQty=${receipts.invalidQty})`
    : `  ✅ ${receipts.inserted} inserted, ${receipts.updated} updated, ${receipts.orphans} orphans, ${receipts.invalidQty} invalidQty skipped`)

  console.log('\n── purchase_order_status_history ──')
  const history = await migratePoStatusHistory(tenant.tenantId, pos.ids)
  console.log(DRY_RUN
    ? `  [dry-run] Would process (orphans=${history.orphans})`
    : `  ✅ ${history.inserted} inserted, ${history.updated} updated, ${history.orphans} orphans`)

  console.log('\n── purchase_order_attachments ──')
  const attach = await migratePoAttachments(tenant.tenantId, pos.ids)
  console.log(DRY_RUN
    ? `  [dry-run] Would process (orphans=${attach.orphans})`
    : `  ✅ ${attach.inserted} inserted, ${attach.updated} updated, ${attach.orphans} orphans`)

  console.log('\n── stock_movements ──')
  const moves = await migrateStockMovements(tenant.tenantId)
  console.log(DRY_RUN
    ? `  [dry-run] Would process (orphans=${moves.orphans})`
    : `  ✅ ${moves.inserted} inserted, ${moves.updated} updated, ${moves.orphans} orphans`)

  // Verify
  console.log('\n→ Target row counts for JMC tenant:')
  await withClient(targetPool, async (c) => {
    for (const tbl of ['purchase_orders', 'purchase_order_items', 'purchase_order_receipts',
                       'purchase_order_status_history', 'purchase_order_attachments', 'stock_movements']) {
      const { rows } = await c.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM ${tbl} WHERE tenant_id = $1`,
        [tenant.tenantId]
      )
      console.log(`  ${tbl.padEnd(36)} target=${rows[0].c}`)
    }
  })

  console.log('\n' + '─'.repeat(60))
  console.log('✅ Purchase order family + stock movements migration complete')
  console.log('─'.repeat(60))
}

main()
  .catch((err) => {
    console.error('💥 Migration failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => closePools())
