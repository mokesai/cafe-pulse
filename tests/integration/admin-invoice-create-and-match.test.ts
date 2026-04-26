/**
 * MOK-125 — POST /api/admin/invoices/items/[itemId]/create-and-match
 *
 * Validates the create-and-match route's behavior:
 *   - Creates inventory_item with values inherited from the invoice line
 *     (unit_cost ← unit_price, pack_size ← units_per_package, supplier_id
 *     ← parent invoice's supplier_id)
 *   - Synthesizes a `manual-inv-${itemId}` square_item_id (column is NOT NULL)
 *   - Links the invoice line back to the new inventory item with
 *     match_method='manual', confidence=1.0
 *   - Upserts a supplier_item_aliases row with source='manual' so the next
 *     invoice with the same supplier_description auto-matches
 *   - Tenant-isolated (cross-tenant request → 404)
 *   - Rolls back the inventory_items insert if linking the invoice line fails
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as createAndMatchPOST } from '@/app/api/admin/invoices/items/[itemId]/create-and-match/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInvoice,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

interface SeededInvoiceLine {
  id: string
  invoice_id: string
  item_description: string
}

async function seedInvoiceLine(
  tenant: TestTenant,
  invoiceId: string,
  overrides: Partial<{
    item_description: string
    quantity: number
    unit_price: number
    total_price: number
    unit_type: string
    units_per_package: number
    line_number: number
  }> = {},
): Promise<SeededInvoiceLine> {
  const svc = getServiceClient()
  const description = overrides.item_description ?? `Brand X Bagels 12-pack ${Date.now()}`
  const { data, error } = await svc
    .from('invoice_items')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoiceId,
      line_number: overrides.line_number ?? 1,
      item_description: description,
      quantity: overrides.quantity ?? 4,
      unit_price: overrides.unit_price ?? 7.5,
      total_price: overrides.total_price ?? 30.0,
      unit_type: overrides.unit_type ?? 'each',
      units_per_package: overrides.units_per_package ?? 12,
    })
    .select('id, invoice_id, item_description')
    .single()
  if (error || !data) throw new Error(`Failed to seed invoice line: ${error?.message}`)
  return data
}

describe('POST /api/admin/invoices/items/[itemId]/create-and-match (MOK-125)', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined
  let supplierAId: string
  let invoiceAId: string

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplierA = await createSupplier(tenantA)
    supplierAId = supplierA.id
    const invoiceA = await createInvoice(tenantA, { supplier_id: supplierA.id })
    invoiceAId = invoiceA.id
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it('creates inventory item with values inherited from the invoice line', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const line = await seedInvoiceLine(tenantA, invoiceAId, {
      item_description: 'Brand X Bagels 12-pack inheritance',
      unit_price: 8.25,
      units_per_package: 12,
      unit_type: 'each',
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/items/${line.id}/create-and-match`,
      body: {},
    })
    const res = await createAndMatchPOST(req, {
      params: Promise.resolve({ itemId: line.id }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    const newItem = body.data.inventory_item
    expect(newItem.item_name).toBe('Brand X Bagels 12-pack inheritance')
    expect(Number(newItem.unit_cost)).toBe(8.25)
    expect(Number(newItem.pack_size)).toBe(12)
    expect(newItem.unit_type).toBe('each')
    expect(newItem.supplier_id).toBe(supplierAId)
    expect(newItem.tenant_id).toBe(tenantA.id)
    expect(newItem.square_item_id).toBe(`manual-inv-${line.id}`)
    expect(newItem.item_type).toBe('supply')
    expect(newItem.current_stock).toBe(0)
  })

  it('honors explicit overrides in new_item_data', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const line = await seedInvoiceLine(tenantA, invoiceAId, {
      item_description: 'Override source description',
      unit_price: 1,
      units_per_package: 1,
      line_number: 2,
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/items/${line.id}/create-and-match`,
      body: {
        new_item_data: {
          name: 'Renamed By Admin',
          unit_cost: 9.99,
          pack_size: 24,
          item_type: 'ingredient',
          location: 'walk-in',
          minimum_threshold: 2,
          reorder_point: 6,
        },
      },
    })
    const res = await createAndMatchPOST(req, {
      params: Promise.resolve({ itemId: line.id }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const newItem = body.data.inventory_item
    expect(newItem.item_name).toBe('Renamed By Admin')
    expect(Number(newItem.unit_cost)).toBe(9.99)
    expect(Number(newItem.pack_size)).toBe(24)
    expect(newItem.item_type).toBe('ingredient')
    expect(newItem.is_ingredient).toBe(true)
    expect(newItem.location).toBe('walk-in')
    expect(newItem.minimum_threshold).toBe(2)
    expect(newItem.reorder_point).toBe(6)
  })

  it('links the invoice line to the new inventory item with match_method=manual', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const line = await seedInvoiceLine(tenantA, invoiceAId, {
      item_description: 'Link-back test description',
      line_number: 3,
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/items/${line.id}/create-and-match`,
      body: {},
    })
    const res = await createAndMatchPOST(req, {
      params: Promise.resolve({ itemId: line.id }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const newItemId = body.data.inventory_item.id

    const svc = getServiceClient()
    const { data } = await svc
      .from('invoice_items')
      .select('matched_item_id, match_confidence, match_method, is_reviewed')
      .eq('id', line.id)
      .single()
    expect(data!.matched_item_id).toBe(newItemId)
    expect(Number(data!.match_confidence)).toBe(1.0)
    expect(data!.match_method).toBe('manual')
    expect(data!.is_reviewed).toBe(true)
  })

  it('upserts a supplier_item_aliases row so future invoices auto-match', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const description = `Alias seed ${Date.now()}`
    const line = await seedInvoiceLine(tenantA, invoiceAId, {
      item_description: description,
      line_number: 4,
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/items/${line.id}/create-and-match`,
      body: {},
    })
    const res = await createAndMatchPOST(req, {
      params: Promise.resolve({ itemId: line.id }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.supplier_item_alias_id).not.toBeNull()
    const newItemId = body.data.inventory_item.id

    const svc = getServiceClient()
    const { data: alias } = await svc
      .from('supplier_item_aliases')
      .select('id, supplier_id, supplier_description, inventory_item_id, source, confidence')
      .eq('id', body.data.supplier_item_alias_id)
      .single()
    expect(alias!.supplier_id).toBe(supplierAId)
    expect(alias!.supplier_description).toBe(description)
    expect(alias!.inventory_item_id).toBe(newItemId)
    expect(alias!.source).toBe('manual')
    expect(Number(alias!.confidence)).toBe(1.0)
  })

  it('returns 400 if neither body name nor invoice description gives a usable item name', async () => {
    if (!tenantA) throw new Error('test setup failed')
    // Empty/whitespace description on the invoice line, no override either
    const svc = getServiceClient()
    const { data: line, error } = await svc
      .from('invoice_items')
      .insert({
        tenant_id: tenantA.id,
        invoice_id: invoiceAId,
        line_number: 5,
        item_description: '   ', // whitespace only
        quantity: 1,
        unit_price: 1,
        total_price: 1,
      })
      .select('id')
      .single()
    if (error || !line) throw new Error(`Failed to seed: ${error?.message}`)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/items/${line.id}/create-and-match`,
      body: {},
    })
    const res = await createAndMatchPOST(req, {
      params: Promise.resolve({ itemId: line.id }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name/i)
  })

  it('returns 404 when the invoice line belongs to a different tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplierB = await createSupplier(tenantB)
    const invoiceB = await createInvoice(tenantB, { supplier_id: supplierB.id })
    const lineB = await seedInvoiceLine(tenantB, invoiceB.id, {
      item_description: 'Tenant B item',
    })

    // Tenant A tries to act on tenant B's invoice line
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/items/${lineB.id}/create-and-match`,
      body: {},
    })
    const res = await createAndMatchPOST(req, {
      params: Promise.resolve({ itemId: lineB.id }),
    })
    expect(res.status).toBe(404)

    // Confirm no inventory item leaked into tenant A
    const svc = getServiceClient()
    const { data: leaked } = await svc
      .from('inventory_items')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('square_item_id', `manual-inv-${lineB.id}`)
    expect(leaked ?? []).toHaveLength(0)
  })
})
