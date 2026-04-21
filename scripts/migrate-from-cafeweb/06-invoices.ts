#!/usr/bin/env node
/**
 * MOK-93 — Phase 2.5: Migrate invoices + invoice_items + order_invoice_matches.
 *
 * Row counts (source):
 *   - invoices              96
 *   - invoice_items        556
 *   - order_invoice_matches 94
 *
 * Schema deltas:
 *   - invoices:              +tenant_id, +pipeline_stage, +pipeline_started_at,
 *                            +pipeline_completed_at, +pipeline_error, +vision_confidence,
 *                            +open_exception_count, +supplier_fees, +total_fees,
 *                            +fee_source, +fee_cogs_distributed
 *   - invoice_items:         +tenant_id, +vision_item_confidence
 *   - order_invoice_matches: +tenant_id
 *
 * Pipeline column strategy for historical invoices:
 *   - pipeline_stage based on source status:
 *       'confirmed'/'matched' → 'completed'  (shows as terminal-good in UI)
 *       'error'               → 'failed'      (shows as terminal-bad)
 *       'parsed'/other        → NULL          (legacy, not in pipeline)
 *   - pipeline_started_at   = source.processed_at || source.created_at
 *   - pipeline_completed_at = source.confirmed_at || source.processed_at || NULL
 *   - pipeline_error        = source.parsing_error (for status='error' only)
 *   - vision_confidence     = NULL (source parsing_confidence is from a different
 *                                    model — not a 1:1 match with GPT-4o Vision)
 *   - open_exception_count  = 0
 *   - supplier_fees / total_fees / fee_source / fee_cogs_distributed = defaults
 *
 * Webhook safety: target's invoice-pipeline webhook filters status='uploaded'.
 *   Source has no 'uploaded' rows (all confirmed/error/matched/parsed), so no
 *   risk of re-triggering the AI pipeline on insert.
 *
 * Usage:
 *   npx tsx scripts/migrate-from-cafeweb/06-invoices.ts [--dry-run]
 */

import fs from 'fs'
import path from 'path'
import { sourcePool, targetPool, withClient, closePools } from './shared/clients'
import { buildUserIdRemap, remapUser } from './shared/user-remap'
import type { PoolClient } from 'pg'

const DRY_RUN = process.argv.includes('--dry-run')
const STATE_DIR = path.resolve(__dirname, 'state')

let USER_MAP: Map<string, string | null> = new Map()

interface TenantConfig { tenantId: string; slug: string }

