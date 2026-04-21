#!/usr/bin/env node
/**
 * MOK-95 — Phase 2.7: Validation script.
 *
 * After phases 2.1–2.6 have all run, verify:
 *
 *   A. Row-count parity per table between source and target(JMC tenant).
 *   B. FK integrity on target — zero orphans for every FK we care about.
 *   C. Metric parity — revenue, invoice totals, inventory value.
 *
 * Writes a markdown report to validation-report.md (gitignored, under
 * scripts/migrate-from-cafeweb/). Exit 0 if all checks pass, 1 otherwise.
 *
 * Usage:
 *   npx tsx scripts/migrate-from-cafeweb/08-validate.ts
 */

import fs from 'fs'
import path from 'path'
import { sourcePool, targetPool, withClient, closePools } from './shared/clients'
import type { PoolClient } from 'pg'

const STATE_DIR = path.resolve(__dirname, 'state')

interface TenantConfig { tenantId: string; slug: string; adminEmails: string[] }

function loadTenantConfig(): TenantConfig {
  const file = path.join(STATE_DIR, 'tenant-config.json')
  if (!fs.existsSync(file)) throw new Error('tenant-config.json missing. Run 01-bootstrap-tenant.ts.')
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

interface Check {
  section: string
  name: string
  pass: boolean
  detail: string
}

const checks: Check[] = []
const fmt = (n: unknown) => typeof n === 'number' ? n.toLocaleString() : String(n)
const fmtCurrency = (n: number) => `$${n.toFixed(2)}`

async function countSource(c: PoolClient, table: string, where = ''): Promise<number> {
  const { rows } = await c.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM ${table} ${where}`
  )
  return Number(rows[0].c)
}

async function countTarget(c: PoolClient, table: string, tenantId: string, where = ''): Promise<number> {
  const tenantFilter = `tenant_id = '${tenantId}'`
  const fullWhere = where ? `${tenantFilter} AND ${where}` : tenantFilter
  const { rows } = await c.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM ${table} WHERE ${fullWhere}`
  )
  return Number(rows[0].c)
}

/**
 * Tables migrated in phases 2.2–2.6 that carry tenant_id and have full
 * per-row migration (not sync-only or skipped).
 *
 * Note on deltas: invalid rows dropped by migrators (e.g. quantity <= 0)
 * get accounted for as "expected delta" below.
 */
const ROW_COUNT_CHECKS: Array<{ table: string; note?: string }> = [
  { table: 'suppliers' },
  { table: 'inventory_items' },
  { table: 'inventory_item_cost_history' },
  { table: 'cogs_products' },
  { table: 'cogs_sellables' },
  { table: 'purchase_orders' },
  { table: 'purchase_order_items' },
  { table: 'purchase_order_receipts' },
  { table: 'purchase_order_status_history' },
  { table: 'purchase_order_attachments' },
  { table: 'stock_movements' },
  { table: 'invoices' },
  { table: 'invoice_items' },
  { table: 'order_invoice_matches' },
  { table: 'sales_transactions' },
  { table: 'sales_transaction_items' },
]

async function runRowCountChecks(tenantId: string): Promise<void> {
  const srcCounts: Record<string, number> = {}
  await withClient(sourcePool, async (c) => {
    for (const { table } of ROW_COUNT_CHECKS) {
      srcCounts[table] = await countSource(c, table)
    }
  })

  await withClient(targetPool, async (c) => {
    for (const { table, note } of ROW_COUNT_CHECKS) {
      const tgt = await countTarget(c, table, tenantId)
      const src = srcCounts[table]
      const pass = tgt === src
      checks.push({
        section: 'A. Row-count parity',
        name: `${table}`,
        pass,
        detail: `source=${fmt(src)}, target=${fmt(tgt)}, delta=${tgt - src}${note ? ` — ${note}` : ''}`,
      })
    }
  })
}

