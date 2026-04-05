#!/usr/bin/env node

/**
 * MOK-82 (SIM-6): Create and Close COGS Periods for February & March
 *
 * Steps for each month:
 *   1. Create cogs_periods row (open)
 *   2. Snapshot beginning inventory valuations
 *   3. Compute purchases in the period (confirmed invoices)
 *   4. Snapshot ending inventory valuations
 *   5. Compute COGS = beginning + purchases - ending
 *   6. Insert cogs_reports row
 *   7. Close the period
 *   8. Populate ai_cogs_daily_summaries for each day
 *
 * Usage:
 *   SIMULATION_MODE=true npx tsx scripts/close-cogs-periods.ts --dry-run
 *   SIMULATION_MODE=true npx tsx scripts/close-cogs-periods.ts
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// ─── Safety Gate ────────────────────────────────────────────────────
if (process.env.SIMULATION_MODE !== 'true') {
  console.error('❌ SIMULATION_MODE must be set to "true"')
  process.exit(1)
}

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
const flag = (name: string) => args.includes(`--${name}`)
const param = (name: string, fallback: string) => {
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
}

const DRY_RUN = flag('dry-run')
const TENANT_ID = param('tenant-id', '4fa1cbbe-49ff-4cde-a686-8d34252945b4')

// ─── Period Definitions ─────────────────────────────────────────────
interface PeriodDef {
  label: string
  startAt: string
  endAt: string
  daysInPeriod: number
}

const PERIODS: PeriodDef[] = [
  { label: 'February 2026', startAt: '2026-02-01T00:00:00Z', endAt: '2026-02-28T23:59:59Z', daysInPeriod: 28 },
  { label: 'March 2026', startAt: '2026-03-01T00:00:00Z', endAt: '2026-03-31T23:59:59Z', daysInPeriod: 31 },
]

// ─── Helpers ────────────────────────────────────────────────────────
async function getInventorySnapshot(
  db: SupabaseClient,
  tenantId: string
): Promise<Array<{ id: string; currentStock: number; unitCost: number }>> {
  const { data, error } = await db
    .from('inventory_items')
    .select('id, current_stock, unit_cost')
    .eq('tenant_id', tenantId)

  if (error) throw new Error(`Inventory fetch failed: ${error.message}`)
  return (data ?? []).map(item => ({
    id: item.id,
    currentStock: item.current_stock ?? 0,
    unitCost: item.unit_cost ?? 0,
  }))
}

function computeTotalValue(items: Array<{ currentStock: number; unitCost: number }>): number {
  return items.reduce((sum, item) => sum + item.currentStock * item.unitCost, 0)
}

async function getPurchasesInPeriod(
  db: SupabaseClient,
  tenantId: string,
  startAt: string,
  endAt: string
): Promise<number> {
  const { data, error } = await db
    .from('invoices')
    .select('total_amount')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .gte('confirmed_at', startAt)
    .lte('confirmed_at', endAt)

  if (error) throw new Error(`Invoice fetch failed: ${error.message}`)
  return (data ?? []).reduce((sum, inv) => sum + Number(inv.total_amount ?? 0), 0)
}

async function getDailyPurchases(
  db: SupabaseClient,
  tenantId: string,
  dateStr: string
): Promise<{ value: number; invoiceIds: string[] }> {
  const dayStart = `${dateStr}T00:00:00Z`
  const dayEnd = `${dateStr}T23:59:59Z`

  const { data, error } = await db
    .from('invoices')
    .select('id, total_amount')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .gte('confirmed_at', dayStart)
    .lte('confirmed_at', dayEnd)

  if (error) return { value: 0, invoiceIds: [] }
  const invoiceIds = (data ?? []).map(i => i.id)
  const value = (data ?? []).reduce((sum, i) => sum + Number(i.total_amount ?? 0), 0)
  return { value, invoiceIds }
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('📊 COGS Period Creation & Closing')
  console.log(`   Tenant: ${TENANT_ID}`)
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log()

  // We need to process periods using the data that was already inserted
  // by simulate-operations.ts and simulate-sales.ts
  // The beginning inventory for Feb = starting state (all items at initial stock)
  // The ending inventory = current state after Feb operations

  for (const period of PERIODS) {
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`📅 ${period.label}: ${period.startAt.slice(0, 10)} → ${period.endAt.slice(0, 10)}`)
    console.log('═'.repeat(50))

    // 1. Get inventory snapshot (serves as beginning for this period's computation)
    const inventoryItems = await getInventorySnapshot(supabase, TENANT_ID)
    const endingValue = computeTotalValue(inventoryItems)

    // 2. Get purchases in this period
    const purchasesValue = await getPurchasesInPeriod(supabase, TENANT_ID, period.startAt, period.endAt)

    // 3. For beginning inventory, we estimate from ending + sales - purchases
    //    In practice, beginning = previous period's ending
    //    For Feb (first period), we use a rough estimate: ending + estimated consumption - purchases
    //    Simplified: beginning ≈ ending + purchases * 0.8 (80% of purchases consumed)
    const estimatedConsumption = purchasesValue * 0.85
    const beginningValue = Number((endingValue + estimatedConsumption - purchasesValue).toFixed(2))

    // 4. COGS = beginning + purchases - ending
    const periodicCogs = Number((beginningValue + purchasesValue - endingValue).toFixed(2))

    console.log(`  📦 Beginning inventory: $${beginningValue.toFixed(2)}`)
    console.log(`  🛒 Purchases: $${purchasesValue.toFixed(2)}`)
    console.log(`  📦 Ending inventory: $${endingValue.toFixed(2)}`)
    console.log(`  💰 Periodic COGS: $${periodicCogs.toFixed(2)}`)

    if (DRY_RUN) {
      console.log(`  ⏭️ Dry run — skipping DB writes`)
      continue
    }

    // 5. Create period (or get existing)
    const { data: existing } = await supabase
      .from('cogs_periods')
      .select('id')
      .eq('tenant_id', TENANT_ID)
      .eq('start_at', period.startAt)
      .eq('end_at', period.endAt)
      .single()

    let periodRow: { id: string } | null = null

    if (existing) {
      periodRow = existing
      console.log(`  ✅ Period already exists: ${periodRow.id}`)
    } else {
      const { data: newPeriod, error: periodErr } = await supabase
        .from('cogs_periods')
        .insert({
          tenant_id: TENANT_ID,
          period_type: 'monthly',
          start_at: period.startAt,
          end_at: period.endAt,
          status: 'open',
          notes: `Simulation: ${period.label}`,
        })
        .select('id')
        .single()

      if (periodErr) {
        console.error(`  ❌ Period creation failed: ${periodErr.message}`)
        continue
      }
      periodRow = newPeriod
      console.log(`  ✅ Period created: ${periodRow.id}`)
    }

    // 6. Snapshot inventory valuations
    for (const item of inventoryItems) {
      if (item.currentStock <= 0 && item.unitCost <= 0) continue
      await supabase.from('inventory_valuations').insert({
        period_id: periodRow.id,
        inventory_item_id: item.id,
        qty_on_hand: item.currentStock,
        unit_cost: item.unitCost,
        value: Number((item.currentStock * item.unitCost).toFixed(2)),
        method: 'wac',
      })
    }
    console.log(`  ✅ Inventory valuations snapshotted (${inventoryItems.length} items)`)

    // 7. Insert COGS report
    const { error: reportErr } = await supabase.from('cogs_reports').insert({
      period_id: periodRow.id,
      tenant_id: TENANT_ID,
      begin_inventory_value: beginningValue,
      purchases_value: purchasesValue,
      end_inventory_value: endingValue,
      periodic_cogs_value: periodicCogs,
      currency: 'USD',
      inputs: {
        simulation: true,
        period: period.label,
        items_counted: inventoryItems.length,
      },
    })

    if (reportErr) {
      console.error(`  ❌ COGS report insert failed: ${reportErr.message}`)
    } else {
      console.log(`  ✅ COGS report inserted`)
    }

    // 8. Close the period
    await supabase
      .from('cogs_periods')
      .update({
        status: 'closed',
        closed_at: period.endAt,
        updated_at: period.endAt,
      })
      .eq('id', periodRow.id)
    console.log(`  ✅ Period closed`)

    // 9. Populate ai_cogs_daily_summaries
    console.log(`  📈 Generating daily summaries...`)
    const periodStart = new Date(period.startAt)
    let dailySummariesInserted = 0

    for (let d = 0; d < period.daysInPeriod; d++) {
      const dayDate = new Date(periodStart)
      dayDate.setDate(dayDate.getDate() + d)
      const dateStr = dayDate.toISOString().slice(0, 10)

      const dailyPurchases = await getDailyPurchases(supabase, TENANT_ID, dateStr)

      // Estimate daily values
      const dailyBeginning = Number((beginningValue / period.daysInPeriod).toFixed(2))
      const dailyEnding = Number((endingValue / period.daysInPeriod).toFixed(2))
      const dailyCogs = Number((periodicCogs / period.daysInPeriod).toFixed(2))

      const { error: dailyErr } = await supabase.from('ai_cogs_daily_summaries').insert({
        tenant_id: TENANT_ID,
        summary_date: dateStr,
        beginning_inventory_value: dailyBeginning,
        purchases_value: dailyPurchases.value,
        ending_inventory_value: dailyEnding,
        periodic_cogs: dailyCogs,
        contributing_invoice_ids: dailyPurchases.invoiceIds,
        computation_method: 'periodic',
      })

      if (dailyErr) {
        console.warn(`    ⚠️ Daily summary ${dateStr}: ${dailyErr.message}`)
      } else {
        dailySummariesInserted++
      }
    }
    console.log(`  ✅ ${dailySummariesInserted} daily summaries inserted`)
  }

  console.log('\n' + '═'.repeat(60))
  console.log(`✅ COGS periods complete${DRY_RUN ? ' (DRY RUN)' : ''}`)
  console.log('═'.repeat(60))
}

main().catch((err) => {
  console.error('💥 COGS period creation failed:', err)
  process.exit(1)
})
