/**
 * C1 / MOK-177 — Seed a realistic ~3-month COGS dataset into a dedicated `cogs-demo` tenant on
 * cafe-pulse-dev, so the COGS dashboards/reports (Cluster B) and the C2 validation pass have
 * real data to work against. Seeds END-STATE data (confirmed invoices + matched lines + variance
 * history + daily COGS summaries) rather than running the live Vision pipeline.
 *
 * Deliberately covers the Cluster-A cases so C2 can verify them:
 *   - A2 (MOK-170): one supplier with two `package_label` products on the same square_item_id.
 *   - A3 (MOK-171): pack rows with non-divisible package_cost (e.g. $5.00 / pack 3).
 *   - A1 (MOK-169): invoice_variance_history rows in both tiers (info + block).
 *   - Pack/single pairs per the pack-pair invariant.
 *
 * Usage:  npm run seed-cogs-demo            (90 days, resets the demo tenant first)
 *         npx tsx scripts/seed-cogs-dataset.ts --days 60 --no-reset
 *
 * Safety: refuses to run unless NEXT_PUBLIC_SUPABASE_URL points at cafe-pulse-dev (pass --force
 * to override). Uses the service-role key (bypasses RLS).
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

config({ path: resolve(process.cwd(), '.env.local') })

const DEV_PROJECT_REF = 'ettmabcwfhidcpapphgm'
const DEMO_SLUG = 'cogs-demo'
const DEMO_ADMIN_EMAIL = 'cogs-demo+admin@cafepulse.test'
const DEMO_ADMIN_PASSWORD = 'CogsDemo!2026'
const PRICE_VARIANCE_THRESHOLD_PCT = 10 // mirrors the tenant default

// ── deterministic PRNG so re-runs produce identical values ───────────────────
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function round(n: number, dp = 2): number {
  return Number(n.toFixed(dp))
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(end: Date, n: number): Date {
  const d = new Date(end)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

// ── data definitions ─────────────────────────────────────────────────────────
interface SupplierDef {
  key: string
  name: string
  code: string
  contact_person: string
  payment_terms: string
}

const SUPPLIERS: SupplierDef[] = [
  { key: 'bakery', name: 'Bluepoint Bakery', code: 'BLU', contact_person: 'Dana Cruz', payment_terms: 'Net 15' },
  { key: 'beverage', name: 'Mile High Distributors', code: 'MHD', contact_person: 'Sam Reyes', payment_terms: 'Net 30' },
  { key: 'produce', name: 'Front Range Produce', code: 'FRP', contact_person: 'Lee Park', payment_terms: 'Net 7' },
  { key: 'supply', name: 'Denver Restaurant Supply', code: 'DRS', contact_person: 'Pat Quinn', payment_terms: 'Net 30' },
]

interface InventoryDef {
  squareId: string
  name: string
  supplier: string
  packSize: number
  /** Either unitCost (per-unit) or packageCost (whole pack) — packageCost is canonical (A3). */
  unitCost?: number
  packageCost?: number
  packageLabel?: string
  itemType: 'ingredient' | 'prepackaged' | 'prepared' | 'supply'
  unitType: string
  stock: number
  /** Supplier-facing rows (orderable on POs/invoices). Single customer-facing rows are not ordered. */
  orderable: boolean
}

