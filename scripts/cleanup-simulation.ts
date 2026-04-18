#!/usr/bin/env node

/**
 * Clean up all simulation data to start fresh
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const TENANT_ID = '4fa1cbbe-49ff-4cde-a686-8d34252945b4'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function main() {
  console.log('🧹 Cleaning up simulation data...')
  console.log(`   Tenant: ${TENANT_ID}`)
  console.log()

  try {
    // Delete stock movements (must happen before sales/PO deletes)
    console.log('  Deleting stock movements...')
    await supabase
      .from('stock_movements')
      .delete()
      .eq('tenant_id', TENANT_ID)
      .gte('created_at', '2026-02-01')

    // Delete cost history from simulation invoices
    console.log('  Deleting cost history...')
    await supabase
      .from('inventory_item_cost_history')
      .delete()
      .like('notes', 'Invoice SIM-INV-%')

    // Delete sales transactions (cascades to items)
    console.log('  Deleting sales transactions...')
    await supabase
      .from('sales_transactions')
      .delete()
      .like('order_number', '#SIM-%')
      .eq('tenant_id', TENANT_ID)

    // Delete order-invoice matches before POs and invoices
    console.log('  Deleting order-invoice matches...')
    await supabase
      .from('order_invoice_matches')
      .delete()
      .eq('tenant_id', TENANT_ID)
      .eq('match_method', 'simulation')

    // Delete invoices (cascades to items)
    console.log('  Deleting invoices...')
    await supabase
      .from('invoices')
      .delete()
      .like('invoice_number', 'SIM-INV-%')
      .eq('tenant_id', TENANT_ID)

    // Delete purchase orders (cascades to items & receipts)
    console.log('  Deleting purchase orders...')
    await supabase
      .from('purchase_orders')
      .delete()
      .like('order_number', 'SIM-PO-%')
      .eq('tenant_id', TENANT_ID)

    // Reset inventory stock to 0 (seed state) for all simulation items
    console.log('  Resetting inventory stock to 0...')
    await supabase
      .from('inventory_items')
      .update({ current_stock: 0 })
      .eq('tenant_id', TENANT_ID)
      .like('square_item_id', 'SEED-%')

    // Delete COGS periods
    console.log('  Deleting COGS periods...')
    const { data: periods } = await supabase
      .from('cogs_periods')
      .select('id')
      .eq('tenant_id', TENANT_ID)
      .gte('start_at', '2026-02-01')
      .lte('end_at', '2026-04-01')

    if (periods?.length) {
      for (const p of periods) {
        await supabase
          .from('inventory_valuations')
          .delete()
          .eq('period_id', p.id)

        await supabase
          .from('cogs_reports')
          .delete()
          .eq('period_id', p.id)

        await supabase
          .from('cogs_periods')
          .delete()
          .eq('id', p.id)
      }
    }

    // Delete daily summaries
    console.log('  Deleting daily COGS summaries...')
    await supabase
      .from('ai_cogs_daily_summaries')
      .delete()
      .eq('tenant_id', TENANT_ID)
      .gte('summary_date', '2026-02-01')
      .lte('summary_date', '2026-03-31')

    console.log()
    console.log('✅ Cleanup complete. Ready to re-run simulation.')
    console.log()
    console.log('Next steps:')
    console.log('  SIMULATION_MODE=true npx tsx scripts/simulate-operations.ts')
    console.log('  SIMULATION_MODE=true npx tsx scripts/simulate-sales.ts')
    console.log('  SIMULATION_MODE=true npx tsx scripts/close-cogs-periods.ts')
    console.log('  npx tsx scripts/validate-simulation.ts')
  } catch (err) {
    console.error('❌ Cleanup failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main()
