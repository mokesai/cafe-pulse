#!/usr/bin/env node
/**
 * MOK-91 — Phase 2.3: Migrate suppliers + inventory_items + inventory_item_cost_history.
 *
 * Row counts (source):
 *   - suppliers                    13
 *   - inventory_items             292
 *   - inventory_item_cost_history 195
 *
 * Schema deltas on target:
 *   - suppliers                   +tenant_id
 *   - inventory_items             +tenant_id  (MOK-63 multi-supplier composite unique — source shape still fits)
 *   - inventory_item_cost_history +tenant_id +fee_amount (NULL for historical rows — MOK-66)
 *
 * Strategy:
 *   - Preserve source UUIDs. Downstream FKs (inventory_items.supplier_id,
 *     cost_history.inventory_item_id, etc.) stay valid without a UUID map.
 *   - Always set tenant_id explicitly (default on target is littlecafe).
 *   - ON CONFLICT (id) DO UPDATE for idempotency — simpler than targeting
 *     the partial composite unique index.
 *
 * Ordering: suppliers → inventory_items → inventory_item_cost_history.
 *
 * Usage:
 *   npx tsx scripts/migrate-from-cafeweb/04-suppliers-inventory.ts [--dry-run]
 */

import fs from 'fs'
import path from 'path'
import { sourcePool, targetPool, withClient, closePools } from './shared/clients'

const DRY_RUN = process.argv.includes('--dry-run')
const STATE_DIR = path.resolve(__dirname, 'state')

interface TenantConfig {
  tenantId: string
  slug: string
}

