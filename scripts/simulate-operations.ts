#!/usr/bin/env node

/**
 * MOK-80 (SIM-4): Cafe Operations Simulation — Purchase Orders, Receipts, Invoices
 *
 * Simulates 8 weeks of purchase-side operations (Feb 2 – Mar 30, 2026):
 *   Monday:    Create POs for all suppliers
 *   Wednesday: Receive POs (log_purchase_order_receipt RPC) → stock increases
 *   Thursday:  Create matched invoices → confirm with simulatedAt → cost history
 *
 * Usage:
 *   SIMULATION_MODE=true npx tsx scripts/simulate-operations.ts --dry-run
 *   SIMULATION_MODE=true npx tsx scripts/simulate-operations.ts
 *   SIMULATION_MODE=true npx tsx scripts/simulate-operations.ts --start-date 2026-02-01 --end-date 2026-03-31
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
const START_DATE = param('start-date', '2026-02-01')
const END_DATE = param('end-date', '2026-03-31')
const TENANT_ID = param('tenant-id', '4fa1cbbe-49ff-4cde-a686-8d34252945b4')

// ─── Supplier Config ────────────────────────────────────────────────
const SUPPLIERS: Record<string, { id: string; name: string }> = {
  walmart: { id: '1461623f-bbfd-4faf-820c-3205cf4a0db8', name: 'Walmart Business' },
  odeko: { id: '69f88f11-53fc-4dff-9e00-88e396d6a21a', name: 'Odeko' },
  samsClub: { id: '2dde7eab-9db7-4d91-a86c-03adfb4e3f04', name: "Sam's Club" },
  bluepoint: { id: 'b42e1a3c-0d5e-4f8a-9c1b-7e6d3a2f0b15', name: 'Bluepoint Bakery' },
}

// ─── Weekly PO Quantities ───────────────────────────────────────────
interface POLineItem {
  itemName: string
  squareItemId: string
  quantity: number
  unitCost: number
}

const WEEKLY_POS: Record<string, POLineItem[]> = {
  walmart: [
    { itemName: 'Whole Milk', squareItemId: 'SEED-WM-MILK-WHOLE', quantity: 25, unitCost: 4.29 },
    { itemName: 'Oat Milk', squareItemId: 'SEED-WM-MILK-OAT', quantity: 5, unitCost: 7.99 },
    { itemName: 'Almond Milk', squareItemId: 'SEED-WM-MILK-ALMOND', quantity: 3, unitCost: 6.49 },
    { itemName: 'Whipped Cream Can', squareItemId: 'SEED-WM-WHIP-CAN', quantity: 10, unitCost: 3.49 },
    { itemName: 'Vanilla Syrup', squareItemId: 'SEED-WM-SYRUP-VANILLA', quantity: 4, unitCost: 6.99 },
  ],
  odeko: [
    { itemName: 'Caramel Syrup', squareItemId: 'SEED-ODEKO-SYRUP-CARAMEL', quantity: 5, unitCost: 8.50 },
    { itemName: 'Hazelnut Syrup', squareItemId: 'SEED-ODEKO-SYRUP-HAZELNUT', quantity: 5, unitCost: 8.50 },
    { itemName: 'Mocha Sauce', squareItemId: 'SEED-ODEKO-MOCHA', quantity: 5, unitCost: 9.25 },
    { itemName: 'Strawberry Puree', squareItemId: 'SEED-ODEKO-PUREE-STRAWB', quantity: 3, unitCost: 11.00 },
    { itemName: 'Mango Puree', squareItemId: 'SEED-ODEKO-PUREE-MANGO', quantity: 3, unitCost: 11.00 },
    { itemName: 'Chai Concentrate', squareItemId: 'SEED-ODEKO-CHAI', quantity: 3, unitCost: 12.00 },
    { itemName: 'Matcha Powder', squareItemId: 'SEED-ODEKO-MATCHA', quantity: 8, unitCost: 1.85 },
  ],
  samsClub: [
    { itemName: 'Espresso Beans', squareItemId: 'SEED-SC-ESPRESSO', quantity: 10, unitCost: 9.50 },
    { itemName: 'Cold Brew Concentrate', squareItemId: 'SEED-SC-COLDBREW', quantity: 2, unitCost: 18.00 },
  ],
  bluepoint: [
    { itemName: 'Sourdough Loaf', squareItemId: 'SEED-BP-SOURDOUGH', quantity: 20, unitCost: 4.50 },
    { itemName: 'Croissant', squareItemId: 'SEED-BP-CROISSANT', quantity: 30, unitCost: 2.75 },
    { itemName: 'Bagel', squareItemId: 'SEED-BP-BAGEL', quantity: 24, unitCost: 1.50 },
    { itemName: 'Danish', squareItemId: 'SEED-BP-DANISH', quantity: 20, unitCost: 3.00 },
  ],
}

// ─── Helpers ────────────────────────────────────────────────────────
function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function isoAt(date: Date, hour: number): string {
  const d = new Date(date)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}

/** Resolve inventory_item_id from square_item_id */
async function resolveInventoryItemIds(
  db: SupabaseClient,
  tenantId: string
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('inventory_items')
    .select('id, square_item_id')
    .eq('tenant_id', tenantId)
    .not('square_item_id', 'is', null)

  if (error) throw new Error(`Failed to fetch inventory items: ${error.message}`)
  const map = new Map<string, string>()
  for (const row of data ?? []) {
    if (row.square_item_id) map.set(row.square_item_id, row.id)
  }
  return map
}

