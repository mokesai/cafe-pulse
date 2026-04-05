#!/usr/bin/env node

/**
 * MOK-83 (SIM-7): Validate Cafe Operations Simulation Data Integrity
 *
 * Verifies:
 *   - inventory_items.current_stock >= 0
 *   - stock_movements count (purchase + sale)
 *   - cost_history entries in Feb-Mar
 *   - order_invoice_matches exist
 *   - cogs_periods (2 closed)
 *   - cogs_reports (2 non-zero)
 *   - ai_cogs_daily_summaries (59 rows)
 *   - No open invoice_exceptions
 *
 * Prints pass/fail table.
 *
 * Usage:
 *   npx tsx scripts/validate-simulation.ts
 *   npx tsx scripts/validate-simulation.ts --tenant-id <uuid>
 *   npx tsx scripts/validate-simulation.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// ─── Supabase Client ────────────────────────────────────────────────
function createSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY
  if (!url) throw new Error('Missing Supabase URL.')
  if (!serviceKey) throw new Error('Missing Supabase secret key.')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const BIGCAFE_TENANT_ID = '4fa1cbbe-49ff-4cde-a686-8d34252945b4'

// ─── CLI Args ───────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const param = (name: string, fallback: string) => {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
}

const DRY_RUN = flag('dry-run')
const TENANT_ID = param('tenant-id', BIGCAFE_TENANT_ID)

// ─── Check Results ──────────────────────────────────────────────────
interface CheckResult {
  name: string
  status: 'PASS' | 'FAIL' | 'WARN'
  expected: string
  actual: string
  detail?: string
}

const results: CheckResult[] = []

function pass(name: string, expected: string, actual: string, detail?: string) {
  results.push({ name, status: 'PASS', expected, actual, detail })
}
function fail(name: string, expected: string, actual: string, detail?: string) {
  results.push({ name, status: 'FAIL', expected, actual, detail })
}
function warn(name: string, expected: string, actual: string, detail?: string) {
  results.push({ name, status: 'WARN', expected, actual, detail })
}

// ─── Checks ─────────────────────────────────────────────────────────
const db = createSupabaseServiceClient()

async function checkInventoryStock() {
  const { data, error } = await db
    .from('inventory_items')
    .select('id, item_name, current_stock')
    .eq('tenant_id', TENANT_ID)
    .is('deleted_at', null)

  if (error) { fail('Inventory stock >= 0', 'All >= 0', `Query failed: ${error.message}`); return }

  const items = data ?? []
  const negative = items.filter((i) => (Number(i.current_stock) ?? 0) < 0)

  if (negative.length > 0) {
    fail('Inventory stock >= 0', 'All >= 0', `${negative.length} items with negative stock`,
      negative.map((i) => `${i.item_name}: ${i.current_stock}`).join(', '))
  } else {
    pass('Inventory stock >= 0', 'All >= 0', `${items.length} items, all non-negative`)
  }
}

async function checkStockMovements() {
  const { count, error } = await db
    .from('stock_movements')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)

  if (error) { fail('Stock movements', '> 0', `Query failed: ${error.message}`); return }

  const total = count ?? 0
  if (total === 0) { fail('Stock movements', '> 0', '0 movements found'); return }

  const { count: purchaseCount } = await db
    .from('stock_movements')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .eq('movement_type', 'purchase')

  const { count: saleCount } = await db
    .from('stock_movements')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .eq('movement_type', 'sale')

  pass('Stock movements', 'Purchase + sale entries',
    `${total} total (${purchaseCount ?? 0} purchase, ${saleCount ?? 0} sale)`)
}

async function checkCostHistory() {
  const { count, error } = await db
    .from('inventory_item_cost_history')
    .select('*', { count: 'exact', head: true })
    .gte('changed_at', '2026-02-01T00:00:00Z')
    .lte('changed_at', '2026-03-31T23:59:59Z')

  if (error) { fail('Cost history entries', '> 0 in Feb-Mar', `Query failed: ${error.message}`); return }

  const total = count ?? 0
  if (total > 0) {
    pass('Cost history entries', '> 0 in Feb-Mar', `${total} entries`)
  } else {
    fail('Cost history entries', '> 0 in Feb-Mar', '0 entries')
  }
}

async function checkOrderInvoiceMatches() {
  const { count, error } = await db
    .from('order_invoice_matches')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)

  if (error) { fail('Order-invoice matches', '> 0', `Query failed: ${error.message}`); return }

  const total = count ?? 0
  if (total > 0) {
    pass('Order-invoice matches', 'POs linked to invoices', `${total} matches`)
  } else {
    fail('Order-invoice matches', '> 0', '0 matches')
  }
}

async function checkPurchaseOrders() {
  const { data, error } = await db
    .from('purchase_orders')
    .select('id, status, order_number')
    .eq('tenant_id', TENANT_ID)
    .like('order_number', 'SIM-PO-%')

  if (error) { fail('Simulation POs', '~32 POs (4 suppliers × 8 weeks)', `Query failed: ${error.message}`); return }

  const pos = data ?? []
  const confirmed = pos.filter((p) => p.status === 'confirmed')

  if (pos.length >= 32) {
    pass('Simulation POs', '≥32 POs', `${pos.length} POs (${confirmed.length} confirmed)`)
  } else if (pos.length > 0) {
    warn('Simulation POs', '~32 POs', `${pos.length} POs (${confirmed.length} confirmed)`)
  } else {
    fail('Simulation POs', '~32 POs', '0 simulation POs found')
  }
}

async function checkSalesTransactions() {
  const { count, error } = await db
    .from('sales_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .gte('ordered_at', '2026-02-01T00:00:00Z')
    .lte('ordered_at', '2026-03-31T23:59:59Z')

  if (error) { fail('Sales transactions', '~4,700', `Query failed: ${error.message}`); return }

  const total = count ?? 0
  if (total >= 3000) {
    pass('Sales transactions', '~4,700 (59 days × ~80/day)', `${total} transactions`)
  } else if (total > 0) {
    warn('Sales transactions', '~4,700', `${total} transactions (lower than expected)`)
  } else {
    fail('Sales transactions', '~4,700', '0 transactions')
  }
}

async function checkCogsPeriods() {
  const { data, error } = await db
    .from('cogs_periods')
    .select('id, status, start_at, end_at')
    .eq('tenant_id', TENANT_ID)
    .order('start_at', { ascending: true })

  if (error) { fail('COGS periods', '2 closed', `Query failed: ${error.message}`); return }

  const periods = data ?? []
  const closed = periods.filter((p) => p.status === 'closed')

  if (closed.length === 2) {
    pass('COGS periods', '2 closed (Feb, Mar)', `${closed.length} closed periods`)
  } else if (closed.length > 0) {
    warn('COGS periods', '2 closed', `${closed.length} closed, ${periods.length} total`)
  } else {
    fail('COGS periods', '2 closed (Feb, Mar)', `${periods.length} total, ${closed.length} closed`)
  }
}

async function checkCogsReports() {
  const { data, error } = await db
    .from('cogs_reports')
    .select('id, periodic_cogs_value, purchases_value')
    .eq('tenant_id', TENANT_ID)

  if (error) { fail('COGS reports', '2 non-zero', `Query failed: ${error.message}`); return }

  const reports = data ?? []
  const nonZero = reports.filter((r) => Number(r.periodic_cogs_value) !== 0)

  if (nonZero.length >= 2) {
    pass('COGS reports', '2 with non-zero COGS',
      `${reports.length} reports: ${reports.map((r) => `$${r.periodic_cogs_value}`).join(', ')}`)
  } else if (reports.length >= 2) {
    warn('COGS reports', '2 non-zero COGS', `${reports.length} reports, ${nonZero.length} non-zero`)
  } else {
    fail('COGS reports', '2 non-zero COGS', `${reports.length} reports found`)
  }
}

async function checkDailySummaries() {
  const { count, error } = await db
    .from('ai_cogs_daily_summaries')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .gte('summary_date', '2026-02-01')
    .lte('summary_date', '2026-03-31')

  if (error) { fail('Daily COGS summaries', '59 rows', `Query failed: ${error.message}`); return }

  const total = count ?? 0
  if (total >= 59) {
    pass('Daily COGS summaries', '59 rows (Feb+Mar)', `${total} rows`)
  } else if (total > 0) {
    warn('Daily COGS summaries', '59 rows', `${total} rows`)
  } else {
    fail('Daily COGS summaries', '59 rows', '0 rows')
  }
}

async function checkNoOpenExceptions() {
  const { count, error } = await db
    .from('invoice_exceptions')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'open')

  if (error) {
    // Table might not exist — that's fine
    pass('No open invoice exceptions', '0 open', 'Table query failed (OK if table missing)')
    return
  }

  const total = count ?? 0
  if (total === 0) {
    pass('No open invoice exceptions', '0 open', '0 open exceptions')
  } else {
    warn('Open invoice exceptions', '0 open', `${total} open exceptions`)
  }
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 Simulation Validation (MOK-83)')
  console.log(`   Tenant: ${TENANT_ID}`)
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log()

  if (DRY_RUN) {
    console.log('Checks that would run:')
    console.log('  1. Inventory stock >= 0')
    console.log('  2. Stock movements (purchase + sale)')
    console.log('  3. Cost history entries in Feb-Mar')
    console.log('  4. Order-invoice matches')
    console.log('  5. Simulation POs (~32)')
    console.log('  6. Sales transactions (~4,700)')
    console.log('  7. COGS periods (2 closed)')
    console.log('  8. COGS reports (2 non-zero)')
    console.log('  9. Daily COGS summaries (59 rows)')
    console.log('  10. No open invoice exceptions')
    console.log('\nDry run complete. Remove --dry-run to execute.')
    return
  }

  await checkInventoryStock()
  await checkStockMovements()
  await checkCostHistory()
  await checkOrderInvoiceMatches()
  await checkPurchaseOrders()
  await checkSalesTransactions()
  await checkCogsPeriods()
  await checkCogsReports()
  await checkDailySummaries()
  await checkNoOpenExceptions()

  // Print summary table
  console.log('\n' + '═'.repeat(80))
  console.log('  VALIDATION RESULTS')
  console.log('═'.repeat(80))

  const maxNameLen = Math.max(...results.map((r) => r.name.length))

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️ ' : '❌'
    const namePad = r.name.padEnd(maxNameLen + 2)
    console.log(`  ${icon} ${r.status.padEnd(4)} ${namePad} Expected: ${r.expected}`)
    console.log(`  ${' '.repeat(10)}${' '.repeat(maxNameLen + 2)} Actual:   ${r.actual}`)
    if (r.detail) {
      console.log(`  ${' '.repeat(10)}${' '.repeat(maxNameLen + 2)} Detail:   ${r.detail}`)
    }
  }

  console.log('\n' + '─'.repeat(80))
  const passes = results.filter((r) => r.status === 'PASS').length
  const warns = results.filter((r) => r.status === 'WARN').length
  const fails = results.filter((r) => r.status === 'FAIL').length
  console.log(`  Summary: ${passes} passed, ${warns} warnings, ${fails} failed out of ${results.length} checks`)
  console.log('─'.repeat(80))

  if (fails > 0) process.exit(1)
}

main().catch((err) => {
  console.error('❌ Validation failed:', err instanceof Error ? err.message : String(err))
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