function loadTenantConfig(): TenantConfig {
  const file = path.join(STATE_DIR, 'tenant-config.json')
  if (!fs.existsSync(file)) {
    throw new Error('tenant-config.json not found. Run 01-bootstrap-tenant.ts first.')
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

async function migrateSuppliers(tenantId: string): Promise<{ ids: Set<string>; inserted: number; updated: number }> {
  const ids = new Set<string>()
  let inserted = 0, updated = 0

  const source = await withClient(sourcePool, async (c) => {
    const { rows } = await c.query(`
      SELECT id, name, contact_person, email, phone, address, payment_terms, notes,
             is_active, created_at, updated_at
      FROM suppliers ORDER BY created_at
    `)
    return rows
  })
  console.log(`→ Source suppliers: ${source.length}`)

  if (!DRY_RUN) {
    await withClient(targetPool, async (c) => {
      for (const s of source) {
        const { rows } = await c.query<{ action: string }>(
          `
          INSERT INTO suppliers (id, tenant_id, name, contact_person, email, phone, address,
                                  payment_terms, notes, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO UPDATE SET
            name           = EXCLUDED.name,
            contact_person = EXCLUDED.contact_person,
            email          = EXCLUDED.email,
            phone          = EXCLUDED.phone,
            address        = EXCLUDED.address,
            payment_terms  = EXCLUDED.payment_terms,
            notes          = EXCLUDED.notes,
            is_active      = EXCLUDED.is_active,
            updated_at     = EXCLUDED.updated_at
          RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
          `,
          [
            s.id, tenantId, s.name, s.contact_person, s.email, s.phone, s.address,
            s.payment_terms, s.notes, s.is_active, s.created_at, s.updated_at,
          ]
        )
        if (rows[0].action === 'inserted') inserted++; else updated++
        ids.add(s.id)
      }
    })
  } else {
    for (const s of source) ids.add(s.id)
  }
  return { ids, inserted, updated }
}

async function migrateInventoryItems(
  tenantId: string,
  supplierIds: Set<string>
): Promise<{ ids: Set<string>; inserted: number; updated: number; orphans: number }> {
  const ids = new Set<string>()
  let inserted = 0, updated = 0, orphans = 0

  const source = await withClient(sourcePool, async (c) => {
    const { rows } = await c.query(`
      SELECT id, square_item_id, item_name, current_stock, minimum_threshold, reorder_point,
             unit_cost, unit_type, is_ingredient, supplier_id, location, notes, last_restocked_at,
             created_at, updated_at, auto_decrement, item_type, deleted_at, pack_size
      FROM inventory_items ORDER BY created_at
    `)
    return rows
  })
  console.log(`→ Source inventory_items: ${source.length}`)

  await withClient(targetPool, async (c) => {
    for (const i of source) {
      // Orphan guard: supplier_id must exist in migrated set (or be NULL).
      if (i.supplier_id && !supplierIds.has(i.supplier_id)) {
        console.log(`  ⚠️  inventory_item ${i.id} (${i.item_name}) references missing supplier_id=${i.supplier_id} — skipping`)
        orphans++
        continue
      }
      if (DRY_RUN) {
        ids.add(i.id)
        continue
      }
      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO inventory_items (
          id, tenant_id, square_item_id, item_name, current_stock, minimum_threshold, reorder_point,
          unit_cost, unit_type, is_ingredient, supplier_id, location, notes, last_restocked_at,
          created_at, updated_at, auto_decrement, item_type, deleted_at, pack_size
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (id) DO UPDATE SET
          square_item_id     = EXCLUDED.square_item_id,
          item_name          = EXCLUDED.item_name,
          current_stock      = EXCLUDED.current_stock,
          minimum_threshold  = EXCLUDED.minimum_threshold,
          reorder_point      = EXCLUDED.reorder_point,
          unit_cost          = EXCLUDED.unit_cost,
          unit_type          = EXCLUDED.unit_type,
          is_ingredient      = EXCLUDED.is_ingredient,
          supplier_id        = EXCLUDED.supplier_id,
          location           = EXCLUDED.location,
          notes              = EXCLUDED.notes,
          last_restocked_at  = EXCLUDED.last_restocked_at,
          updated_at         = EXCLUDED.updated_at,
          auto_decrement     = EXCLUDED.auto_decrement,
          item_type          = EXCLUDED.item_type,
          deleted_at         = EXCLUDED.deleted_at,
          pack_size          = EXCLUDED.pack_size
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          i.id, tenantId, i.square_item_id, i.item_name, i.current_stock, i.minimum_threshold, i.reorder_point,
          i.unit_cost, i.unit_type, i.is_ingredient, i.supplier_id, i.location, i.notes, i.last_restocked_at,
          i.created_at, i.updated_at, i.auto_decrement, i.item_type, i.deleted_at, i.pack_size,
        ]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
      ids.add(i.id)
    }
  })
  return { ids, inserted, updated, orphans }
}

async function migrateCostHistory(
  tenantId: string,
  inventoryIds: Set<string>
): Promise<{ inserted: number; updated: number; orphans: number }> {
  let inserted = 0, updated = 0, orphans = 0

  const source = await withClient(sourcePool, async (c) => {
    const { rows } = await c.query(`
      SELECT id, inventory_item_id, previous_unit_cost, new_unit_cost, pack_size, source,
             source_ref, notes, changed_by, changed_at
      FROM inventory_item_cost_history ORDER BY changed_at
    `)
    return rows
  })
  console.log(`→ Source inventory_item_cost_history: ${source.length}`)

  await withClient(targetPool, async (c) => {
    for (const h of source) {
      if (!inventoryIds.has(h.inventory_item_id)) {
        console.log(`  ⚠️  cost_history ${h.id} references missing inventory_item_id=${h.inventory_item_id} — skipping`)
        orphans++
        continue
      }
      if (DRY_RUN) continue
      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO inventory_item_cost_history (
          id, tenant_id, inventory_item_id, previous_unit_cost, new_unit_cost, pack_size,
          source, source_ref, notes, changed_by, changed_at, fee_amount
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)
        ON CONFLICT (id) DO UPDATE SET
          previous_unit_cost = EXCLUDED.previous_unit_cost,
          new_unit_cost      = EXCLUDED.new_unit_cost,
          pack_size          = EXCLUDED.pack_size,
          source             = EXCLUDED.source,
          source_ref         = EXCLUDED.source_ref,
          notes              = EXCLUDED.notes,
          changed_by         = EXCLUDED.changed_by,
          changed_at         = EXCLUDED.changed_at
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          h.id, tenantId, h.inventory_item_id, h.previous_unit_cost, h.new_unit_cost, h.pack_size,
          h.source, h.source_ref, h.notes, h.changed_by, h.changed_at,
        ]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
    }
  })
  return { inserted, updated, orphans }
}

async function main() {
  const tenant = loadTenantConfig()
  console.log('📦 Phase 2.3: Migrate suppliers + inventory_items + cost_history')
  console.log(`   Tenant:  ${tenant.slug} (${tenant.tenantId})`)
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log('')

  console.log('── suppliers ──')
  const suppliers = await migrateSuppliers(tenant.tenantId)
  console.log(DRY_RUN
    ? `  [dry-run] Would process ${suppliers.ids.size} suppliers`
    : `  ✅ ${suppliers.inserted} inserted, ${suppliers.updated} updated`)

  console.log('')
  console.log('── inventory_items ──')
  const inventory = await migrateInventoryItems(tenant.tenantId, suppliers.ids)
  console.log(DRY_RUN
    ? `  [dry-run] Would process ${inventory.ids.size} inventory_items (${inventory.orphans} orphans skipped)`
    : `  ✅ ${inventory.inserted} inserted, ${inventory.updated} updated${inventory.orphans ? `, ${inventory.orphans} orphans skipped` : ''}`)

  console.log('')
  console.log('── inventory_item_cost_history ──')
  const history = await migrateCostHistory(tenant.tenantId, inventory.ids)
  console.log(DRY_RUN
    ? `  [dry-run] Would process cost_history with ${history.orphans} orphans skipped`
    : `  ✅ ${history.inserted} inserted, ${history.updated} updated${history.orphans ? `, ${history.orphans} orphans skipped` : ''}`)

  // ── Verify target row counts ──────────────────────────────────────────
  console.log('')
  console.log('→ Target row counts for JMC tenant:')
  await withClient(targetPool, async (c) => {
    for (const tbl of ['suppliers', 'inventory_items', 'inventory_item_cost_history']) {
      const { rows } = await c.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM ${tbl} WHERE tenant_id = $1`,
        [tenant.tenantId]
      )
      console.log(`  ${tbl.padEnd(32)} target=${rows[0].c}`)
    }
  })

  console.log('')
  console.log('─'.repeat(60))
  console.log('✅ Suppliers + inventory migration complete')
  console.log('─'.repeat(60))
}

main()
  .catch((err) => {
    console.error('💥 Migration failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => closePools())