// ─── PO Creation ────────────────────────────────────────────────────
interface CreatedPO {
  poId: string
  supplierId: string
  supplierKey: string
  items: Array<{ poItemId: string; inventoryItemId: string; quantity: number; unitCost: number }>
}

async function createPO(
  db: SupabaseClient,
  tenantId: string,
  supplierKey: string,
  weekNum: number,
  orderDate: Date,
  expectedDelivery: Date,
  itemMap: Map<string, string>
): Promise<CreatedPO | null> {
  const supplier = SUPPLIERS[supplierKey]
  const lines = WEEKLY_POS[supplierKey]
  if (!supplier || !lines) return null

  const orderNumber = `SIM-PO-${supplierKey.toUpperCase()}-W${String(weekNum).padStart(2, '0')}`
  const totalAmount = lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0)

  // Insert PO
  const { data: po, error: poErr } = await db
    .from('purchase_orders')
    .insert({
      supplier_id: supplier.id,
      tenant_id: tenantId,
      order_number: orderNumber,
      status: 'sent',
      order_date: formatDate(orderDate),
      expected_delivery_date: formatDate(expectedDelivery),
      total_amount: Number(totalAmount.toFixed(2)),
      notes: `Simulation week ${weekNum}`,
      created_at: isoAt(orderDate, 9),
      updated_at: isoAt(orderDate, 9),
    })
    .select('id')
    .single()

  if (poErr) {
    console.error(`  ❌ PO insert failed (${orderNumber}): ${poErr.message}`)
    return null
  }

  // Insert PO items
  const poItems: CreatedPO['items'] = []
  for (const line of lines) {
    const inventoryItemId = itemMap.get(line.squareItemId)
    if (!inventoryItemId) {
      console.warn(`  ⚠️ No inventory item for ${line.squareItemId} (${line.itemName}) — skipping`)
      continue
    }

    const { data: poItem, error: poItemErr } = await db
      .from('purchase_order_items')
      .insert({
        purchase_order_id: po.id,
        inventory_item_id: inventoryItemId,
        tenant_id: tenantId,
        quantity_ordered: line.quantity,
        quantity_received: 0,
        unit_cost: line.unitCost,
        created_at: isoAt(orderDate, 9),
      })
      .select('id')
      .single()

    if (poItemErr) {
      console.warn(`  ⚠️ PO item insert failed (${line.itemName}): ${poItemErr.message}`)
      continue
    }

    poItems.push({
      poItemId: poItem.id,
      inventoryItemId,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })
  }

  return { poId: po.id, supplierId: supplier.id, supplierKey, items: poItems }
}

// ─── PO Receipt ─────────────────────────────────────────────────────
async function receivePO(
  db: SupabaseClient,
  po: CreatedPO,
  receiptDate: Date
): Promise<void> {
  for (const item of po.items) {
    const { error } = await db.rpc('log_purchase_order_receipt', {
      p_purchase_order_id: po.poId,
      p_purchase_order_item_id: item.poItemId,
      p_quantity: item.quantity,
      p_received_by: null,
      p_notes: 'Simulation receipt',
    })

    if (error) {
      console.warn(`  ⚠️ Receipt RPC failed (PO ${po.poId}, item ${item.poItemId}): ${error.message}`)
    }
  }

  // Update PO status
  await db
    .from('purchase_orders')
    .update({
      status: 'received',
      actual_delivery_date: formatDate(receiptDate),
      updated_at: isoAt(receiptDate, 14),
    })
    .eq('id', po.poId)
}