function loadTenantConfig(): TenantConfig {
  const file = path.join(STATE_DIR, 'tenant-config.json')
  if (!fs.existsSync(file)) throw new Error('tenant-config.json missing. Run 01-bootstrap-tenant.ts.')
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function mapPipelineStage(sourceStatus: string): string | null {
  if (sourceStatus === 'confirmed' || sourceStatus === 'matched') return 'completed'
  if (sourceStatus === 'error') return 'failed'
  return null
}

async function existingIds(c: PoolClient, table: string, tenantId: string): Promise<Set<string>> {
  const { rows } = await c.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE tenant_id = $1`,
    [tenantId]
  )
  return new Set(rows.map((r) => r.id))
}

async function migrateInvoices(tenantId: string): Promise<{ ids: Set<string>; stats: { inserted: number; updated: number; orphans: number } }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, supplier_id, invoice_number, invoice_date, due_date, total_amount,
             file_url, file_name, file_size, file_type, status, parsed_data, parsing_confidence,
             parsing_error, created_at, updated_at, created_by, processed_at, processed_by,
             file_path, raw_text, clean_text, text_analysis, confirmed_at
      FROM invoices ORDER BY created_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source invoices: ${source.length}`)

  let inserted = 0, updated = 0, orphans = 0
  const ids = new Set<string>()

  await withClient(targetPool, async (c) => {
    const supplierIds = await existingIds(c, 'suppliers', tenantId)

    for (const inv of source) {
      if (inv.supplier_id && !supplierIds.has(inv.supplier_id)) {
        console.log(`  ⚠️  invoice ${inv.invoice_number} references missing supplier_id=${inv.supplier_id} — skipping`)
        orphans++
        continue
      }

      // Derived pipeline fields based on source status.
      const pipelineStage = mapPipelineStage(inv.status)
      const pipelineStartedAt = inv.processed_at ?? inv.created_at
      const pipelineCompletedAt = inv.confirmed_at ?? inv.processed_at ?? null
      const pipelineError = inv.status === 'error' ? inv.parsing_error : null

      if (DRY_RUN) { ids.add(inv.id); continue }

      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO invoices (
          id, tenant_id, supplier_id, invoice_number, invoice_date, due_date, total_amount,
          file_url, file_name, file_size, file_type, status, parsed_data, parsing_confidence,
          parsing_error, created_at, updated_at, created_by, processed_at, processed_by,
          file_path, raw_text, clean_text, text_analysis, confirmed_at,
          pipeline_stage, pipeline_started_at, pipeline_completed_at, pipeline_error,
          vision_confidence, open_exception_count, supplier_fees, total_fees,
          fee_source, fee_cogs_distributed
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                $21,$22,$23,$24,$25,$26,$27,$28,$29,NULL,0,
                '{"other":0,"delivery":0,"shipping":0,"processing":0}'::jsonb,
                0,'none',false)
        ON CONFLICT (id) DO UPDATE SET
          supplier_id            = EXCLUDED.supplier_id,
          invoice_number         = EXCLUDED.invoice_number,
          invoice_date           = EXCLUDED.invoice_date,
          due_date               = EXCLUDED.due_date,
          total_amount           = EXCLUDED.total_amount,
          file_url               = EXCLUDED.file_url,
          file_name              = EXCLUDED.file_name,
          file_size              = EXCLUDED.file_size,
          file_type              = EXCLUDED.file_type,
          status                 = EXCLUDED.status,
          parsed_data            = EXCLUDED.parsed_data,
          parsing_confidence     = EXCLUDED.parsing_confidence,
          parsing_error          = EXCLUDED.parsing_error,
          updated_at             = EXCLUDED.updated_at,
          created_by             = EXCLUDED.created_by,
          processed_at           = EXCLUDED.processed_at,
          processed_by           = EXCLUDED.processed_by,
          file_path              = EXCLUDED.file_path,
          raw_text               = EXCLUDED.raw_text,
          clean_text             = EXCLUDED.clean_text,
          text_analysis          = EXCLUDED.text_analysis,
          confirmed_at           = EXCLUDED.confirmed_at,
          pipeline_stage         = EXCLUDED.pipeline_stage,
          pipeline_started_at    = EXCLUDED.pipeline_started_at,
          pipeline_completed_at  = EXCLUDED.pipeline_completed_at,
          pipeline_error         = EXCLUDED.pipeline_error
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          inv.id, tenantId, inv.supplier_id, inv.invoice_number, inv.invoice_date, inv.due_date,
          inv.total_amount, inv.file_url, inv.file_name, inv.file_size, inv.file_type,
          inv.status, inv.parsed_data, inv.parsing_confidence, inv.parsing_error,
          inv.created_at, inv.updated_at, remapUser(USER_MAP, inv.created_by),
          inv.processed_at, remapUser(USER_MAP, inv.processed_by),
          inv.file_path, inv.raw_text, inv.clean_text, inv.text_analysis, inv.confirmed_at,
          pipelineStage, pipelineStartedAt, pipelineCompletedAt, pipelineError,
        ]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
      ids.add(inv.id)
    }
  })
  return { ids, stats: { inserted, updated, orphans } }
}