async function runFkIntegrityChecks(tenantId: string): Promise<void> {
  // Each check: on target, count rows where the FK value does not resolve.
  const fkChecks: Array<{ name: string; sql: string }> = [
    {
      name: 'sales_transaction_items → sales_transactions',
      sql: `SELECT COUNT(*) AS c FROM sales_transaction_items sti
            WHERE sti.tenant_id = $1
              AND NOT EXISTS (SELECT 1 FROM sales_transactions st WHERE st.id = sti.transaction_id)`,
    },
    {
      name: 'sales_transaction_items.inventory_item_id → inventory_items (when not null)',
      sql: `SELECT COUNT(*) AS c FROM sales_transaction_items sti
            WHERE sti.tenant_id = $1 AND sti.inventory_item_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.id = sti.inventory_item_id)`,
    },
    {
      name: 'invoice_items → invoices',
      sql: `SELECT COUNT(*) AS c FROM invoice_items ii
            WHERE ii.tenant_id = $1
              AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = ii.invoice_id)`,
    },
    {
      name: 'invoice_items.matched_item_id → inventory_items (when not null)',
      sql: `SELECT COUNT(*) AS c FROM invoice_items ii
            WHERE ii.tenant_id = $1 AND ii.matched_item_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM inventory_items inv WHERE inv.id = ii.matched_item_id)`,
    },
    {
      name: 'purchase_order_items → purchase_orders',
      sql: `SELECT COUNT(*) AS c FROM purchase_order_items poi
            WHERE poi.tenant_id = $1
              AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = poi.purchase_order_id)`,
    },
    {
      name: 'purchase_order_items → inventory_items',
      sql: `SELECT COUNT(*) AS c FROM purchase_order_items poi
            WHERE poi.tenant_id = $1
              AND NOT EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.id = poi.inventory_item_id)`,
    },
    {
      name: 'purchase_order_receipts → purchase_orders',
      sql: `SELECT COUNT(*) AS c FROM purchase_order_receipts por
            WHERE por.tenant_id = $1
              AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = por.purchase_order_id)`,
    },
    {
      name: 'stock_movements → inventory_items',
      sql: `SELECT COUNT(*) AS c FROM stock_movements sm
            WHERE sm.tenant_id = $1
              AND NOT EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.id = sm.inventory_item_id)`,
    },
    {
      name: 'inventory_items.supplier_id → suppliers (when not null)',
      sql: `SELECT COUNT(*) AS c FROM inventory_items ii
            WHERE ii.tenant_id = $1 AND ii.supplier_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = ii.supplier_id)`,
    },
    {
      name: 'cogs_sellables → cogs_products',
      sql: `SELECT COUNT(*) AS c FROM cogs_sellables cs
            WHERE cs.tenant_id = $1
              AND NOT EXISTS (SELECT 1 FROM cogs_products cp WHERE cp.id = cs.product_id)`,
    },
    {
      name: 'invoices.supplier_id → suppliers (when not null)',
      sql: `SELECT COUNT(*) AS c FROM invoices i
            WHERE i.tenant_id = $1 AND i.supplier_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = i.supplier_id)`,
    },
    {
      name: 'order_invoice_matches → invoices + purchase_orders',
      sql: `SELECT COUNT(*) AS c FROM order_invoice_matches oim
            WHERE oim.tenant_id = $1 AND (
              (oim.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = oim.invoice_id))
              OR
              (oim.purchase_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = oim.purchase_order_id))
            )`,
    },
  ]

  await withClient(targetPool, async (c) => {
    for (const check of fkChecks) {
      const { rows } = await c.query<{ c: string }>(check.sql, [tenantId])
      const orphans = Number(rows[0].c)
      checks.push({
        section: 'B. FK integrity',
        name: check.name,
        pass: orphans === 0,
        detail: orphans === 0 ? 'zero orphans' : `${orphans} orphan rows`,
      })
    }
  })
}