const INVENTORY: InventoryDef[] = [
  // Bakery — pack/single pairs; croissant 4pk + muffin 3pk are A3 non-divisible package costs.
  { squareId: 'demo-sq-croissant', name: 'Butter Croissant', supplier: 'bakery', packSize: 1, unitCost: 1.55, itemType: 'prepackaged', unitType: 'each', stock: 40, orderable: false },
  { squareId: 'demo-sq-croissant', name: 'Butter Croissant 4pk', supplier: 'bakery', packSize: 4, packageCost: 6.19, itemType: 'prepackaged', unitType: 'each', stock: 0, orderable: true },
  { squareId: 'demo-sq-muffin', name: 'Blueberry Muffin', supplier: 'bakery', packSize: 1, unitCost: 1.8, itemType: 'prepackaged', unitType: 'each', stock: 24, orderable: false },
  { squareId: 'demo-sq-muffin', name: 'Blueberry Muffin 3pk', supplier: 'bakery', packSize: 3, packageCost: 5.0, itemType: 'prepackaged', unitType: 'each', stock: 0, orderable: true },
  { squareId: 'demo-sq-bagel', name: 'Everything Bagel', supplier: 'bakery', packSize: 1, unitCost: 0.9, itemType: 'prepackaged', unitType: 'each', stock: 36, orderable: false },
  { squareId: 'demo-sq-bagel', name: 'Everything Bagel 6pk', supplier: 'bakery', packSize: 6, packageCost: 4.8, itemType: 'prepackaged', unitType: 'each', stock: 0, orderable: true },

  // Beverages — Coke Zero is the A2 case: two packagings, same supplier + square_item_id + pack_size.
  { squareId: 'demo-sq-cokezero', name: 'Coke Zero 12oz', supplier: 'beverage', packSize: 1, unitCost: 0.85, itemType: 'prepackaged', unitType: 'each', stock: 120, orderable: false },
  { squareId: 'demo-sq-cokezero', name: 'Coke Zero 12oz (Standalone case)', supplier: 'beverage', packSize: 12, packageCost: 9.6, packageLabel: 'Standalone case', itemType: 'prepackaged', unitType: 'each', stock: 0, orderable: true },
  { squareId: 'demo-sq-cokezero', name: 'Coke Zero 12oz (From variety pack)', supplier: 'beverage', packSize: 12, packageCost: 10.2, packageLabel: 'From variety pack', itemType: 'prepackaged', unitType: 'each', stock: 0, orderable: true },
  { squareId: 'demo-sq-sparkling', name: 'Sparkling Water 12oz', supplier: 'beverage', packSize: 1, unitCost: 0.75, itemType: 'prepackaged', unitType: 'each', stock: 96, orderable: false },
  { squareId: 'demo-sq-sparkling', name: 'Sparkling Water 12pk', supplier: 'beverage', packSize: 12, packageCost: 8.4, itemType: 'prepackaged', unitType: 'each', stock: 0, orderable: true },
  { squareId: 'demo-sq-coldbrew', name: 'Cold Brew Concentrate 32oz', supplier: 'beverage', packSize: 1, unitCost: 8.5, itemType: 'ingredient', unitType: 'each', stock: 18, orderable: true },

  // Produce / ingredients
  { squareId: 'demo-sq-milk', name: 'Whole Milk Gallon', supplier: 'produce', packSize: 1, unitCost: 3.2, itemType: 'ingredient', unitType: 'gallon', stock: 20, orderable: true },
  { squareId: 'demo-sq-oatmilk', name: 'Oat Milk 64oz', supplier: 'produce', packSize: 1, unitCost: 4.1, itemType: 'ingredient', unitType: 'each', stock: 24, orderable: true },
  { squareId: 'demo-sq-eggs', name: 'Eggs (dozen)', supplier: 'produce', packSize: 1, unitCost: 2.4, itemType: 'ingredient', unitType: 'each', stock: 30, orderable: true },
  { squareId: 'demo-sq-butter', name: 'Butter 1lb', supplier: 'produce', packSize: 1, unitCost: 3.8, itemType: 'ingredient', unitType: 'lb', stock: 22, orderable: true },
  { squareId: 'demo-sq-beans', name: 'Espresso Beans 5lb', supplier: 'produce', packSize: 1, unitCost: 42.0, itemType: 'ingredient', unitType: 'lb', stock: 12, orderable: true },
  { squareId: 'demo-sq-vanilla', name: 'Vanilla Syrup 750ml', supplier: 'produce', packSize: 1, unitCost: 7.2, itemType: 'ingredient', unitType: 'each', stock: 16, orderable: true },

  // Supplies (packaging)
  { squareId: 'demo-sq-cup12', name: '12oz Cups (sleeve of 50)', supplier: 'supply', packSize: 50, packageCost: 6.5, itemType: 'supply', unitType: 'each', stock: 600, orderable: true },
  { squareId: 'demo-sq-cup16', name: '16oz Cups (sleeve of 50)', supplier: 'supply', packSize: 50, packageCost: 7.5, itemType: 'supply', unitType: 'each', stock: 500, orderable: true },
  { squareId: 'demo-sq-lid', name: 'Cup Lids (sleeve of 100)', supplier: 'supply', packSize: 100, packageCost: 4.0, itemType: 'supply', unitType: 'each', stock: 800, orderable: true },
  { squareId: 'demo-sq-napkin', name: 'Napkins (pack of 500)', supplier: 'supply', packSize: 500, packageCost: 5.0, itemType: 'supply', unitType: 'each', stock: 2000, orderable: true },
  { squareId: 'demo-sq-sleeve', name: 'Coffee Sleeves (pack of 1000)', supplier: 'supply', packSize: 1000, packageCost: 30.0, itemType: 'supply', unitType: 'each', stock: 3000, orderable: true },
]

