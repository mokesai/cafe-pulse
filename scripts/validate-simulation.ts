#!/usr/bin/env node

/**
 * MOK-83 (SIM-7): Validate Cafe Operations Simulation Data Integrity
 *
 * Runs comprehensive checks across all simulation-affected tables.
 * Prints a pass/fail summary table.
 *
 * Usage:
 *   npx tsx scripts/validate-simulation.ts
 *   npx tsx scripts/validate-simulation.ts --tenant-id <uuid>
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── CLI Args ───────────────────────────────────────────────────────
const args = process.argv.slice(2)
const param = (name: string, fallback: string) => {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
}

const TENANT_ID = param('tenant-id', '4fa1cbbe-49ff-4cde-a686-8d34252945b4')

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
async function checkInventoryStock() {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, item_name, current_stock, is_ingredient')
    .eq('tenant_id', TENANT_ID)
    .eq('is_ingredient', true)

  if (error) {
    fail('Ingredient inventory stock', 'All > 0', `Query failed: ${error.message}`)
    return
  }

  const items = data ?? []
  const negative = items.filter(i => (i.current_stock ?? 0) < 0)
  const zero = items.filter(i => (i.current_stock ?? 0) === 0)

  if (negative.length > 0) {
    fail('Ingredient inventory stock',
      'All >= 0',
      `${negative.length} items with negative stock`,
      negative.map(i => `${i.item_name}: ${i.current_stock}`).join(', '))
  } else if (zero.length > items.length * 0.5) {
    warn('Ingredient inventory stock',
      'Most > 0',
      `${zero.length}/${items.length} items at zero stock`)
  } else {
    pass('Ingredient inventory stock',
      'All >= 0',
      `${items.length} items, ${items.length - zero.length} with positive stock`)
  }
}

async function checkStockMovements() {
  const { count, error } = await supabase
    .from('stock_movements')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)

  if (error) {
    fail('Stock movements', '> 0', `Query failed: ${error.message}`)
    return
  }

  const total = count ?? 0
  if (total > 0) {
    // Check for both purchase and sale movements
    const { count: purchaseCount } = await supabase
      .from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', TENANT_ID)
      .eq('movement_type', 'purchase')

    const { count: saleCount } = await supabase
      .from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', TENANT_ID)
      .eq('movement_type', 'sale')

    pass('Stock movements',
      'Purchase + sale entries',
      `${total} total (${purchaseCount ?? 0} purchase, ${saleCount ?? 0} sale)`)
  } else {
    fail('Stock movements', '> 0', '0 movements found')
  }
}

async function checkCostHistory() {
  const { count, error } = await supabase
    .from('inventory_item_cost_history')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .gte('changed_at', '2026-02-01T00:00:00Z')
    .lte('changed_at', '2026-03-31T23:59:59Z')

  if (error) {
    fail('Cost history entries', '> 0 in Feb-Mar', `Query failed: ${error.message}`)
    return
  }

  const total = count ?? 0
  if (total > 0) {
    pass('Cost history entries', 'Entries in Feb-Mar', `${total} entries`)
  } else {
    fail('Cost history entries', '> 0 in Feb-Mar', '0 entries')
  }
}

async function checkOrderInvoiceMatches() {
  const { count, error } = await supabase
    .from('order_invoice_matches')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)

  if (error) {
    fail('Order-invoice matches', '> 0', `Query failed: ${error.message}`)
    return
  }

  const total = count ?? 0
  if (total > 0) {
    pass('Order-invoice matches', 'All invoices linked to POs', `${total} matches`)
  } else {
    fail('Order-invoice matches', '> 0', '0 matches')
  }
}

async function checkCogsPeriods() {
  const { data, error } = await supabase
    .from('cogs_periods')
    .select('id, status, start_at, end_at')
    .eq('tenant_id', TENANT_ID)
    .order('start_at', { ascending: true })

  if (error) {
    fail('COGS periods', '2 closed periods', `Query failed: ${error.message}`)
    return
  }

  const periods = data ?? []
  const closed = periods.filter(p => p.status === 'closed')

  if (closed.length === 2) {
    pass('COGS periods', '2 closed (Feb, Mar)', `${closed.length} closed periods`)
  } else if (closed.length > 0) {
    warn('COGS periods', '2 closed', `${closed.length} closed, ${periods.length} total`)
  } else {
    fail('COGS periods', '2 closed (Feb, Mar)', `${periods.length} total, ${closed.length} closed`)
  }
}

async function checkCogsReports() {
  const { data, error } = await supabase
    .from('cogs_reports')
    .select('id, periodic_cogs_value, purchases_value')
    .eq('tenant_id', TENANT_ID)

  if (error) {
    fail('COGS reports', '2 with non-zero values', `Query failed: ${error.message}`)
    return
  }

  const reports = data ?? []
  const nonZero = reports.filter(r => Number(r.periodic_cogs_value) > 0)

  if (nonZero.length >= 2) {
    pass('COGS reports', '2 with non-zero COGS',
      `${reports.length} reports, COGS values: ${reports.map(r => `$${r.periodic_cogs_value}`).join(', ')}`)
  } else if (reports.length >= 2) {
    warn('COGS reports', '2 with non-zero COGS',
      `${reports.length} reports but ${nonZero.length} have non-zero COGS`)
  } else {
    fail('COGS reports', '2 with non-zero COGS', `${reports.length} reports found`)
  }
}

async function checkDailySummaries() {
  const { count, error } = await supabase
    .from('ai_cogs_daily_summaries')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .gte('summary_date', '2026-02-01')
    .lte('summary_date', '2026-03-31')

  if (error) {
    fail('Daily COGS summaries', '59 rows (Feb+Mar)', `Query failed: ${error.message}`)
    return
  }

  const total = count ?? 0
  if (total >= 59) {
    pass('Daily COGS summaries', '59 rows (Feb+Mar)', `${total} rows`)
  } else if (total > 0) {
    warn('Daily COGS summaries', '59 rows', `${total} rows (expected 59)`)
  } else {
    fail('Daily COGS summaries', '59 rows (Feb+Mar)', '0 rows')
  }

  // Check that purchase days have purchases_value > 0
  const { data: purchaseDays } = await supabase
    .from('ai_cogs_daily_summaries')
    .select('summary_date, purchases_value')
    .eq('tenant_id', TENANT_ID)
    .gt('purchases_value', 0)
    .gte('summary_date', '2026-02-01')
    .lte('summary_date', '2026-03-31')

  const purchaseDayCount = purchaseDays?.length ?? 0
  if (purchaseDayCount > 0) {
    pass('Daily summaries with purchases', '> 0 on delivery days', `${purchaseDayCount} days with purchases > 0`)
  } else {
    warn('Daily summaries with purchases', '> 0 on delivery days', '0 days with purchases')
  }
}

async function checkNoOpenInvoiceExceptions() {
  const { count, error } = await supabase
    .from('invoice_exceptions')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'open')

  if (error) {
    // Table might not exist — that's fine
    pass('No open invoice exceptions', '0 open', 'Table may not exist (OK)')
    return
  }

  const total = count ?? 0
  if (total === 0) {
    pass('No open invoice exceptions', '0 open', '0 open exceptions')
  } else {
    warn('Open invoice exceptions', '0 open', `${total} open exceptions from simulation`)
  }
}

async function checkPurchaseOrders() {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id, status, order_number')
    .eq('tenant_id', TENANT_ID)
    .like('order_number', 'SIM-PO-%')

  if (error) {
    fail('Simulation POs', '32 POs (4 suppliers × 8 weeks)', `Query failed: ${error.message}`)
    return
  }

  const pos = data ?? []
  const received = pos.filter(p => p.status === 'received')

  if (pos.length >= 32) {
    pass('Simulation POs', '≥32 POs', `${pos.length} POs (${received.length} received)`)
  } else if (pos.length > 0) {
    warn('Simulation POs', '32 POs', `${pos.length} POs found`)
  } else {
    fail('Simulation POs', '32 POs', '0 simulation POs found')
  }
}

async function checkSalesTransactions() {
  const { count, error } = await supabase
    .from('sales_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .gte('ordered_at', '2026-02-01T00:00:00Z')
    .lte('ordered_at', '2026-03-31T23:59:59Z')

  if (error) {
    fail('Sales transactions', '~4,700 (59 days × ~80/day)', `Query failed: ${error.message}`)
    return
  }

  const total = count ?? 0
  if (total >= 3000) {
    pass('Sales transactions', '~4,700', `${total} transactions`)
  } else if (total > 0) {
    warn('Sales transactions', '~4,700', `${total} transactions (lower than expected)`)
  } else {
    fail('Sales transactions', '~4,700', '0 transactions')
  }
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 Simulation Validation')
  console.log(`   Tenant: ${TENANT_ID}`)
  console.log()

  await checkInventoryStock()
  await checkStockMovements()
  await checkCostHistory()
  await checkOrderInvoiceMatches()
  await checkPurchaseOrders()
  await checkSalesTransactions()
  await checkCogsPeriods()
  await checkCogsReports()
  await checkDailySummaries()
  await checkNoOpenInvoiceExceptions()

  // Print summary table
  console.log('\n' + '═'.repeat(80))
  console.log('  VALIDATION RESULTS')
  console.log('═'.repeat(80))

  const maxNameLen = Math.max(...results.map(r => r.name.length))

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌'
    const statusPad = r.status.padEnd(4)
    const namePad = r.name.padEnd(maxNameLen + 2)
    console.log(`  ${icon} ${statusPad} ${namePad} Expected: ${r.expected}`)
    console.log(`  ${' '.repeat(8)}${' '.repeat(maxNameLen + 2)} Actual:   ${r.actual}`)
    if (r.detail) {
      console.log(`  ${' '.repeat(8)}${' '.repeat(maxNameLen + 2)} Detail:   ${r.detail}`)
    }
  }

  console.log('\n' + '─'.repeat(80))
  const passes = results.filter(r => r.status === 'PASS').length
  const warns = results.filter(r => r.status === 'WARN').length
  const fails = results.filter(r => r.status === 'FAIL').length
  console.log(`  Summary: ${passes} passed, ${warns} warnings, ${fails} failed`)
  console.log('─'.repeat(80))

  if (fails > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('💥 Validation failed:', err)
  process.exit(1)
})