async function runMetricParityChecks(tenantId: string): Promise<void> {
  type Metric = { name: string; sourceSql: string; targetSql: string; format?: (n: number) => string; tolerance?: number }

  const metrics: Metric[] = [
    {
      name: 'sales revenue (SUM(tender_total_money))',
      sourceSql: `SELECT COALESCE(SUM(tender_total_money), 0)::text AS v FROM sales_transactions`,
      targetSql: `SELECT COALESCE(SUM(tender_total_money), 0)::text AS v FROM sales_transactions WHERE tenant_id = $1`,
      format: fmtCurrency,
      tolerance: 0.01,
    },
    {
      name: 'distinct customers with name',
      sourceSql: `SELECT COUNT(DISTINCT customer_name)::text AS v FROM sales_transactions WHERE customer_name IS NOT NULL`,
      targetSql: `SELECT COUNT(DISTINCT customer_name)::text AS v FROM sales_transactions WHERE tenant_id = $1 AND customer_name IS NOT NULL`,
    },
    {
      name: 'distinct square_order_ids',
      sourceSql: `SELECT COUNT(DISTINCT square_order_id)::text AS v FROM sales_transactions`,
      targetSql: `SELECT COUNT(DISTINCT square_order_id)::text AS v FROM sales_transactions WHERE tenant_id = $1`,
    },
    {
      name: 'invoice count by status=confirmed',
      sourceSql: `SELECT COUNT(*)::text AS v FROM invoices WHERE status = 'confirmed'`,
      targetSql: `SELECT COUNT(*)::text AS v FROM invoices WHERE tenant_id = $1 AND status = 'confirmed'`,
    },
    {
      name: 'total invoice amount (SUM(total_amount))',
      sourceSql: `SELECT COALESCE(SUM(total_amount), 0)::text AS v FROM invoices`,
      targetSql: `SELECT COALESCE(SUM(total_amount), 0)::text AS v FROM invoices WHERE tenant_id = $1`,
      format: fmtCurrency,
      tolerance: 0.01,
    },
    {
      name: 'total PO amount (SUM(total_amount))',
      sourceSql: `SELECT COALESCE(SUM(total_amount), 0)::text AS v FROM purchase_orders`,
      targetSql: `SELECT COALESCE(SUM(total_amount), 0)::text AS v FROM purchase_orders WHERE tenant_id = $1`,
      format: fmtCurrency,
      tolerance: 0.01,
    },
    {
      name: 'inventory on-hand value (SUM(current_stock * unit_cost))',
      sourceSql: `SELECT COALESCE(SUM(current_stock * unit_cost), 0)::text AS v FROM inventory_items WHERE deleted_at IS NULL`,
      targetSql: `SELECT COALESCE(SUM(current_stock * unit_cost), 0)::text AS v FROM inventory_items WHERE tenant_id = $1 AND deleted_at IS NULL`,
      format: fmtCurrency,
      tolerance: 0.01,
    },
    {
      name: 'distinct active suppliers',
      sourceSql: `SELECT COUNT(*)::text AS v FROM suppliers WHERE is_active`,
      targetSql: `SELECT COUNT(*)::text AS v FROM suppliers WHERE tenant_id = $1 AND is_active`,
    },
  ]

  const srcValues: Record<string, number> = {}
  await withClient(sourcePool, async (c) => {
    for (const m of metrics) {
      const { rows } = await c.query<{ v: string }>(m.sourceSql)
      srcValues[m.name] = Number(rows[0].v)
    }
  })

  await withClient(targetPool, async (c) => {
    for (const m of metrics) {
      const { rows } = await c.query<{ v: string }>(m.targetSql, [tenantId])
      const tgtVal = Number(rows[0].v)
      const srcVal = srcValues[m.name]
      const tolerance = m.tolerance ?? 0
      const diff = Math.abs(tgtVal - srcVal)
      const pass = diff <= tolerance
      const fmtFn = m.format ?? fmt
      checks.push({
        section: 'C. Metric parity',
        name: m.name,
        pass,
        detail: `source=${fmtFn(srcVal)}, target=${fmtFn(tgtVal)}, diff=${fmtFn(diff)}${tolerance ? ` (tolerance ${fmtFn(tolerance)})` : ''}`,
      })
    }
  })
}

