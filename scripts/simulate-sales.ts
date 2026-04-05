#!/usr/bin/env node

/**
 * MOK-81 (SIM-5): Cafe Operations Simulation — Daily Drink Sales
 *
 * Generates daily sales data (Feb 1 – Mar 31, 2026):
 *   ~80 drinks/day (weekdays), ~50 drinks/day (weekends)
 *   Spread across 8am–6pm in realistic clusters
 *
 * For each sale:
 *   1. Insert sales_transactions + sales_transaction_items
 *   2. Decrement inventory via decrement_inventory_stock RPC
 *   3. Insert stock_movements (movement_type='sale', backdated)
 *
 * Drink mix: 35% lattes, 12% frappuccinos, 10% double espresso,
 *   12% refreshers, 10% iced teas, 8% smoothies, 8% matcha/chai,
 *   5% caramel/hazelnut lattes
 *
 * Usage:
 *   SIMULATION_MODE=true npx tsx scripts/simulate-sales.ts --dry-run
 *   SIMULATION_MODE=true npx tsx scripts/simulate-sales.ts
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
  if (!url) throw new Error('Missing Supabase URL.')
  if (!serviceKey) throw new Error('Missing Supabase secret key.')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ─── Constants ──────────────────────────────────────────────────────
const BIGCAFE_TENANT_ID = '4fa1cbbe-49ff-4cde-a686-8d34252945b4'

// ─── CLI Args ───────────────────────────────────────────────────────
interface Options {
  dryRun: boolean
  startDate: string
  endDate: string
  tenantId: string
  locationId: string
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
    locationId: param('location', process.env.SQUARE_LOCATION_ID || 'SIM-LOCATION-001'),
  }
}

// ─── Drink Types & Mix ──────────────────────────────────────────────
// Ingredient usage is fractional per drink (in the item's native unit).
// E.g., 0.08 gallon of whole milk = ~10oz per latte
interface IngredientUsage {
  squareItemId: string
  qtyPerDrink: number // in native unit (gallon, lb, oz, bottle, can)
}

interface DrinkType {
  name: string
  catalogId: string
  weight: number
  priceRange: [number, number]
  ingredients: IngredientUsage[]
}

const DRINK_TYPES: DrinkType[] = [
  {
    name: 'Latte',
    catalogId: 'SIM-DRINK-LATTE',
    weight: 0.35,
    priceRange: [5.50, 6.50],
    ingredients: [
      { squareItemId: 'SEED-SC-ESPRESSO', qtyPerDrink: 0.04 },     // ~18g × 2 shots
      { squareItemId: 'SEED-WM-MILK-WHOLE', qtyPerDrink: 0.08 },   // ~10oz milk
    ],
  },
  {
    name: 'Frappuccino',
    catalogId: 'SIM-DRINK-FRAP',
    weight: 0.12,
    priceRange: [6.00, 7.50],
    ingredients: [
      { squareItemId: 'SEED-WM-MILK-WHOLE', qtyPerDrink: 0.06 },
      { squareItemId: 'SEED-ODEKO-MOCHA', qtyPerDrink: 0.03 },
      { squareItemId: 'SEED-WM-WHIP-CAN', qtyPerDrink: 0.05 },
    ],
  },
  {
    name: 'Double Espresso',
    catalogId: 'SIM-DRINK-ESPRESSO',
    weight: 0.10,
    priceRange: [3.50, 4.50],
    ingredients: [
      { squareItemId: 'SEED-SC-ESPRESSO', qtyPerDrink: 0.04 },
    ],
  },
  {
    name: 'Refresher',
    catalogId: 'SIM-DRINK-REFRESHER',
    weight: 0.12,
    priceRange: [5.00, 6.00],
    ingredients: [
      { squareItemId: 'SEED-ODEKO-PUREE-STRAWB', qtyPerDrink: 0.04 },
      { squareItemId: 'SEED-ODEKO-PUREE-MANGO', qtyPerDrink: 0.02 },
    ],
  },
  {
    name: 'Iced Tea',
    catalogId: 'SIM-DRINK-ICEDTEA',
    weight: 0.10,
    priceRange: [3.00, 4.00],
    ingredients: [
      { squareItemId: 'SEED-WM-SYRUP-VANILLA', qtyPerDrink: 0.02 },
    ],
  },
  {
    name: 'Smoothie',
    catalogId: 'SIM-DRINK-SMOOTHIE',
    weight: 0.08,
    priceRange: [6.50, 8.00],
    ingredients: [
      { squareItemId: 'SEED-WM-MILK-WHOLE', qtyPerDrink: 0.06 },
      { squareItemId: 'SEED-ODEKO-PUREE-STRAWB', qtyPerDrink: 0.05 },
    ],
  },
  {
    name: 'Matcha Latte',
    catalogId: 'SIM-DRINK-MATCHA',
    weight: 0.04,
    priceRange: [5.50, 7.00],
    ingredients: [
      { squareItemId: 'SEED-WM-MILK-OAT', qtyPerDrink: 0.08 },
      { squareItemId: 'SEED-ODEKO-MATCHA', qtyPerDrink: 0.15 },  // oz
    ],
  },
  {
    name: 'Chai Latte',
    catalogId: 'SIM-DRINK-CHAI',
    weight: 0.04,
    priceRange: [5.00, 6.50],
    ingredients: [
      { squareItemId: 'SEED-WM-MILK-OAT', qtyPerDrink: 0.06 },
      { squareItemId: 'SEED-ODEKO-CHAI', qtyPerDrink: 0.04 },
    ],
  },
  {
    name: 'Caramel Latte',
    catalogId: 'SIM-DRINK-CARAMEL',
    weight: 0.03,
    priceRange: [5.75, 6.75],
    ingredients: [
      { squareItemId: 'SEED-SC-ESPRESSO', qtyPerDrink: 0.04 },
      { squareItemId: 'SEED-WM-MILK-WHOLE', qtyPerDrink: 0.08 },
      { squareItemId: 'SEED-ODEKO-SYRUP-CARAMEL', qtyPerDrink: 0.02 },
    ],
  },
  {
    name: 'Hazelnut Latte',
    catalogId: 'SIM-DRINK-HAZELNUT',
    weight: 0.02,
    priceRange: [5.75, 6.75],
    ingredients: [
      { squareItemId: 'SEED-SC-ESPRESSO', qtyPerDrink: 0.04 },
      { squareItemId: 'SEED-WM-MILK-WHOLE', qtyPerDrink: 0.08 },
      { squareItemId: 'SEED-ODEKO-SYRUP-HAZELNUT', qtyPerDrink: 0.02 },
    ],
  },
]

// ─── Time Distribution ──────────────────────────────────────────────
interface TimeSlot { startHour: number; endHour: number; weight: number }

const TIME_SLOTS: TimeSlot[] = [
  { startHour: 8, endHour: 10, weight: 0.40 },   // Morning rush
  { startHour: 10, endHour: 11, weight: 0.10 },   // Late morning
  { startHour: 11, endHour: 13, weight: 0.25 },   // Lunch
  { startHour: 13, endHour: 14, weight: 0.05 },   // Early afternoon
  { startHour: 14, endHour: 16, weight: 0.15 },   // Afternoon
  { startHour: 16, endHour: 18, weight: 0.05 },   // Late afternoon
]

// ─── Helpers ────────────────────────────────────────────────────────
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

function pickDrink(rand: () => number): DrinkType {
  const r = rand()
  let cumulative = 0
  for (const drink of DRINK_TYPES) {
    cumulative += drink.weight
    if (r <= cumulative) return drink
  }
  return DRINK_TYPES[0]
}

function pickTime(date: Date, rand: () => number): Date {
  const r = rand()
  let cumulative = 0
  let slot = TIME_SLOTS[0]
  for (const s of TIME_SLOTS) {
    cumulative += s.weight
    if (r <= cumulative) { slot = s; break }
  }
  const hour = slot.startHour + rand() * (slot.endHour - slot.startHour)
  const minute = Math.floor(rand() * 60)
  const d = new Date(date)
  d.setUTCHours(Math.floor(hour), minute, Math.floor(rand() * 60), 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv)

  console.log('☕ Cafe Sales Simulation (MOK-81)')
  console.log(`   Tenant:   ${opts.tenantId}`)
  console.log(`   Period:   ${opts.startDate} to ${opts.endDate}`)
  console.log(`   Location: ${opts.locationId}`)
  console.log(`   Target:   ~80 drinks/day (weekdays), ~50 weekends`)
  console.log(`   Dry run:  ${opts.dryRun}`)
  console.log()

  const db = createSupabaseServiceClient()

  // Load inventory items
  const { data: invItems, error: invErr } = await db
    .from('inventory_items')
    .select('id, square_item_id, current_stock')
    .eq('tenant_id', opts.tenantId)
    .is('deleted_at', null)

  if (invErr) throw new Error(`Failed to fetch inventory: ${invErr.message}`)

  const itemMap = new Map<string, { id: string; stock: number }>()
  for (const row of invItems ?? []) {
    if (row.square_item_id) {
      itemMap.set(row.square_item_id as string, {
        id: row.id as string,
        stock: Number(row.current_stock ?? 0),
      })
    }
  }
  console.log(`📦 Found ${itemMap.size} inventory items`)

  const start = new Date(opts.startDate + 'T00:00:00Z')
  const end = new Date(opts.endDate + 'T23:59:59Z')
  const rand = seededRandom(42)

  // Accumulate fractional ingredient usage; decrement once whole unit consumed
  const fractionalUsage = new Map<string, number>()

  let totalSales = 0
  let totalRevenue = 0
  let totalDecrements = 0
  let totalMovements = 0
  let day = new Date(start)

  while (day <= end) {
    const dayStr = day.toISOString().slice(0, 10)
    const isWeekend = day.getUTCDay() === 0 || day.getUTCDay() === 6
    const dailyTarget = isWeekend ? Math.floor(40 + rand() * 20) : Math.floor(70 + rand() * 20)

    // Plan all sales for the day
    const daySales: Array<{ drink: DrinkType; time: Date; price: number }> = []
    for (let i = 0; i < dailyTarget; i++) {
      const drink = pickDrink(rand)
      const time = pickTime(day, rand)
      const price = Number((drink.priceRange[0] + rand() * (drink.priceRange[1] - drink.priceRange[0])).toFixed(2))
      daySales.push({ drink, time, price })
    }
    daySales.sort((a, b) => a.time.getTime() - b.time.getTime())

    if (!opts.dryRun) {
      // Batch insert sales_transactions for the day
      const txRows = daySales.map((sale, i) => ({
        square_order_id: `SIM-SALE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        tenant_id: opts.tenantId,
        location_id: opts.locationId,
        order_number: `#SIM-${totalSales + i + 1}`,
        tender_total_money: sale.price,
        tender_currency: 'USD',
        tender_type: rand() > 0.3 ? 'CARD' : 'CASH',
        ordered_at: sale.time.toISOString(),
        raw_payload: { simulation: true, drink: sale.drink.name },
      }))

      // Insert in chunks
      const txChunk = 50
      const txIdMap = new Map<number, string>() // index → transaction id
      for (let c = 0; c < txRows.length; c += txChunk) {
        const chunk = txRows.slice(c, c + txChunk)
        const { data: txData, error: txErr } = await db
          .from('sales_transactions')
          .insert(chunk)
          .select('id, square_order_id')

        if (txErr) {
          console.error(`  ❌ Transaction insert failed: ${txErr.message}`)
          continue
        }

        for (const row of txData ?? []) {
          const orderId = row.square_order_id as string
          const idx = txRows.findIndex(t => t.square_order_id === orderId)
          if (idx >= 0) txIdMap.set(idx, row.id as string)
        }
      }

      // Insert sales_transaction_items
      const stiRows = daySales
        .map((sale, i) => {
          const txId = txIdMap.get(i)
          if (!txId) return null
          return {
            transaction_id: txId,
            tenant_id: opts.tenantId,
            square_catalog_object_id: sale.drink.catalogId,
            name: sale.drink.name,
            quantity: 1,
            impact_type: 'auto' as const,
            impact_reason: 'simulated_sale',
            metadata: { simulation: true, price: sale.price },
            created_at: sale.time.toISOString(),
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      const stiChunk = 200
      for (let c = 0; c < stiRows.length; c += stiChunk) {
        const chunk = stiRows.slice(c, c + stiChunk)
        const { error: stiErr } = await db.from('sales_transaction_items').insert(chunk)
        if (stiErr) console.error(`  ❌ STI insert failed: ${stiErr.message}`)
      }

      // Decrement inventory and insert stock_movements
      // Accumulate fractional usage per ingredient, decrement whole units
      for (let i = 0; i < daySales.length; i++) {
        const sale = daySales[i]
        const txId = txIdMap.get(i)

        for (const ing of sale.drink.ingredients) {
          const item = itemMap.get(ing.squareItemId)
          if (!item) continue

          const prevAccum = fractionalUsage.get(ing.squareItemId) ?? 0
          const newAccum = prevAccum + ing.qtyPerDrink
          const wholeUnits = Math.floor(newAccum)

          if (wholeUnits >= 1) {
            fractionalUsage.set(ing.squareItemId, newAccum - wholeUnits)

            // Call decrement_inventory_stock RPC
            const { error: decErr } = await db.rpc('decrement_inventory_stock', {
              item_id: item.id,
              quantity: wholeUnits,
            })
            if (decErr) {
              console.warn(`  ⚠️ Decrement failed (${ing.squareItemId}): ${decErr.message}`)
            }

            // Insert stock_movement
            const prevStock = item.stock
            const newStock = Math.max(0, prevStock - wholeUnits)
            item.stock = newStock

            await db.from('stock_movements').insert({
              inventory_item_id: item.id,
              tenant_id: opts.tenantId,
              movement_type: 'sale',
              quantity_change: -wholeUnits,
              previous_stock: prevStock,
              new_stock: newStock,
              reference_id: txId ?? null,
              notes: `Sale: ${sale.drink.name}`,
              created_at: sale.time.toISOString(),
            })

            totalDecrements += wholeUnits
            totalMovements++
          } else {
            fractionalUsage.set(ing.squareItemId, newAccum)
          }
        }
      }

      totalRevenue += daySales.reduce((s, sale) => s + sale.price, 0)
    }

    // Daily summary log
    const drinkCounts = new Map<string, number>()
    for (const s of daySales) drinkCounts.set(s.drink.name, (drinkCounts.get(s.drink.name) ?? 0) + 1)
    const topDrinks = Array.from(drinkCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
    console.log(
      `  ${dayStr} ${isWeekend ? '(wknd)' : '      '}: ${daySales.length} sales | ` +
        `Top: ${topDrinks.map(([n, c]) => `${n}(${c})`).join(', ')}`,
    )

    totalSales += daySales.length
    day = addDays(day, 1)
  }

  console.log('\n' + '═'.repeat(60))
  console.log(`✅ Sales simulation complete${opts.dryRun ? ' (DRY RUN)' : ''}`)
  console.log(`   Total sales:          ${totalSales}`)
  console.log(`   Total revenue:        $${totalRevenue.toFixed(2)}`)
  console.log(`   Inventory decrements: ${totalDecrements}`)
  console.log(`   Stock movements:      ${totalMovements}`)
  console.log('═'.repeat(60))
}

main().catch((err) => {
  console.error('❌ Sales simulation failed:', err instanceof Error ? err.message : String(err))
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
