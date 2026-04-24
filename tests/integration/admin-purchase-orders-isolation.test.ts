import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async () => ({ data: { id: 'test-email-id' }, error: null }),
    }
  },
}))

import { POST as posPOST } from '@/app/api/admin/purchase-orders/route'
import {
  PATCH as posPATCH,
  PUT as posPUT,
} from '@/app/api/admin/purchase-orders/[orderId]/route'
import { POST as posInvoicesPOST } from '@/app/api/admin/purchase-orders/[orderId]/invoices/route'
import { POST as posSendPOST } from '@/app/api/admin/purchase-orders/[orderId]/send/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInventoryItem,
  createInvoice,
  createPurchaseOrder,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001'

describe('admin purchase-orders — tenant isolation', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
    // Ensure Resend env gate in /send route passes before the mocked Resend client takes over
    process.env.RESEND_API_KEY ??= 'test-resend-key'
  })

  afterAll(async () => {
    await cleanupTenant(tenantA)
    await cleanupTenant(tenantB)
  })

  it('POST /api/admin/purchase-orders creates PO + items + status_history under the calling tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)
    const item = await createInventoryItem(tenantA)
    const orderNumber = `PO-POST-${Date.now()}`

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/purchase-orders',
      body: {
        supplier_id: supplier.id,
        order_number: orderNumber,
        items: [
          { inventory_item_id: item.id, quantity_ordered: 5, unit_cost: 2.5 },
        ],
      },
    })
    const res = await posPOST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    const poId: string = json.order.id

    const svc = getServiceClient()
    const { data: po } = await svc
      .from('purchase_orders')
      .select('tenant_id')
      .eq('id', poId)
      .single()
    expect(po!.tenant_id).toBe(tenantA.id)

    const { data: items } = await svc
      .from('purchase_order_items')
      .select('tenant_id')
      .eq('purchase_order_id', poId)
    expect(items).toHaveLength(1)
    expect(items![0].tenant_id).toBe(tenantA.id)

    const { data: history } = await svc
      .from('purchase_order_status_history')
      .select('tenant_id, new_status')
      .eq('purchase_order_id', poId)
    expect(history).toHaveLength(1)
    expect(history![0].tenant_id).toBe(tenantA.id)
    expect(history![0].tenant_id).not.toBe(tenantB.id)
    expect(history![0].tenant_id).not.toBe(DEFAULT_TENANT)
  })

  it('PATCH /api/admin/purchase-orders/[id] writes a tenant-scoped status_history on status transition', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)
    const item = await createInventoryItem(tenantA)
    const po = await createPurchaseOrder(tenantA, {
      supplier_id: supplier.id,
      inventory_item_id: item.id,
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'PATCH',
      url: `/api/admin/purchase-orders/${po.id}`,
      body: { status: 'approved', status_note: 'approved in test' },
    })
    const res = await posPATCH(req, { params: Promise.resolve({ orderId: po.id }) })
    expect(res.status).toBe(200)

    const svc = getServiceClient()
    const { data: history } = await svc
      .from('purchase_order_status_history')
      .select('tenant_id, new_status')
      .eq('purchase_order_id', po.id)
      .order('changed_at', { ascending: false })
      .limit(1)
    expect(history).toHaveLength(1)
    expect(history![0].new_status).toBe('approved')
    expect(history![0].tenant_id).toBe(tenantA.id)
    expect(history![0].tenant_id).not.toBe(DEFAULT_TENANT)
  })

  it('PUT /api/admin/purchase-orders/[id] re-scopes replaced items + status_history to the calling tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)
    const item = await createInventoryItem(tenantA)
    const item2 = await createInventoryItem(tenantA, { item_name: 'Item 2' })
    const po = await createPurchaseOrder(tenantA, {
      supplier_id: supplier.id,
      inventory_item_id: item.id,
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'PUT',
      url: `/api/admin/purchase-orders/${po.id}`,
      body: {
        supplier_id: supplier.id,
        order_number: `${po.order_number}-upd`,
        status: 'approved',
        status_note: 'full replacement',
        items: [
          { inventory_item_id: item2.id, quantity_ordered: 3, unit_cost: 4 },
        ],
      },
    })
    const res = await posPUT(req, { params: Promise.resolve({ orderId: po.id }) })
    expect(res.status).toBe(200)

    const svc = getServiceClient()
    const { data: items } = await svc
      .from('purchase_order_items')
      .select('tenant_id, inventory_item_id')
      .eq('purchase_order_id', po.id)
    expect(items).toHaveLength(1)
    expect(items![0].inventory_item_id).toBe(item2.id)
    expect(items![0].tenant_id).toBe(tenantA.id)

    const { data: history } = await svc
      .from('purchase_order_status_history')
      .select('tenant_id, new_status')
      .eq('purchase_order_id', po.id)
    expect(history!.length).toBeGreaterThanOrEqual(1)
    for (const h of history!) {
      expect(h.tenant_id).toBe(tenantA.id)
      expect(h.tenant_id).not.toBe(tenantB.id)
      expect(h.tenant_id).not.toBe(DEFAULT_TENANT)
    }
  })

  it('POST /api/admin/purchase-orders/[id]/invoices writes an order_invoice_matches row tagged with the calling tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)
    const item = await createInventoryItem(tenantA)
    const po = await createPurchaseOrder(tenantA, {
      supplier_id: supplier.id,
      inventory_item_id: item.id,
    })
    const invoice = await createInvoice(tenantA, { supplier_id: supplier.id })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/purchase-orders/${po.id}/invoices`,
      body: { invoice_id: invoice.id },
    })
    const res = await posInvoicesPOST(req, { params: Promise.resolve({ orderId: po.id }) })
    expect(res.status).toBe(201)

    const svc = getServiceClient()
    const { data: matches } = await svc
      .from('order_invoice_matches')
      .select('tenant_id, purchase_order_id, invoice_id')
      .eq('purchase_order_id', po.id)
    expect(matches).toHaveLength(1)
    expect(matches![0].invoice_id).toBe(invoice.id)
    expect(matches![0].tenant_id).toBe(tenantA.id)
    expect(matches![0].tenant_id).not.toBe(tenantB.id)
    expect(matches![0].tenant_id).not.toBe(DEFAULT_TENANT)
  })

  it('POST /api/admin/purchase-orders/[id]/send writes a tenant-scoped status_history row', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA, { email: 'po-send@cafepulse.test' })
    const item = await createInventoryItem(tenantA)
    const po = await createPurchaseOrder(tenantA, {
      supplier_id: supplier.id,
      inventory_item_id: item.id,
      status: 'approved',
    })

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/purchase-orders/${po.id}/send`,
      body: { to: 'po-send@cafepulse.test' },
    })
    const res = await posSendPOST(req, { params: Promise.resolve({ orderId: po.id }) })
    expect(res.status).toBe(200)

    const svc = getServiceClient()
    const { data: history } = await svc
      .from('purchase_order_status_history')
      .select('tenant_id, new_status')
      .eq('purchase_order_id', po.id)
      .order('changed_at', { ascending: false })
    expect(history!.length).toBeGreaterThanOrEqual(1)
    for (const h of history!) {
      expect(h.tenant_id).toBe(tenantA.id)
      expect(h.tenant_id).not.toBe(tenantB.id)
      expect(h.tenant_id).not.toBe(DEFAULT_TENANT)
    }
  })
})
