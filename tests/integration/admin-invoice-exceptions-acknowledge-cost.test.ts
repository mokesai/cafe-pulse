/**
 * MOK-130 — acknowledging a price_variance exception applies the accepted
 * price to the inventory item.
 *
 * Pre-MOK-130, acknowledge was status-only — `inventory_items.unit_cost`
 * stayed at the old value, and COGS computations downstream used stale
 * costs. Now the acknowledge route also writes the per-individual
 * equivalent (pack-aware, via MOK-133's `effective_unit_price`) to the
 * inventory item plus an `inventory_item_cost_history` audit row.
 *
 * Coverage:
 *  - per-pack mode (uses effective_unit_price, not invoice_unit_price)
 *  - per-unit mode (uses invoice_unit_price)
 *  - legacy exception with no MOK-133 fields (fallback to invoice_unit_price)
 *  - non-price-variance exception types are not touched
 *  - tenant isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as acknowledgePOST } from '@/app/api/admin/invoice-exceptions/[id]/acknowledge/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInventoryItem,
  createInvoice,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

interface PriceVarianceCtx {
  inventory_item_id: string
  inventory_item_name: string
  previous_unit_cost: number
  invoice_unit_price: number
  variance_pct: number
  threshold_pct: number
  po_unit_cost: number | null
  price_mode?: 'per_unit' | 'per_pack'
  pack_size?: number
  comparator_cost?: number
  effective_unit_price?: number
  item_description?: string
}

async function seedPriceVarianceException(
  tenant: TestTenant,
  invoiceId: string,
  context: PriceVarianceCtx,
  severity: 'info' | 'block' = 'info',
  invoiceItemId?: string,
): Promise<string> {
  const svc = getServiceClient()
  const { data, error } = await svc
    .from('invoice_exceptions')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoiceId,
      invoice_item_id: invoiceItemId ?? null,
      exception_type: 'price_variance',
      exception_message: 'Test price variance',
      exception_context: context as unknown as Record<string, unknown>,
      status: 'open',
      pipeline_stage_at_creation: 'matching_items',
      severity,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Failed to seed exception: ${error?.message}`)
  return data.id
}

async function seedInvoiceItem(
  tenant: TestTenant,
  invoiceId: string,
  matchedItemId: string,
  unitPrice: number,
): Promise<string> {
  const svc = getServiceClient()
  const { data, error } = await svc
    .from('invoice_items')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoiceId,
      line_number: 1,
      item_description: 'Test line',
      quantity: 1,
      unit_price: unitPrice,
      total_price: unitPrice,
      matched_item_id: matchedItemId,
      match_method: 'manual',
      match_confidence: 1.0,
      is_reviewed: true,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Failed to seed invoice item: ${error?.message}`)
  return data.id
}

describe('POST /api/admin/invoice-exceptions/[id]/acknowledge — cost application (MOK-130)', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined
  let invoiceIdA: string

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)
    const invoice = await createInvoice(tenantA, { supplier_id: supplier.id })
    invoiceIdA = invoice.id
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it('per-pack mode: writes effective_unit_price to inventory.unit_cost (NOT invoice_unit_price)', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const inventoryItem = await createInventoryItem(tenantA, {
      item_name: 'Croissant 4pk',
      unit_cost: 1.55,
      pack_size: 4,
    })
    const invoiceItemId = await seedInvoiceItem(tenantA, invoiceIdA, inventoryItem.id, 6.19)

    // Real prod scenario from MOK-133: invoice charges $6.19 per pack of 4;
    // per-individual equivalent is $1.5475. effective_unit_price reflects that.
    const exceptionId = await seedPriceVarianceException(
      tenantA,
      invoiceIdA,
      {
        inventory_item_id: inventoryItem.id,
        inventory_item_name: 'Croissant 4pk',
        previous_unit_cost: 1.55,
        invoice_unit_price: 6.19,
        variance_pct: -0.16,
        threshold_pct: 10,
        po_unit_cost: null,
        price_mode: 'per_pack',
        pack_size: 4,
        comparator_cost: 6.2,
        effective_unit_price: 1.5475,
      },
      'info',
      invoiceItemId,
    )

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exceptionId}/acknowledge`,
      body: { notes: 'Pack price accepted' },
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: exceptionId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cost_update?.applied).toBe(true)
    // Helper returns the per-individual price at full precision (4 decimals).
    expect(body.cost_update?.new_unit_cost).toBeCloseTo(1.5475, 4)

    const svc = getServiceClient()
    const { data: inv } = await svc
      .from('inventory_items')
      .select('unit_cost')
      .eq('id', inventoryItem.id)
      .single()
    // MOK-139: inventory_items.unit_cost is now NUMERIC(12,4), so the precise
    // per-individual price ($1.5475) is stored exactly — no rounding.
    expect(Number(inv!.unit_cost)).toBeCloseTo(1.5475, 4)
    // NOT the pack price; would be 6.19 if MOK-130 weren't pack-aware.
    expect(Number(inv!.unit_cost)).toBeLessThan(2)

    // Audit row in cost history. Cost-history's new_unit_cost is unconstrained
    // numeric, so the precise value is preserved.
    const { data: history } = await svc
      .from('inventory_item_cost_history')
      .select('previous_unit_cost, new_unit_cost, source, source_ref, pack_size')
      .eq('tenant_id', tenantA.id)
      .eq('inventory_item_id', inventoryItem.id)
      .order('changed_at', { ascending: false })
      .limit(1)
    expect(history).toHaveLength(1)
    expect(Number(history![0].previous_unit_cost)).toBeCloseTo(1.55, 2)
    expect(Number(history![0].new_unit_cost)).toBeCloseTo(1.5475, 4)
    expect(history![0].source).toBe('acknowledge')
    expect(history![0].source_ref).toBe(invoiceIdA)
    expect(Number(history![0].pack_size)).toBe(4)
  })

  it('per-unit mode: writes invoice_unit_price to inventory.unit_cost', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const inventoryItem = await createInventoryItem(tenantA, {
      item_name: 'Loose Coffee',
      unit_cost: 8.0,
      pack_size: 1,
    })
    const invoiceItemId = await seedInvoiceItem(tenantA, invoiceIdA, inventoryItem.id, 8.5)

    const exceptionId = await seedPriceVarianceException(
      tenantA,
      invoiceIdA,
      {
        inventory_item_id: inventoryItem.id,
        inventory_item_name: 'Loose Coffee',
        previous_unit_cost: 8.0,
        invoice_unit_price: 8.5,
        variance_pct: 6.25,
        threshold_pct: 10,
        po_unit_cost: null,
        price_mode: 'per_unit',
        pack_size: 1,
        comparator_cost: 8.0,
        effective_unit_price: 8.5,
      },
      'info',
      invoiceItemId,
    )

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exceptionId}/acknowledge`,
      body: {},
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: exceptionId }) })
    expect(res.status).toBe(200)

    const svc = getServiceClient()
    const { data: inv } = await svc
      .from('inventory_items')
      .select('unit_cost')
      .eq('id', inventoryItem.id)
      .single()
    expect(Number(inv!.unit_cost)).toBe(8.5)
  })

  it('legacy exception (no MOK-133 fields): falls back to invoice_unit_price', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const inventoryItem = await createInventoryItem(tenantA, {
      item_name: 'Legacy item',
      unit_cost: 2.0,
      pack_size: 1,
    })
    const invoiceItemId = await seedInvoiceItem(tenantA, invoiceIdA, inventoryItem.id, 2.5)

    // Simulate a pre-MOK-133 exception — no price_mode, no effective_unit_price
    const exceptionId = await seedPriceVarianceException(
      tenantA,
      invoiceIdA,
      {
        inventory_item_id: inventoryItem.id,
        inventory_item_name: 'Legacy item',
        previous_unit_cost: 2.0,
        invoice_unit_price: 2.5,
        variance_pct: 25,
        threshold_pct: 10,
        po_unit_cost: null,
      },
      'block',
      invoiceItemId,
    )

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exceptionId}/acknowledge`,
      body: {},
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: exceptionId }) })
    expect(res.status).toBe(200)

    const svc = getServiceClient()
    const { data: inv } = await svc
      .from('inventory_items')
      .select('unit_cost')
      .eq('id', inventoryItem.id)
      .single()
    expect(Number(inv!.unit_cost)).toBe(2.5)
  })

  it('non-price-variance acknowledge does NOT touch inventory cost', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const inventoryItem = await createInventoryItem(tenantA, {
      item_name: 'Stable item',
      unit_cost: 3.0,
    })

    const svc = getServiceClient()
    const { data: exception } = await svc
      .from('invoice_exceptions')
      .insert({
        tenant_id: tenantA.id,
        invoice_id: invoiceIdA,
        exception_type: 'quantity_variance',
        exception_message: 'Test quantity variance',
        exception_context: { inventory_item_id: inventoryItem.id, variance_pct: 5 },
        status: 'open',
        pipeline_stage_at_creation: 'matching_items',
        severity: 'info',
      })
      .select('id')
      .single()

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exception!.id}/acknowledge`,
      body: {},
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: exception!.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    // No cost update for non-price-variance exceptions
    expect(body.cost_update).toBeNull()

    const { data: inv } = await svc
      .from('inventory_items')
      .select('unit_cost')
      .eq('id', inventoryItem.id)
      .single()
    expect(Number(inv!.unit_cost)).toBe(3.0)
  })

  it('cross-tenant: tenant A cannot drive a cost write on tenant B inventory', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplierB = await createSupplier(tenantB)
    const invoiceB = await createInvoice(tenantB, { supplier_id: supplierB.id })
    const inventoryB = await createInventoryItem(tenantB, {
      item_name: 'B item',
      unit_cost: 5.0,
      pack_size: 1,
    })
    const invoiceItemB = await seedInvoiceItem(tenantB, invoiceB.id, inventoryB.id, 6.0)
    const exceptionB = await seedPriceVarianceException(
      tenantB,
      invoiceB.id,
      {
        inventory_item_id: inventoryB.id,
        inventory_item_name: 'B item',
        previous_unit_cost: 5.0,
        invoice_unit_price: 6.0,
        variance_pct: 20,
        threshold_pct: 10,
        po_unit_cost: null,
      },
      'block',
      invoiceItemB,
    )

    // Tenant A tries to acknowledge tenant B's exception
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exceptionB}/acknowledge`,
      body: {},
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: exceptionB }) })
    expect(res.status).toBe(404)

    // Tenant B's inventory cost is untouched
    const svc = getServiceClient()
    const { data: inv } = await svc
      .from('inventory_items')
      .select('unit_cost')
      .eq('id', inventoryB.id)
      .single()
    expect(Number(inv!.unit_cost)).toBe(5.0)
  })
})