function derivedCosts(def: InventoryDef): { unitCost: number; packageCost: number } {
  const packSize = Math.max(1, def.packSize)
  if (def.packageCost != null) {
    return { packageCost: round(def.packageCost, 4), unitCost: round(def.packageCost / packSize, 4) }
  }
  const unitCost = def.unitCost ?? 0
  return { unitCost: round(unitCost, 4), packageCost: round(unitCost * packSize, 4) }
}

// ── reset (FK-safe) ──────────────────────────────────────────────────────────
const RESET_ORDER = [
  'invoice_variance_history',
  'invoice_exceptions',
  'invoice_items',
  'invoices',
  'purchase_order_items',
  'purchase_orders',
  'inventory_item_cost_history',
  'inventory_valuations',
  'ai_cogs_daily_summaries',
  'inventory_items',
  'suppliers',
]

export async function resetTenantData(supabase: SupabaseClient, tenantId: string): Promise<void> {
  for (const table of RESET_ORDER) {
    const { error } = await supabase.from(table).delete().eq('tenant_id', tenantId)
    if (error) {
      console.warn(`[reset] ${table}: ${error.message}`)
    }
  }
}

// ── tenant + admin ───────────────────────────────────────────────────────────
async function ensureTenant(supabase: SupabaseClient): Promise<string> {
  const { data: existing } = await supabase.from('tenants').select('id').eq('slug', DEMO_SLUG).maybeSingle()
  if (existing?.id) return existing.id

  const { data, error } = await supabase
    .from('tenants')
    .insert({ slug: DEMO_SLUG, name: 'COGS Demo', business_name: 'Demo Cafe', is_active: true, status: 'active' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Failed to create demo tenant: ${error?.message}`)
  console.log(`✓ Created demo tenant '${DEMO_SLUG}' (${data.id})`)
  return data.id
}

async function ensureAdmin(supabase: SupabaseClient, tenantId: string): Promise<string | null> {
  // Find an existing admin membership for the demo tenant.
  const { data: membership } = await supabase
    .from('tenant_memberships')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  if (membership?.user_id) return membership.user_id

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: DEMO_ADMIN_EMAIL,
    password: DEMO_ADMIN_PASSWORD,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    console.warn(`[admin] could not create demo admin (continuing without created_by): ${createErr?.message}`)
    return null
  }
  await supabase.from('tenant_memberships').insert({ tenant_id: tenantId, user_id: created.user.id, role: 'admin' })
  console.log(`✓ Created demo admin ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`)
  return created.user.id
}

// ── seed: suppliers + inventory ──────────────────────────────────────────────
interface SeededInventory extends InventoryDef {
  id: string
  unitCostFinal: number
  packageCostFinal: number
}

async function seedSuppliers(supabase: SupabaseClient, tenantId: string): Promise<Map<string, string>> {
  const rows = SUPPLIERS.map((s) => ({
    tenant_id: tenantId,
    name: s.name,
    contact_person: s.contact_person,
    email: `${s.code.toLowerCase()}@demo-suppliers.test`,
    payment_terms: s.payment_terms,
    is_active: true,
  }))
  const { data, error } = await supabase.from('suppliers').insert(rows).select('id, name')
  if (error || !data) throw new Error(`Failed to seed suppliers: ${error?.message}`)
  const byName = new Map(data.map((d) => [d.name, d.id]))
  return new Map(SUPPLIERS.map((s) => [s.key, byName.get(s.name)!]))
}

async function seedInventory(
  supabase: SupabaseClient,
  tenantId: string,
  supplierIds: Map<string, string>,
): Promise<SeededInventory[]> {
  const rows = INVENTORY.map((def) => {
    const { unitCost, packageCost } = derivedCosts(def)
    return {
      tenant_id: tenantId,
      square_item_id: def.squareId,
      item_name: def.name,
      current_stock: def.stock,
      minimum_threshold: 5,
      reorder_point: 10,
      unit_cost: unitCost,
      package_cost: packageCost,
      package_label: def.packageLabel ?? null,
      unit_type: def.unitType,
      pack_size: def.packSize,
      is_ingredient: def.itemType === 'ingredient',
      item_type: def.itemType,
      auto_decrement: def.itemType === 'prepackaged',
      supplier_id: supplierIds.get(def.supplier) ?? null,
      location: 'main',
      last_restocked_at: new Date().toISOString(),
    }
  })
  const { data, error } = await supabase.from('inventory_items').insert(rows).select('id, square_item_id, item_name')
  if (error || !data) throw new Error(`Failed to seed inventory: ${error?.message}`)

  return INVENTORY.map((def, i) => {
    const { unitCost, packageCost } = derivedCosts(def)
    return { ...def, id: data[i].id, unitCostFinal: unitCost, packageCostFinal: packageCost }
  })
}

// ── seed: purchase orders + invoices + variance + cost history ───────────────
interface SeedResult {
  suppliers: number
  inventory: number
  purchaseOrders: number
  invoices: number
  invoiceItems: number
  varianceRows: number
  exceptions: number
  dailySummaries: number
}

async function seedPurchasesAndInvoices(
  supabase: SupabaseClient,
  tenantId: string,
  supplierIds: Map<string, string>,
  inventory: SeededInventory[],
  adminId: string | null,
  days: number,
  rng: () => number,
): Promise<{ counts: Omit<SeedResult, 'suppliers' | 'inventory' | 'dailySummaries'>; purchasesByDate: Map<string, { total: number; invoiceIds: string[] }> }> {
  const end = new Date()
  const weeks = Math.max(1, Math.ceil(days / 7))
  const purchasesByDate = new Map<string, { total: number; invoiceIds: string[] }>()

  let poCount = 0
  let invCount = 0
  let lineCount = 0
  let varCount = 0
  let excCount = 0

  for (let w = 0; w < weeks; w++) {
    // Most recent week (w=0) → some invoices still in-progress; older weeks → confirmed/exceptions.
    const orderDate = daysAgo(end, w * 7 + 2)
    for (const supplier of SUPPLIERS) {
      const supplierId = supplierIds.get(supplier.key)!
      const items = inventory.filter((it) => it.supplier === supplier.key && it.orderable)
      if (items.length === 0) continue

      // Guarantee one blocked invoice (with both variance tiers, below) regardless of run length,
      // so the dataset always exercises A1's block path + the dashboard "needs attention" surface.
      const forceBlock = w === 0 && supplier.key === SUPPLIERS[0].key

      // Pick 2–3 items for this PO (deterministic by rng); a forced-block invoice needs ≥2 lines.
      const picked = items.filter(() => rng() > 0.35).slice(0, 3)
      const chosen = picked.length >= (forceBlock ? 2 : 1) ? picked : items.slice(0, Math.min(2, items.length))
      const lineItems = chosen.map((it) => {
        const qty = 2 + Math.floor(rng() * 6)
        return { it, qty }
      })

      // Decide invoice status: recent week may be in-progress; ~15% blocked.
      const roll = rng()
      let status: 'confirmed' | 'pending_exceptions' | 'parsed'
      if (forceBlock) status = 'pending_exceptions'
      else if (w === 0 && roll < 0.4) status = 'parsed'
      else if (roll < 0.15) status = 'pending_exceptions'
      else status = 'confirmed'

      // ── PO ──
      const poNumber = `PO-${supplier.code}-${String(weeks - w).padStart(2, '0')}`
      const poStatus = status === 'confirmed' ? 'confirmed' : status === 'pending_exceptions' ? 'received' : 'sent'
      const poTotal = round(lineItems.reduce((s, { it, qty }) => s + it.packageCostFinal * qty, 0))
      const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .insert({
          tenant_id: tenantId,
          supplier_id: supplierId,
          order_number: poNumber,
          status: poStatus,
          order_date: isoDate(orderDate),
          expected_delivery_date: isoDate(daysAgo(end, w * 7)),
          received_at: poStatus === 'sent' ? null : daysAgo(end, w * 7).toISOString(),
          total_amount: poTotal,
          created_by: adminId,
        })
        .select('id')
        .single()
      if (poErr || !po) throw new Error(`Failed to seed PO ${poNumber}: ${poErr?.message}`)
      poCount++

      await supabase.from('purchase_order_items').insert(
        lineItems.map(({ it, qty }) => ({
          tenant_id: tenantId,
          purchase_order_id: po.id,
          inventory_item_id: it.id,
          quantity_ordered: qty,
          quantity_received: poStatus === 'sent' ? 0 : qty,
          unit_cost: it.packageCostFinal,
        })),
      )

      // ── Invoice ──
      const invDate = isoDate(daysAgo(end, w * 7 + 1))
      const invNumber = `INV-${supplier.code}-${String(weeks - w).padStart(2, '0')}`
      // Build invoice lines with intentional variance tiers.
      const invLines = lineItems.map(({ it, qty }, idx) => {
        const comparator = it.packageCostFinal
        const tierRoll = rng()
        let variancePct = 0
        let severity: 'info' | 'block' | null = null
        if (status === 'pending_exceptions' && idx === 0) {
          variancePct = 12 + rng() * 8 // above threshold
          severity = 'block'
        } else if ((forceBlock && idx === 1) || tierRoll < 0.35) {
          variancePct = 2 + rng() * 6 // sub-threshold
          severity = 'info'
        }
        const unitPrice = round(comparator * (1 + variancePct / 100), 4)
        return { it, qty, idx, comparator, unitPrice, variancePct: round(variancePct, 2), severity }
      })

      const invTotal = round(invLines.reduce((s, l) => s + l.unitPrice * l.qty, 0))
      const confirmedAt = status === 'confirmed' ? daysAgo(end, w * 7).toISOString() : null
      const { data: inv, error: invErr } = await supabase
        .from('invoices')
        .insert({
          tenant_id: tenantId,
          supplier_id: supplierId,
          invoice_number: invNumber,
          invoice_date: invDate,
          status,
          total_amount: invTotal,
          file_name: `${invNumber}.pdf`,
          confirmed_at: confirmedAt,
          pipeline_stage: status === 'parsed' ? 'matching_items' : 'completed',
          pipeline_started_at: daysAgo(end, w * 7 + 1).toISOString(),
          pipeline_completed_at: status === 'parsed' ? null : daysAgo(end, w * 7).toISOString(),
          vision_confidence: 0.9,
          created_by: adminId,
        })
        .select('id')
        .single()
      if (invErr || !inv) throw new Error(`Failed to seed invoice ${invNumber}: ${invErr?.message}`)
      invCount++

      // Invoice items
      const { data: insertedLines, error: liErr } = await supabase
        .from('invoice_items')
        .insert(
          invLines.map((l) => ({
            tenant_id: tenantId,
            invoice_id: inv.id,
            line_number: l.idx + 1,
            item_description: l.it.name,
            quantity: l.qty,
            unit_price: l.unitPrice,
            total_price: round(l.unitPrice * l.qty),
            units_per_package: l.it.packSize,
            matched_item_id: l.it.id,
            match_confidence: 0.95,
            match_method: 'ai',
            is_reviewed: status === 'confirmed',
          })),
        )
        .select('id, line_number')
      if (liErr || !insertedLines) throw new Error(`Failed to seed invoice items for ${invNumber}: ${liErr?.message}`)
      lineCount += insertedLines.length

      // Variance history + exceptions for varying lines
      for (const l of invLines) {
        if (!l.severity) continue
        const lineRow = insertedLines.find((x) => x.line_number === l.idx + 1)
        let exceptionId: string | null = null
        if (l.severity === 'block') {
          const { data: exc } = await supabase
            .from('invoice_exceptions')
            .insert({
              tenant_id: tenantId,
              invoice_id: inv.id,
              invoice_item_id: lineRow?.id ?? null,
              exception_type: 'price_variance',
              exception_message: `Unit price for "${l.it.name}" changed +${l.variancePct}% (exceeds ${PRICE_VARIANCE_THRESHOLD_PCT}% threshold).`,
              exception_context: { comparator_cost: l.comparator, invoice_unit_price: l.unitPrice, variance_pct: l.variancePct },
              pipeline_stage_at_creation: 'matching_items',
              status: 'open',
              severity: 'block',
            })
            .select('id')
            .single()
          exceptionId = exc?.id ?? null
          excCount++
        }
        await supabase.from('invoice_variance_history').insert({
          tenant_id: tenantId,
          invoice_id: inv.id,
          invoice_item_id: lineRow?.id ?? null,
          supplier_id: supplierId,
          variance_type: 'price_variance',
          severity: l.severity,
          po_unit_cost: l.comparator,
          invoice_unit_price: l.unitPrice,
          variance_pct: l.variancePct,
          threshold_pct: PRICE_VARIANCE_THRESHOLD_PCT,
          related_exception_id: exceptionId,
        })
        varCount++
      }

      // Cost-history entries for confirmed invoices (cost moved to invoice price)
      if (status === 'confirmed') {
        await supabase.from('inventory_item_cost_history').insert(
          invLines.map((l) => ({
            tenant_id: tenantId,
            inventory_item_id: l.it.id,
            previous_unit_cost: l.it.unitCostFinal,
            new_unit_cost: round(l.unitPrice / Math.max(1, l.it.packSize), 4),
            pack_size: l.it.packSize,
            source: 'invoice_pipeline',
            source_ref: inv.id,
            changed_by: adminId,
          })),
        )
        const bucket = purchasesByDate.get(invDate) ?? { total: 0, invoiceIds: [] }
        bucket.total += invTotal
        bucket.invoiceIds.push(inv.id)
        purchasesByDate.set(invDate, bucket)
      }
    }
  }

  return {
    counts: { purchaseOrders: poCount, invoices: invCount, invoiceItems: lineCount, varianceRows: varCount, exceptions: excCount },
    purchasesByDate,
  }
}

// ── seed: daily COGS summaries (chained inventory value series) ───────────────
async function seedDailySummaries(
  supabase: SupabaseClient,
  tenantId: string,
  days: number,
  purchasesByDate: Map<string, { total: number; invoiceIds: string[] }>,
  rng: () => number,
): Promise<number> {
  const end = new Date()
  const rows: Array<Record<string, unknown>> = []
  let beginning = 2500 // opening inventory value

  for (let i = days - 1; i >= 0; i--) {
    const date = isoDate(daysAgo(end, i))
    const day = daysAgo(end, i).getUTCDay()
    const isOpen = day >= 1 && day <= 5 // Mon–Fri
    const purchases = purchasesByDate.get(date)
    const purchasesValue = round(purchases?.total ?? 0)
    // Daily COGS ~ food cost on open days; small on weekends.
    const cogs = isOpen ? round(160 + rng() * 140) : round(20 + rng() * 30)
    const ending = round(Math.max(500, beginning + purchasesValue - cogs))
    rows.push({
      tenant_id: tenantId,
      summary_date: date,
      beginning_inventory_value: round(beginning),
      purchases_value: purchasesValue,
      ending_inventory_value: ending,
      periodic_cogs: round(beginning + purchasesValue - ending),
      computation_method: 'periodic',
      contributing_invoice_ids: purchases?.invoiceIds ?? [],
      computed_at: new Date().toISOString(),
    })
    beginning = ending
  }

  const { error } = await supabase
    .from('ai_cogs_daily_summaries')
    .upsert(rows, { onConflict: 'tenant_id,summary_date' })
  if (error) throw new Error(`Failed to seed daily summaries: ${error.message}`)
  return rows.length
}

// ── orchestration (exported for the integration test) ────────────────────────
export interface SeedDemoOptions {
  days?: number
  adminId?: string | null
  seed?: number
}

export async function seedDemoData(
  supabase: SupabaseClient,
  tenantId: string,
  opts: SeedDemoOptions = {},
): Promise<SeedResult> {
  const days = opts.days ?? 90
  const rng = mulberry32(opts.seed ?? 1742)

  const supplierIds = await seedSuppliers(supabase, tenantId)
  const inventory = await seedInventory(supabase, tenantId, supplierIds)
  const { counts, purchasesByDate } = await seedPurchasesAndInvoices(
    supabase,
    tenantId,
    supplierIds,
    inventory,
    opts.adminId ?? null,
    days,
    rng,
  )
  const dailySummaries = await seedDailySummaries(supabase, tenantId, days, purchasesByDate, rng)

  return {
    suppliers: SUPPLIERS.length,
    inventory: inventory.length,
    ...counts,
    dailySummaries,
  }
}

// ── CLI entry point ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const getFlag = (name: string) => args.includes(`--${name}`)
  const getValue = (name: string, fallback: number) => {
    const idx = args.indexOf(`--${name}`)
    return idx >= 0 && args[idx + 1] ? Number(args[idx + 1]) : fallback
  }

  const days = getValue('days', 90)
  const noReset = getFlag('no-reset')
  const force = getFlag('force')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local')
  }
  if (!url.includes(DEV_PROJECT_REF) && !force) {
    throw new Error(
      `Refusing to seed: NEXT_PUBLIC_SUPABASE_URL is not cafe-pulse-dev (${DEV_PROJECT_REF}). ` +
        `Got ${url}. Pass --force to override.`,
    )
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  console.log(`\nSeeding COGS demo dataset (${days} days) into '${DEMO_SLUG}'…`)
  const tenantId = await ensureTenant(supabase)
  const adminId = await ensureAdmin(supabase, tenantId)
  if (!noReset) {
    console.log('Resetting demo tenant data…')
    await resetTenantData(supabase, tenantId)
  }

  const result = await seedDemoData(supabase, tenantId, { days, adminId })

  console.log('\n✅ Seed complete:')
  console.table(result)
  console.log(`\nDemo tenant: slug='${DEMO_SLUG}' id=${tenantId}`)
  console.log(`Demo admin:  ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`)
  console.log('Cluster-A cases seeded: A2 (Coke Zero two package_labels), A3 (Muffin 3pk $5.00/3), A1 (info+block variances).\n')
}

// Only run when invoked directly (so the integration test can import seedDemoData).
if (process.argv[1] && process.argv[1].includes('seed-cogs-dataset')) {
  main().catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
}