function renderReport(tenant: TenantConfig): string {
  const lines: string[] = []
  const ts = new Date().toISOString()
  lines.push(`# Migration validation report — JMC Pastry & Coffee on cafe-pulse-dev`)
  lines.push('')
  lines.push(`_Generated ${ts}._`)
  lines.push('')
  lines.push(`- Tenant: \`${tenant.slug}\` (\`${tenant.tenantId}\`)`)
  lines.push(`- Source: \`cafe-web-app-prod\` (\`etihvnzzmtxsnbifftfh\`)`)
  lines.push(`- Target: \`cafe-pulse-dev\` (\`ettmabcwfhidcpapphgm\`)`)
  lines.push('')

  const bySection = new Map<string, Check[]>()
  for (const c of checks) {
    if (!bySection.has(c.section)) bySection.set(c.section, [])
    bySection.get(c.section)!.push(c)
  }

  const totalPass = checks.filter((c) => c.pass).length
  const totalFail = checks.filter((c) => !c.pass).length
  lines.push(`## Summary`)
  lines.push('')
  lines.push(`**${totalPass}/${checks.length} checks passed** ${totalFail === 0 ? '✅' : `— ${totalFail} failed ❌`}`)
  lines.push('')

  for (const [section, rows] of bySection) {
    lines.push(`## ${section}`)
    lines.push('')
    lines.push(`| Check | Result | Detail |`)
    lines.push(`|---|---|---|`)
    for (const r of rows) {
      lines.push(`| ${r.name} | ${r.pass ? '✅' : '❌'} | ${r.detail} |`)
    }
    lines.push('')
  }

  if (totalFail > 0) {
    lines.push(`## Failures`)
    lines.push('')
    for (const c of checks.filter((c) => !c.pass)) {
      lines.push(`- **${c.section} — ${c.name}**: ${c.detail}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function main() {
  const tenant = loadTenantConfig()
  console.log('✔️  Phase 2.7: Migration validation')
  console.log(`   Tenant: ${tenant.slug} (${tenant.tenantId})`)
  console.log('')

  console.log('→ A. Row-count parity...')
  await runRowCountChecks(tenant.tenantId)

  console.log('→ B. FK integrity...')
  await runFkIntegrityChecks(tenant.tenantId)

  console.log('→ C. Metric parity...')
  await runMetricParityChecks(tenant.tenantId)

  const report = renderReport(tenant)
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const reportPath = path.join(STATE_DIR, 'validation-report.md')
  fs.writeFileSync(reportPath, report)
  console.log('')
  console.log(`  ✓ Wrote ${path.relative(process.cwd(), reportPath)}`)

  // Console summary
  const pass = checks.filter((c) => c.pass).length
  const fail = checks.filter((c) => !c.pass).length
  console.log('')
  console.log('─'.repeat(60))
  console.log(`${pass}/${checks.length} checks passed${fail ? ` — ${fail} failed` : ''}`)
  console.log('─'.repeat(60))

  if (fail > 0) {
    console.log('')
    console.log('Failures:')
    for (const c of checks.filter((c) => !c.pass)) {
      console.log(`  ❌ [${c.section}] ${c.name}: ${c.detail}`)
    }
    process.exitCode = 1
  } else {
    console.log('✅ Migration validated.')
  }
}

main()
  .catch((err) => {
    console.error('💥 Validation crashed:', err instanceof Error ? err.message : err)
    process.exitCode = 2
  })
  .finally(() => closePools())
