#!/usr/bin/env node

/**
 * MOK-80 (SIM-4): Cafe Operations Simulation — Purchase Orders, Receipts, Invoices
 *
 * Simulates 8 weeks of purchase-side operations (Feb 2 – Mar 30, 2026):
 *   Monday:    Create POs for Walmart, Odeko, Sam's Club, Bluepoint Bakery
 *   Wednesday: Receive POs (log_purchase_order_receipt RPC) → stock increases
 *   Thursday:  Create matched invoices → confirm with simulatedAt → cost history
 *
 * Usage:
 *   SIMULATION_MODE=true npx tsx scripts/simulate-operations.ts --dry-run
 *   SIMULATION_MODE=true npx tsx scripts/simulate-operations.ts
 *   SIMULATION_MODE=true npx tsx scripts/simulate-operations.ts --start-date 2026-02-01 --end-date 2026-03-31
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// ─── Safety Gate ────────────────────────────────────────────────────
if (process.env.SIMULATION_MODE !== 'true') {
  console.error('❌ SIMULATION_MODE must be set to "true"')
  process.exit(1)
}

// ─── Supabase Client ────────────────────────────────────────────────
function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY
  if (!url) throw new Error('Missing Supabase URL. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.')
  if (!serviceKey) throw new Error('Missing Supabase secret key. Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ─── Constants ──────────────────────────────────────────────────────
const BIGCAFE_TENANT_ID = '4fa1cbbe-49ff-4cde-a686-8d34252945b4'

const SUPPLIER_NAMES = ['Walmart Business', 'Odeko', "Sam's Club", 'Bluepoint Bakery'] as const

// ─── Weekly PO Quantities (calibrated for ~80 drinks/day) ───────────
interface POLineItem {
  itemName: string
  squareItemId: string
  quantity: number
  unitCost: number
}

interface SupplierPO {
  supplierName: string
  items: POLineItem[]
}

const WEEKLY_POS: SupplierPO[] = [
  {
    supplierName: 'Walmart Business',
    items: [
      { itemName: 'Whole Milk', squareItemId: 'SEED-WM-MILK-WHOLE', quantity: 25, unitCost: 4.29 },
      { itemName: 'Oat Milk', squareItemId: 'SEED-WM-MILK-OAT', quantity: 5, unitCost: 7.99 },
      { itemName: 'Almond Milk', squareItemId: 'SEED-WM-MILK-ALMOND', quantity: 3, unitCost: 6.49 },
      { itemName: 'Whipped Cream Can', squareItemId: 'SEED-WM-WHIP-CAN', quantity: 10, unitCost: 3.49 },
      { itemName: 'Vanilla Syrup', squareItemId: 'SEED-WM-SYRUP-VANILLA', quantity: 4, unitCost: 6.99 },
    ],
  },
  {
    supplierName: 'Odeko',
    items: [
      { itemName: 'Caramel Syrup', squareItemId: 'SEED-ODEKO-SYRUP-CARAMEL', quantity: 5, unitCost: 8.50 },
      { itemName: 'Hazelnut Syrup', squareItemId: 'SEED-ODEKO-SYRUP-HAZELNUT', quantity: 5, unitCost: 8.50 },
      { itemName: 'Mocha Sauce', squareItemId: 'SEED-ODEKO-MOCHA', quantity: 5, unitCost: 9.25 },
      { itemName: 'Strawberry Puree', squareItemId: 'SEED-ODEKO-PUREE-STRAWB', quantity: 3, unitCost: 11.00 },
      { itemName: 'Mango Puree', squareItemId: 'SEED-ODEKO-PUREE-MANGO', quantity: 3, unitCost: 11.00 },
      { itemName: 'Chai Concentrate', squareItemId: 'SEED-ODEKO-CHAI', quantity: 3, unitCost: 12.00 },
      { itemName: 'Matcha Powder', squareItemId: 'SEED-ODEKO-MATCHA', quantity: 8, unitCost: 1.85 },
    ],
  },
  {
    supplierName: "Sam's Club",
    items: [
      { itemName: 'Espresso Beans', squareItemId: 'SEED-SC-ESPRESSO', quantity: 10, unitCost: 9.50 },
      { itemName: 'Cold Brew Concentrate', squareItemId: 'SEED-SC-COLDBREW', quantity: 2, unitCost: 18.00 },
    ],
  },
  {
    supplierName: 'Bluepoint Bakery',
    items: [
      { itemName: 'Sourdough Bread', squareItemId: 'SEED-BP-SOURDOUGH', quantity: 20, unitCost: 12.50 },
      { itemName: 'Croissants', squareItemId: 'SEED-BP-CROISSANT', quantity: 30, unitCost: 18.00 },
      { itemName: 'Bagels', squareItemId: 'SEED-BP-BAGEL', quantity: 24, unitCost: 15.00 },
      { itemName: 'Danish Pastries', squareItemId: 'SEED-BP-DANISH', quantity: 20, unitCost: 16.00 },
    ],
  },
]

// ─── CLI Args ───────────────────────────────────────────────────────
interface Options {
  dryRun: boolean
  startDate: string
  endDate: string
  tenantId: string
}

function parseArgs(argv: string[]): Options {
  const args = argv.slice(2)
  const flag = (name: string) => args.includes(`--${name}`)
  const param = (name: string, fallback: string) => {
    const idx = args.indexOf(`--${name}`)
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
  }
  return {
    dryRun: flag('dry-run'),
    startDate: param('start-date', '2026-02-01'),
    endDate: param('end-date', '2026-03-31'),
    tenantId: param('tenant-id', BIGCAFE_TENANT_ID),
  }
}

// ─── Date Helpers ───────────────────────────────────────────────────
function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function isoAt(date: Date, hour: number): string {
  const d = new Date(date)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}

function getMondays(startStr: string, endStr: string): Date[] {
  const mondays: Date[] = []
  const end = new Date(endStr + 'T23:59:59Z')
  const cursor = new Date(startStr + 'T00:00:00Z')
  // Advance to first Monday on or after start
  while (cursor.getUTCDay() !== 1) cursor.setUTCDate(cursor.getUTCDate() + 1)
  while (cursor <= end) {
    mondays.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  }
  return mondays
}

// ─── DB Lookups ─────────────────────────────────────────────────────
interface SupplierRow { id: string; name: string }
interface InventoryRow { id: string; item_name: string; square_item_id: string; unit_cost: number }

async function loadSuppliers(db: SupabaseClient, tenantId: string): Promise<Map<string, SupplierRow>> {
  const { data, error } = await db
    .from('suppliers')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
  if (error) throw new Error(`Failed loading suppliers: ${error.message}`)
  const map = new Map<string, SupplierRow>()
  for (const row of data ?? []) map.set(row.name as string, { id: row.id as string, name: row.name as string })
  return map
}

async function loadInventoryBySquareId(db: SupabaseClient, tenantId: string): Promise<Map<string, InventoryRow>> {
  const { data, error } = await db
    .from('inventory_items')
    .select('id, item_name, square_item_id, unit_cost')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
  if (error) throw new Error(`Failed loading inventory: ${error.message}`)
  const map = new Map<string, InventoryRow>()
  for (const row of data ?? []) {
    if (row.square_item_id) {
      map.set(row.square_item_id as string, {
        id: row.id as string,
        item_name: row.item_name as string,
        square_item_id: row.square_item_id as string,
        unit_cost: Number(row.unit_cost ?? 0),
      })
    }
  }
  return map
}

// ─── PO Creation (Monday) ──────────────────────────────────────────
interface CreatedPO {
  poId: string
  supplierId: string
  supplierName: string
  poItems: Array<{ poItemId: string; inventoryItemId: string; itemName: string; quantity: number; unitCost: number }>
}

async function createPO(
  db: SupabaseClient,
  tenantId: string,
  supplierId: string,
  supplierName: string,
  weekNum: number,
  monday: Date,
  wednesday: Date,
  lines: POLineItem[],
  itemMap: Map<string, InventoryRow>,
): Promise<CreatedPO | null> {
  const orderNumber = `SIM-PO-${supplierName.replace(/[^A-Z0-9]/gi, '').slice(0, 10).toUpperCase()}-W${String(weekNum).padStart(2, '0')}`
  const totalAmount = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0)

  // Check if PO already exists
  const { data: existing } = await db
    .from('purchase_orders')
    .select('id')
    .eq('order_number', orderNumber)
    .eq('tenant_id', tenantId)
    .single()

  let po: { id: string } | null = null

  if (existing) {
    po = existing
  } else {
    // Create new PO
    const { data: newPo, error: poErr } = await db
      .from('purchase_orders')
      .insert({
        supplier_id: supplierId,
        tenant_id: tenantId,
        order_number: orderNumber,
        status: 'sent',
        order_date: fmtDate(monday),
        expected_delivery_date: fmtDate(wednesday),
        total_amount: Number(totalAmount.toFixed(2)),
        sent_at: isoAt(monday, 9),
        notes: `Simulation week ${weekNum}`,
      })
      .select('id')
      .single()

    if (poErr) {
      console.error(`  ❌ PO insert failed (${orderNumber}): ${poErr.message}`)
      return null
    }
    po = newPo
  }

  // Delete existing items for idempotency
  await db.from('purchase_order_items').delete().eq('purchase_order_id', po.id)

  const poItems: CreatedPO['poItems'] = []
  for (const line of lines) {
    const inv = itemMap.get(line.squareItemId)
    if (!inv) {
      console.warn(`  ⚠️ No inventory item for ${line.squareItemId} (${line.itemName}) — skipping`)
      continue
    }

    const { data: poItem, error: piErr } = await db
      .from('purchase_order_items')
      .insert({
        purchase_order_id: po.id,
        inventory_item_id: inv.id,
        tenant_id: tenantId,
        quantity_ordered: line.quantity,
        quantity_received: 0,
        unit_cost: line.unitCost,
      })
      .select('id')
      .single()

    if (piErr) {
      console.warn(`  ⚠️ PO item insert failed (${line.itemName}): ${piErr.message}`)
      continue
    }

    poItems.push({
      poItemId: poItem.id as string,
      inventoryItemId: inv.id,
      itemName: line.itemName,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })
  }

  return { poId: po.id as string, supplierId, supplierName, poItems }
}

// ─── PO Receipt (Wednesday) ────────────────────────────────────────
async function receivePO(db: SupabaseClient, po: CreatedPO, receiptDate: Date): Promise<void> {
  for (const item of po.poItems) {
    const { error } = await db.rpc('log_purchase_order_receipt', {
      p_purchase_order_id: po.poId,
      p_purchase_order_item_id: item.poItemId,
      p_quantity: item.quantity,
      p_received_by: null,
      p_notes: `Simulation receipt ${fmtDate(receiptDate)}`,
    })
    if (error) {
      console.warn(`  ⚠️ Receipt RPC failed (${item.itemName}): ${error.message}`)
    }
  }

  await db
    .from('purchase_orders')
    .update({
      status: 'received',
      received_at: isoAt(receiptDate, 10),
      actual_delivery_date: fmtDate(receiptDate),
    })
    .eq('id', po.poId)
}

// ─── Invoice Creation & Confirmation (Thursday) ────────────────────
async function createAndConfirmInvoice(
  db: SupabaseClient,
  tenantId: string,
  po: CreatedPO,
  invoiceDate: Date,
  weekNum: number,
): Promise<string | null> {
  const invoiceNumber = `SIM-INV-${po.supplierName.replace(/[^A-Z0-9]/gi, '').slice(0, 10).toUpperCase()}-W${String(weekNum).padStart(2, '0')}`
  const totalAmount = po.poItems.reduce((s, i) => s + i.quantity * i.unitCost, 0)
  const simulatedAt = isoAt(invoiceDate, 14)

  // Check if invoice already exists
  const { data: existingInv } = await db
    .from('invoices')
    .select('id')
    .eq('invoice_number', invoiceNumber)
    .eq('tenant_id', tenantId)
    .single()

  let invoice: { id: string } | null = null

  if (existingInv) {
    invoice = existingInv
  } else {
    // Create new invoice
    const { data: newInv, error: invErr } = await db
      .from('invoices')
      .insert({
        supplier_id: po.supplierId,
        tenant_id: tenantId,
        invoice_number: invoiceNumber,
        invoice_date: fmtDate(invoiceDate),
        total_amount: Number(totalAmount.toFixed(2)),
        status: 'matched',
        pipeline_stage: null,
        parsing_confidence: 1.0,
      })
      .select('id')
      .single()

    if (invErr) {
      console.error(`  ❌ Invoice insert failed (${invoiceNumber}): ${invErr.message}`)
      return null
    }
    invoice = newInv
  }
  const invoiceId = invoice.id as string

  // Delete existing items for idempotency
  await db.from('invoice_items').delete().eq('invoice_id', invoiceId)

  // Insert invoice items (matched to inventory)
  const invoiceItemRows = po.poItems.map((item, idx) => ({
    invoice_id: invoiceId,
    tenant_id: tenantId,
    line_number: idx + 1,
    item_description: item.itemName,
    quantity: item.quantity,
    unit_price: item.unitCost,
    total_price: Number((item.quantity * item.unitCost).toFixed(2)),
    matched_item_id: item.inventoryItemId,
    match_confidence: 1.0,
    match_method: 'exact',
    is_reviewed: true,
  }))

  const { error: iiErr } = await db.from('invoice_items').insert(invoiceItemRows)
  if (iiErr) {
    console.error(`  ❌ Invoice items insert failed: ${iiErr.message}`)
    return null
  }

  // Create PO ↔ invoice match (simple insert, will fail if duplicate but that's OK for simulation)
  await db
    .from('order_invoice_matches')
    .insert({
      purchase_order_id: po.poId,
      invoice_id: invoiceId,
      tenant_id: tenantId,
      match_confidence: 1.0,
      match_method: 'simulation',
      status: 'confirmed',
      reviewed_at: simulatedAt,
    })
    .throwOnError()

  // ── Inline confirm logic (mirrors /api/admin/invoices/[id]/confirm) ──
  // Write cost history for each matched item
  for (const item of po.poItems) {
    const { data: invItem } = await db
      .from('inventory_items')
      .select('unit_cost')
      .eq('id', item.inventoryItemId)
      .single()

    const previousCost = Number(invItem?.unit_cost ?? 0)
    const costChanged = Math.abs(item.unitCost - previousCost) > 0.0001

    if (costChanged) {
      await db
        .from('inventory_items')
        .update({ unit_cost: item.unitCost, updated_at: simulatedAt })
        .eq('id', item.inventoryItemId)
    }

    // Always write cost history entry (confirm route does this)
    await db.from('inventory_item_cost_history').insert({
      inventory_item_id: item.inventoryItemId,
      previous_unit_cost: previousCost,
      new_unit_cost: item.unitCost,
      pack_size: 1,
      source: 'invoice_confirm',
      source_ref: invoiceId,
      notes: `Invoice ${invoiceNumber} (${po.supplierName})`,
      changed_by: null,
      changed_at: simulatedAt,
    })
  }

  // Update PO to confirmed
  await db
    .from('purchase_orders')
    .update({
      status: 'confirmed',
      confirmed_at: simulatedAt,
      notes: `Confirmed via invoice ${invoiceNumber}`,
    })
    .eq('id', po.poId)

  // Mark invoice confirmed
  await db
    .from('invoices')
    .update({ status: 'confirmed', confirmed_at: simulatedAt, updated_at: simulatedAt })
    .eq('id', invoiceId)

  return invoiceId
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv)
  const mondays = getMondays(opts.startDate, opts.endDate)

  console.log('🏭 Cafe Operations Simulation — POs, Receipts, Invoices (MOK-80)')
  console.log(`   Tenant: ${opts.tenantId}`)
  console.log(`   Period: ${opts.startDate} to ${opts.endDate}`)
  console.log(`   Weeks:  ${mondays.length}`)
  console.log(`   Dry run: ${opts.dryRun}`)
  console.log()

  if (mondays.length === 0) {
    console.log('No Mondays found in date range. Nothing to do.')
    return
  }

  if (opts.dryRun) {
    console.log('── Dry Run Plan ──')
    for (let w = 0; w < mondays.length; w++) {
      const mon = mondays[w]
      const wed = addDays(mon, 2)
      const thu = addDays(mon, 3)
      console.log(`\nWeek ${w + 1}: Mon ${fmtDate(mon)}`)
      console.log(`  Monday:    Create POs for ${SUPPLIER_NAMES.join(', ')}`)
      console.log(`  Wednesday: Receive POs (${fmtDate(wed)})`)
      console.log(`  Thursday:  Create & confirm invoices (${fmtDate(thu)})`)
      for (const order of WEEKLY_POS) {
        const total = order.items.reduce((s, i) => s + i.quantity * i.unitCost, 0)
        console.log(`    ${order.supplierName}: ${order.items.length} items, $${total.toFixed(2)}`)
      }
    }
    console.log('\nDry run complete. Remove --dry-run to execute.')
    return
  }

  const db = createSupabaseServiceClient()

  // Load suppliers and inventory
  console.log('Loading suppliers and inventory items...')
  const suppliers = await loadSuppliers(db, opts.tenantId)
  const itemMap = await loadInventoryBySquareId(db, opts.tenantId)

  // Validate all suppliers exist
  for (const name of SUPPLIER_NAMES) {
    if (!suppliers.has(name)) {
      throw new Error(`Supplier "${name}" not found for tenant ${opts.tenantId}. Run seed migrations first.`)
    }
  }

  // Validate all inventory items exist
  for (const order of WEEKLY_POS) {
    for (const item of order.items) {
      if (!itemMap.has(item.squareItemId)) {
        throw new Error(
          `Inventory item "${item.itemName}" (${item.squareItemId}) not found. ` +
            'Run seed-drink-ingredients.ts and ensure seed migrations have run.',
        )
      }
    }
  }

  console.log(`  ${suppliers.size} suppliers, ${itemMap.size} inventory items`)
  console.log()

  let totalPOs = 0
  let totalInvoices = 0

  for (let w = 0; w < mondays.length; w++) {
    const weekNum = w + 1
    const monday = mondays[w]
    const wednesday = addDays(monday, 2)
    const thursday = addDays(monday, 3)

    console.log(`── Week ${weekNum}: ${fmtDate(monday)} ──`)

    // Monday: Create POs
    const weekPOs: CreatedPO[] = []
    for (const order of WEEKLY_POS) {
      const supplier = suppliers.get(order.supplierName)
      if (!supplier) continue

      const po = await createPO(
        db, opts.tenantId, supplier.id, supplier.name,
        weekNum, monday, wednesday, order.items, itemMap,
      )
      if (po) {
        weekPOs.push(po)
        totalPOs++
        console.log(`  📋 PO created: ${supplier.name} (${po.poItems.length} items)`)
      }
    }

    // Wednesday: Receive POs
    for (const po of weekPOs) {
      await receivePO(db, po, wednesday)
      console.log(`  📥 PO received: ${po.supplierName}`)
    }

    // Thursday: Create and confirm invoices
    for (const po of weekPOs) {
      const invoiceId = await createAndConfirmInvoice(db, opts.tenantId, po, thursday, weekNum)
      if (invoiceId) {
        totalInvoices++
        console.log(`  ✅ Invoice confirmed: ${po.supplierName}`)
      }
    }

    console.log()
  }

  console.log('═'.repeat(60))
  console.log('✅ Weekly PO cycle simulation complete!')
  console.log(`   Weeks: ${mondays.length}`)
  console.log(`   POs: ${totalPOs}`)
  console.log(`   Invoices confirmed: ${totalInvoices}`)
  console.log('═'.repeat(60))
}

main().catch((err) => {
  console.error('❌ Fatal error:', err instanceof Error ? err.message : String(err))
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