// ─── Invoice Creation & Confirmation ────────────────────────────────
async function createAndConfirmInvoice(
  db: SupabaseClient,
  tenantId: string,
  po: CreatedPO,
  invoiceDate: Date
): Promise<string | null> {
  const supplier = SUPPLIERS[po.supplierKey]
  const invoiceNumber = `SIM-INV-${po.supplierKey.toUpperCase()}-${formatDate(invoiceDate).replace(/-/g, '')}`
  const totalAmount = po.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0)

  // Insert invoice
  const { data: invoice, error: invErr } = await db
    .from('invoices')
    .insert({
      supplier_id: supplier.id,
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      invoice_date: formatDate(invoiceDate),
      total_amount: Number(totalAmount.toFixed(2)),
      status: 'matched',
      created_at: isoAt(invoiceDate, 10),
      updated_at: isoAt(invoiceDate, 10),
    })
    .select('id')
    .single()

  if (invErr) {
    console.error(`  ❌ Invoice insert failed (${invoiceNumber}): ${invErr.message}`)
    return null
  }

  // Insert invoice items
  for (const item of po.items) {
    await db.from('invoice_items').insert({
      invoice_id: invoice.id,
      tenant_id: tenantId,
      inventory_item_id: item.inventoryItemId,
      description: `Simulation item`,
      quantity: item.quantity,
      unit_price: item.unitCost,
      total_price: Number((item.quantity * item.unitCost).toFixed(2)),
      created_at: isoAt(invoiceDate, 10),
    })
  }

  // Create PO-invoice match
  await db.from('order_invoice_matches').insert({
    purchase_order_id: po.poId,
    invoice_id: invoice.id,
    tenant_id: tenantId,
    status: 'confirmed',
    match_type: 'manual',
    match_confidence: 1.0,
    created_at: isoAt(invoiceDate, 10),
    updated_at: isoAt(invoiceDate, 10),
  })

  // Confirm invoice via API-equivalent DB operations
  // (We replicate what the confirm route does: update status + cost history)
  const simulatedAt = isoAt(invoiceDate, 11)

  await db
    .from('invoices')
    .update({
      status: 'confirmed',
      confirmed_at: simulatedAt,
      updated_at: simulatedAt,
    })
    .eq('id', invoice.id)

  // Write cost history entries
  for (const item of po.items) {
    await db.from('inventory_item_cost_history').insert({
      inventory_item_id: item.inventoryItemId,
      tenant_id: tenantId,
      old_cost: item.unitCost,
      new_cost: item.unitCost,
      change_reason: 'invoice_confirm',
      reference_id: invoice.id,
      changed_at: simulatedAt,
    })

    // Update current unit_cost on inventory_items
    await db
      .from('inventory_items')
      .update({ unit_cost: item.unitCost, updated_at: simulatedAt })
      .eq('id', item.inventoryItemId)
  }

  return invoice.id
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('🏭 Cafe Operations Simulation — POs, Receipts, Invoices')
  console.log(`   Tenant: ${TENANT_ID}`)
  console.log(`   Period: ${START_DATE} to ${END_DATE}`)
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log()

  // Resolve inventory items
  const itemMap = await resolveInventoryItemIds(supabase, TENANT_ID)
  console.log(`📦 Found ${itemMap.size} inventory items with square_item_id`)

  // Check for Bluepoint bakery items — if not in inventory, seed them
  const bpItems = WEEKLY_POS.bluepoint
  const missingBP = bpItems.filter(i => !itemMap.has(i.squareItemId))
  if (missingBP.length > 0) {
    console.log(`\n🍞 Seeding ${missingBP.length} Bluepoint Bakery items...`)
    if (!DRY_RUN) {
      for (const item of missingBP) {
        const { data, error } = await supabase
          .from('inventory_items')
          .insert({
            tenant_id: TENANT_ID,
            item_name: item.itemName,
            square_item_id: item.squareItemId,
            supplier_id: SUPPLIERS.bluepoint.id,
            unit_type: 'each',
            unit_cost: item.unitCost,
            current_stock: 0,
            reorder_point: 5,
            is_ingredient: false,
            item_type: 'ingredient',
          })
          .select('id')
          .single()

        if (error) {
          console.warn(`  ⚠️ Failed to seed ${item.itemName}: ${error.message}`)
        } else if (data) {
          itemMap.set(item.squareItemId, data.id)
          console.log(`  ✅ ${item.itemName} → ${data.id}`)
        }
      }
    }
  }

  // Check for Bluepoint supplier — create if missing
  const { data: bpSupplier } = await supabase
    .from('suppliers')
    .select('id')
    .eq('id', SUPPLIERS.bluepoint.id)
    .single()

  if (!bpSupplier && !DRY_RUN) {
    console.log('\n🏪 Creating Bluepoint Bakery supplier...')
    await supabase.from('suppliers').insert({
      id: SUPPLIERS.bluepoint.id,
      tenant_id: TENANT_ID,
      name: 'Bluepoint Bakery',
      contact_name: 'Bluepoint Orders',
      email: 'orders@bluepointbakery.com',
    })
  }

  // Generate weekly schedule
  const start = new Date(START_DATE + 'T00:00:00Z')
  const end = new Date(END_DATE + 'T23:59:59Z')

  // Find first Monday on or after start
  let cursor = new Date(start)
  while (cursor.getUTCDay() !== 1) {
    cursor = addDays(cursor, 1)
  }

  let weekNum = 0
  const allPOs: Array<{ week: number; pos: CreatedPO[] }> = []
  let totalPOs = 0
  let totalInvoices = 0

  while (cursor <= end) {
    weekNum++
    const monday = new Date(cursor)
    const wednesday = addDays(monday, 2)
    const thursday = addDays(monday, 3)

    console.log(`\n📅 Week ${weekNum}: ${formatDate(monday)} (Mon) → ${formatDate(thursday)} (Thu)`)

    // Monday — create POs
    const weekPOs: CreatedPO[] = []
    for (const supplierKey of Object.keys(WEEKLY_POS)) {
      const lineItems = WEEKLY_POS[supplierKey]
      const totalCost = lineItems.reduce((s, l) => s + l.quantity * l.unitCost, 0).toFixed(2)
      console.log(`  📝 PO → ${SUPPLIERS[supplierKey].name}: ${lineItems.length} items, $${totalCost}`)

      if (!DRY_RUN) {
        const po = await createPO(supabase, TENANT_ID, supplierKey, weekNum, monday, wednesday, itemMap)
        if (po) {
          weekPOs.push(po)
          totalPOs++
        }
      } else {
        totalPOs++
      }
    }

    // Wednesday — receive POs
    if (!DRY_RUN) {
      for (const po of weekPOs) {
        console.log(`  📥 Receiving PO for ${SUPPLIERS[po.supplierKey].name} (${po.items.length} items)`)
        await receivePO(supabase, po, wednesday)
      }
    } else {
      console.log(`  📥 Would receive ${Object.keys(WEEKLY_POS).length} POs`)
    }

    // Thursday — create and confirm invoices
    if (!DRY_RUN) {
      for (const po of weekPOs) {
        console.log(`  🧾 Invoice → ${SUPPLIERS[po.supplierKey].name}`)
        const invoiceId = await createAndConfirmInvoice(supabase, TENANT_ID, po, thursday)
        if (invoiceId) totalInvoices++
      }
    } else {
      console.log(`  🧾 Would create ${Object.keys(WEEKLY_POS).length} invoices`)
      totalInvoices += Object.keys(WEEKLY_POS).length
    }

    allPOs.push({ week: weekNum, pos: weekPOs })
    cursor = addDays(cursor, 7)
  }

  console.log('\n' + '═'.repeat(60))
  console.log(`✅ Simulation complete${DRY_RUN ? ' (DRY RUN)' : ''}`)
  console.log(`   Weeks simulated: ${weekNum}`)
  console.log(`   POs created: ${totalPOs}`)
  console.log(`   Invoices created & confirmed: ${totalInvoices}`)
  console.log('═'.repeat(60))
}

main().catch((err) => {
  console.error('💥 Simulation failed:', err)
  process.exit(1)
})
