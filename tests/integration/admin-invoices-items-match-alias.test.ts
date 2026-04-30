/**
 * MOK-135 — PUT /api/admin/invoices/items/[itemId]/match writes a manual
 * supplier_item_alias on every successful re-match.
 *
 * Pre-MOK-135 the route updated `invoice_items.matched_item_id` only — manual
 * re-matches did not teach the pipeline. The next invoice from the same
 * supplier with the same description would mis-match all over again. Now the
 * route upserts a `supplier_item_aliases` row with `source='manual'`. Manual
 * aliases are sticky — pipeline auto-aliases never overwrite them — so future
 * invoices alias-match correctly.
 *
 * Coverage:
 *  - first-time match writes a new alias
 *  - second match for the same (supplier, description) updates the inventory
 *    pointer in the existing alias row (idempotent upsert)
 *  - cross-tenant 404 + no alias leak
 *  - missing supplier_id on parent invoice → no alias write but match still
 *    succeeds (defensive)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PUT as matchPUT } from '@/app/api/admin/invoices/items/[itemId]/match/route'

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

async function seedInvoiceItem(
  tenant: TestTenant,
  invoiceId: string,
  description: string,
): Promise<string> {
  const svc = getServiceClient()
  const { data, error } = await svc
    .from('invoice_items')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoiceId,
      line_number: 1,
      item_description: description,
      quantity: 1,
      unit_price: 5.0,
      total_price: 5.0,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Failed to seed invoice item: ${error?.message}`)
  return data.id
}

describe('PUT /api/admin/invoices/items/[itemId]/match — alias write-through (MOK-135)', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it('first-time manual match writes a new supplier_item_alias with source=manual', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)
    const invoice = await createInvoice(tenantA, { supplier_id: supplier.id })
    const inventory = await createInventoryItem(tenantA, { item_name: 'Croissant 4pk' })
    const description = `Butter Croissant ${Date.now()}`
    const invoiceItemId = await seedInvoiceItem(tenantA, invoice.id, description)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'PUT',
      url: `/api/admin/invoices/items/${invoiceItemId}/match`,
      body: { matched_item_id: inventory.id },
    })
    const res = await matchPUT(req, { params: Promise.resolve({ itemId: invoiceItemId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.alias?.upserted).toBe(true)

    const svc = getServiceClient()
    const { data: aliases } = await svc
      .from('supplier_item_aliases')
      .select('supplier_id, supplier_description, inventory_item_id, source, confidence')
      .eq('tenant_id', tenantA.id)
      .eq('supplier_id', supplier.id)
      .eq('supplier_description', description)
    expect(aliases).toHaveLength(1)
    expect(aliases![0].inventory_item_id).toBe(inventory.id)
    expect(aliases![0].source).toBe('manual')
    expect(Number(aliases![0].confidence)).toBe(1.0)
  })

  it('repeated manual match updates the same alias row (idempotent upsert)', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)
    const invoice = await createInvoice(tenantA, { supplier_id: supplier.id })
    const wrongInventory = await createInventoryItem(tenantA, { item_name: 'Wrong row' })
    const rightInventory = await createInventoryItem(tenantA, { item_name: 'Right row' })
    const description = `Brand X muffin ${Date.now()}`
    const invoiceItemId = await seedInvoiceItem(tenantA, invoice.id, description)

    // First match — points at the wrong row
    const req1 = buildAuthedRequest({
      tenant: tenantA,
      method: 'PUT',
      url: `/api/admin/invoices/items/${invoiceItemId}/match`,
      body: { matched_item_id: wrongInventory.id },
    })
    await matchPUT(req1, { params: Promise.resolve({ itemId: invoiceItemId }) })

    // Second match — corrects to the right row
    const req2 = buildAuthedRequest({
      tenant: tenantA,
      method: 'PUT',
      url: `/api/admin/invoices/items/${invoiceItemId}/match`,
      body: { matched_item_id: rightInventory.id },
    })
    const res2 = await matchPUT(req2, { params: Promise.resolve({ itemId: invoiceItemId }) })
    expect(res2.status).toBe(200)

    // One alias row, pointing at the right inventory now
    const svc = getServiceClient()
    const { data: aliases } = await svc
      .from('supplier_item_aliases')
      .select('inventory_item_id, source')
      .eq('tenant_id', tenantA.id)
      .eq('supplier_id', supplier.id)
      .eq('supplier_description', description)
    expect(aliases).toHaveLength(1)
    expect(aliases![0].inventory_item_id).toBe(rightInventory.id)
    expect(aliases![0].source).toBe('manual')
  })

  it('cross-tenant: tenant A cannot match tenant B invoice items, and no alias leaks', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplierB = await createSupplier(tenantB)
    const invoiceB = await createInvoice(tenantB, { supplier_id: supplierB.id })
    const inventoryA = await createInventoryItem(tenantA, { item_name: 'A inventory' })
    const description = `Tenant B line ${Date.now()}`
    const invoiceItemB = await seedInvoiceItem(tenantB, invoiceB.id, description)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'PUT',
      url: `/api/admin/invoices/items/${invoiceItemB}/match`,
      body: { matched_item_id: inventoryA.id },
    })
    const res = await matchPUT(req, { params: Promise.resolve({ itemId: invoiceItemB }) })
    expect(res.status).toBe(404)

    const svc = getServiceClient()
    // No alias on tenant B (route bailed before alias write)
    const { data: aliasesB } = await svc
      .from('supplier_item_aliases')
      .select('id')
      .eq('tenant_id', tenantB.id)
      .eq('supplier_id', supplierB.id)
      .eq('supplier_description', description)
    expect(aliasesB ?? []).toHaveLength(0)
    // Also no alias on tenant A (the route never got to that step)
    const { data: aliasesA } = await svc
      .from('supplier_item_aliases')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('supplier_description', description)
    expect(aliasesA ?? []).toHaveLength(0)
  })

  it('invoice with no supplier_id: match still succeeds, alias write skipped', async () => {
    if (!tenantA) throw new Error('test setup failed')
    // Create an invoice without a supplier — uncommon post-MOK-120, but possible
    // in legacy data. The match route should still update matched_item_id and
    // not crash; alias write skips.
    const svc = getServiceClient()
    const { data: invoice } = await svc
      .from('invoices')
      .insert({
        tenant_id: tenantA.id,
        invoice_number: `NO-SUPP-${Date.now()}`,
        invoice_date: new Date().toISOString().slice(0, 10),
        status: 'parsed',
        total_amount: 10.0,
      })
      .select('id')
      .single()

    const inventory = await createInventoryItem(tenantA, { item_name: 'Solo item' })
    const invoiceItemId = await seedInvoiceItem(tenantA, invoice!.id, 'Solo line desc')

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'PUT',
      url: `/api/admin/invoices/items/${invoiceItemId}/match`,
      body: { matched_item_id: inventory.id },
    })
    const res = await matchPUT(req, { params: Promise.resolve({ itemId: invoiceItemId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alias?.upserted).toBe(false)

    // matched_item_id was still set
    const { data: line } = await svc
      .from('invoice_items')
      .select('matched_item_id')
      .eq('id', invoiceItemId)
      .single()
    expect(line!.matched_item_id).toBe(inventory.id)
  })
})