async function migrateInvoiceItems(tenantId: string, invoiceIds: Set<string>): Promise<{ inserted: number; updated: number; orphans: number; invalidQty: number }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, invoice_id, line_number, item_description, supplier_item_code, quantity,
             unit_price, total_price, package_size, unit_type, units_per_package,
             matched_item_id, match_confidence, match_method, is_reviewed, review_notes,
             created_at, updated_at
      FROM invoice_items ORDER BY created_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source invoice_items: ${source.length}`)

  let inserted = 0, updated = 0, orphans = 0, invalidQty = 0

  await withClient(targetPool, async (c) => {
    const invIds = await existingIds(c, 'inventory_items', tenantId)

    for (const row of source) {
      if (row.invoice_id && !invoiceIds.has(row.invoice_id)) { orphans++; continue }
      if (!row.quantity || Number(row.quantity) <= 0) { invalidQty++; continue }
      if (row.unit_price != null && Number(row.unit_price) < 0) { invalidQty++; continue }

      // matched_item_id FKs to inventory_items; if missing, NULL it out rather than orphan-drop.
      const matchedItemId = row.matched_item_id && invIds.has(row.matched_item_id) ? row.matched_item_id : null

      if (DRY_RUN) continue

      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO invoice_items (
          id, tenant_id, invoice_id, line_number, item_description, supplier_item_code, quantity,
          unit_price, total_price, package_size, unit_type, units_per_package,
          matched_item_id, match_confidence, match_method, is_reviewed, review_notes,
          created_at, updated_at, vision_item_confidence
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NULL)
        ON CONFLICT (id) DO UPDATE SET
          invoice_id          = EXCLUDED.invoice_id,
          line_number         = EXCLUDED.line_number,
          item_description    = EXCLUDED.item_description,
          supplier_item_code  = EXCLUDED.supplier_item_code,
          quantity            = EXCLUDED.quantity,
          unit_price          = EXCLUDED.unit_price,
          total_price         = EXCLUDED.total_price,
          package_size        = EXCLUDED.package_size,
          unit_type           = EXCLUDED.unit_type,
          units_per_package   = EXCLUDED.units_per_package,
          matched_item_id     = EXCLUDED.matched_item_id,
          match_confidence    = EXCLUDED.match_confidence,
          match_method        = EXCLUDED.match_method,
          is_reviewed         = EXCLUDED.is_reviewed,
          review_notes        = EXCLUDED.review_notes,
          updated_at          = EXCLUDED.updated_at
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          row.id, tenantId, row.invoice_id, row.line_number, row.item_description, row.supplier_item_code,
          row.quantity, row.unit_price, row.total_price, row.package_size, row.unit_type, row.units_per_package,
          matchedItemId, row.match_confidence, row.match_method, row.is_reviewed, row.review_notes,
          row.created_at, row.updated_at,
        ]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
    }
  })
  return { inserted, updated, orphans, invalidQty }
}

async function migrateOrderInvoiceMatches(tenantId: string, invoiceIds: Set<string>, poIds: Set<string>): Promise<{ inserted: number; updated: number; orphans: number }> {
  const source = await withClient(sourcePool, (c) =>
    c.query(`
      SELECT id, purchase_order_id, invoice_id, match_confidence, match_method, status,
             quantity_variance, amount_variance, variance_notes, reviewed_by, reviewed_at,
             review_notes, created_at, updated_at
      FROM order_invoice_matches ORDER BY created_at
    `).then((r) => r.rows)
  )
  console.log(`→ Source order_invoice_matches: ${source.length}`)

  let inserted = 0, updated = 0, orphans = 0

  await withClient(targetPool, async (c) => {
    for (const row of source) {
      if (row.purchase_order_id && !poIds.has(row.purchase_order_id)) { orphans++; continue }
      if (row.invoice_id && !invoiceIds.has(row.invoice_id)) { orphans++; continue }
      if (DRY_RUN) continue

      const { rows } = await c.query<{ action: string }>(
        `
        INSERT INTO order_invoice_matches (
          id, tenant_id, purchase_order_id, invoice_id, match_confidence, match_method, status,
          quantity_variance, amount_variance, variance_notes, reviewed_by, reviewed_at,
          review_notes, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (id) DO UPDATE SET
          purchase_order_id = EXCLUDED.purchase_order_id,
          invoice_id        = EXCLUDED.invoice_id,
          match_confidence  = EXCLUDED.match_confidence,
          match_method      = EXCLUDED.match_method,
          status            = EXCLUDED.status,
          quantity_variance = EXCLUDED.quantity_variance,
          amount_variance   = EXCLUDED.amount_variance,
          variance_notes    = EXCLUDED.variance_notes,
          reviewed_by       = EXCLUDED.reviewed_by,
          reviewed_at       = EXCLUDED.reviewed_at,
          review_notes      = EXCLUDED.review_notes,
          updated_at        = EXCLUDED.updated_at
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          row.id, tenantId, row.purchase_order_id, row.invoice_id, row.match_confidence,
          row.match_method, row.status, row.quantity_variance, row.amount_variance,
          row.variance_notes, remapUser(USER_MAP, row.reviewed_by), row.reviewed_at,
          row.review_notes, row.created_at, row.updated_at,
        ]
      )
      if (rows[0].action === 'inserted') inserted++; else updated++
    }
  })
  return { inserted, updated, orphans }
}

async function main() {
  const tenant = loadTenantConfig()
  console.log('🧾 Phase 2.5: Migrate invoices + invoice_items + order_invoice_matches')
  console.log(`   Tenant:  ${tenant.slug} (${tenant.tenantId})`)
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log('')

  USER_MAP = await buildUserIdRemap()
  const mapped = [...USER_MAP.values()].filter((v) => v !== null).length
  const unmapped = USER_MAP.size - mapped
  console.log(`→ User remap: ${mapped} mapped, ${unmapped} unmapped`)
  console.log('')

  console.log('── invoices ──')
  const invoices = await migrateInvoices(tenant.tenantId)
  console.log(DRY_RUN
    ? `  [dry-run] Would process ${invoices.ids.size} (orphans=${invoices.stats.orphans})`
    : `  ✅ ${invoices.stats.inserted} inserted, ${invoices.stats.updated} updated, ${invoices.stats.orphans} orphans`)

  console.log('\n── invoice_items ──')
  const items = await migrateInvoiceItems(tenant.tenantId, invoices.ids)
  console.log(DRY_RUN
    ? `  [dry-run] Would process (orphans=${items.orphans}, invalidQty=${items.invalidQty})`
    : `  ✅ ${items.inserted} inserted, ${items.updated} updated, ${items.orphans} orphans, ${items.invalidQty} invalidQty`)

  console.log('\n── order_invoice_matches ──')
  // Need PO ids from target for orphan check.
  const poIds = await withClient(targetPool, (c) => existingIds(c, 'purchase_orders', tenant.tenantId))
  const matches = await migrateOrderInvoiceMatches(tenant.tenantId, invoices.ids, poIds)
  console.log(DRY_RUN
    ? `  [dry-run] Would process (orphans=${matches.orphans})`
    : `  ✅ ${matches.inserted} inserted, ${matches.updated} updated, ${matches.orphans} orphans`)

  // Verify
  console.log('\n→ Target row counts for JMC tenant:')
  await withClient(targetPool, async (c) => {
    for (const tbl of ['invoices', 'invoice_items', 'order_invoice_matches']) {
      const { rows } = await c.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM ${tbl} WHERE tenant_id = $1`,
        [tenant.tenantId]
      )
      console.log(`  ${tbl.padEnd(28)} target=${rows[0].c}`)
    }
  })

  console.log('\n' + '─'.repeat(60))
  console.log('✅ Invoices migration complete')
  console.log('─'.repeat(60))
}

main()
  .catch((err) => {
    console.error('💥 Migration failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => closePools())
