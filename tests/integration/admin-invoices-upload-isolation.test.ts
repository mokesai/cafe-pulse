import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/lib/supabase/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/server')>(
    '@/lib/supabase/server',
  )
  const storageStub = {
    from: () => ({
      upload: async () => ({ data: { path: 'test/mock-upload' }, error: null }),
      createSignedUrl: async () => ({
        data: { signedUrl: 'https://mock.invoices/signed-url' },
        error: null,
      }),
      remove: async () => ({ data: null, error: null }),
    }),
  }
  return {
    ...actual,
    createServiceClient: () => {
      const client = actual.createServiceClient() as unknown as { storage: unknown }
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === 'storage') return storageStub
          return Reflect.get(target, prop, receiver)
        },
      })
    },
  }
})

import { POST as uploadPOST } from '@/app/api/admin/invoices/upload/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInventoryItem,
  createPurchaseOrder,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001'

function makePdfFormData(opts: {
  supplier_id: string
  invoice_number: string
  invoice_date?: string
  purchase_order_id?: string
}): FormData {
  const fd = new FormData()
  const pdfBlob = new Blob(['%PDF-1.4\n1 0 obj\n<<\n>>\nendobj\n'], {
    type: 'application/pdf',
  })
  fd.append('file', pdfBlob, 'test-invoice.pdf')
  fd.append('supplier_id', opts.supplier_id)
  fd.append('invoice_number', opts.invoice_number)
  fd.append('invoice_date', opts.invoice_date ?? new Date().toISOString().slice(0, 10))
  if (opts.purchase_order_id) {
    fd.append('purchase_order_id', opts.purchase_order_id)
  }
  return fd
}

/**
 * Create a complete PO context for upload tests: supplier + inventory item + PO.
 * MOK-120 requires every invoice upload to pass a valid purchase_order_id.
 */
async function createPOForUpload(tenant: TestTenant) {
  const supplier = await createSupplier(tenant)
  const inventoryItem = await createInventoryItem(tenant)
  const po = await createPurchaseOrder(tenant, {
    supplier_id: supplier.id,
    inventory_item_id: inventoryItem.id,
  })
  return { supplier, inventoryItem, po }
}

describe('admin invoices/upload — tenant isolation', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it('INSERT path: creates a new invoice under the calling tenant only', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenantA)
    const invoiceNumber = `UPLOAD-INS-${Date.now()}`

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: invoiceNumber,
        purchase_order_id: po.id,
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    const invoiceId: string = json.data.id

    const svc = getServiceClient()
    const { data: inv } = await svc
      .from('invoices')
      .select('tenant_id, supplier_id, status')
      .eq('id', invoiceId)
      .single()
    expect(inv!.tenant_id).toBe(tenantA.id)
    expect(inv!.tenant_id).not.toBe(tenantB.id)
    expect(inv!.tenant_id).not.toBe(DEFAULT_TENANT)
    expect(inv!.status).toBe('uploaded')

    const { count: countB } = await svc
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantB.id)
      .eq('invoice_number', invoiceNumber)
    expect(countB).toBe(0)
  })

  it('Re-upload (MOK-109): replaces prior invoice with a fresh row, leaves exactly one row under the calling tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenantA)
    const invoiceNumber = `UPLOAD-UPD-${Date.now()}`

    // First upload — creates the invoice
    const firstReq = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: invoiceNumber,
        purchase_order_id: po.id,
      }),
    })
    const firstRes = await uploadPOST(firstReq)
    expect(firstRes.status).toBe(201)
    const firstId: string = (await firstRes.json()).data.id

    // Second upload of same (tenant, supplier, invoice_number) — DELETEs the prior
    // row and INSERTs a fresh one. The new row gets a NEW id (post-MOK-109 behavior).
    const secondReq = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: invoiceNumber,
        purchase_order_id: po.id,
      }),
    })
    const secondRes = await uploadPOST(secondReq)
    expect(secondRes.status).toBe(201)
    const secondId: string = (await secondRes.json()).data.id
    expect(secondId).not.toBe(firstId)

    const svc = getServiceClient()

    // Old id is gone (cascaded with the prior invoice row)
    const { data: oldRow } = await svc
      .from('invoices')
      .select('id')
      .eq('id', firstId)
      .maybeSingle()
    expect(oldRow).toBeNull()

    // Exactly one current row under tenant A with the new id
    const { data: rows } = await svc
      .from('invoices')
      .select('id, tenant_id, status')
      .eq('tenant_id', tenantA.id)
      .eq('supplier_id', supplier.id)
      .eq('invoice_number', invoiceNumber)
    expect(rows).toHaveLength(1)
    expect(rows![0].id).toBe(secondId)
    expect(rows![0].tenant_id).toBe(tenantA.id)
    expect(rows![0].tenant_id).not.toBe(tenantB.id)
    expect(rows![0].tenant_id).not.toBe(DEFAULT_TENANT)
  })

  it('tenant B uploading the same invoice_number + supplier_id as tenant A creates a separate row under B', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const { supplier: supplierA, po: poA } = await createPOForUpload(tenantA)
    const { supplier: supplierB, po: poB } = await createPOForUpload(tenantB)
    const invoiceNumber = `UPLOAD-X-${Date.now()}`

    // A uploads first
    const reqA = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplierA.id,
        invoice_number: invoiceNumber,
        purchase_order_id: poA.id,
      }),
    })
    const resA = await uploadPOST(reqA)
    expect(resA.status).toBe(201)
    const idA: string = (await resA.json()).data.id

    // B uploads same invoice_number (but different supplier_id within B)
    const reqB = buildAuthedRequest({
      tenant: tenantB,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplierB.id,
        invoice_number: invoiceNumber,
        purchase_order_id: poB.id,
      }),
    })
    const resB = await uploadPOST(reqB)
    expect(resB.status).toBe(201)
    const idB: string = (await resB.json()).data.id
    expect(idB).not.toBe(idA)

    const svc = getServiceClient()
    const { data: inA } = await svc
      .from('invoices')
      .select('tenant_id')
      .eq('id', idA)
      .single()
    const { data: inB } = await svc
      .from('invoices')
      .select('tenant_id')
      .eq('id', idB)
      .single()
    expect(inA!.tenant_id).toBe(tenantA.id)
    expect(inB!.tenant_id).toBe(tenantB.id)
  })
})

// ─── MOK-120: PO is required at upload time ──────────────────────────────────

describe('admin invoices/upload — MOK-120 PO requirement', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it('rejects upload without purchase_order_id (400 PURCHASE_ORDER_REQUIRED)', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `NO-PO-${Date.now()}`,
        // purchase_order_id intentionally omitted
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('PURCHASE_ORDER_REQUIRED')
  })

  it('rejects upload when purchase_order_id does not exist (404)', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `BAD-PO-${Date.now()}`,
        purchase_order_id: '00000000-0000-0000-0000-000000000000',
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.code).toBe('PURCHASE_ORDER_NOT_FOUND')
  })

  it('rejects upload when purchase_order_id belongs to a different tenant (404 — invisible across tenants)', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const { po: poB } = await createPOForUpload(tenantB)
    const supplierA = await createSupplier(tenantA)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplierA.id,
        invoice_number: `XTENANT-PO-${Date.now()}`,
        purchase_order_id: poB.id, // belongs to tenant B
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.code).toBe('PURCHASE_ORDER_NOT_FOUND')
  })

  it('rejects upload when invoice supplier does not match PO supplier (400 SUPPLIER_MISMATCH)', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const { po } = await createPOForUpload(tenantA) // PO is for one supplier
    const otherSupplier = await createSupplier(tenantA) // unrelated supplier

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: otherSupplier.id, // DIFFERENT from po.supplier_id
        invoice_number: `MISMATCH-${Date.now()}`,
        purchase_order_id: po.id,
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('SUPPLIER_MISMATCH')
  })

  it('successful upload creates the order_invoice_matches link atomically', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenantA)
    const invoiceNumber = `LINK-${Date.now()}`

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: invoiceNumber,
        purchase_order_id: po.id,
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(201)
    const invoiceId: string = (await res.json()).data.id

    // The link should exist immediately (atomic with the invoice INSERT).
    const svc = getServiceClient()
    const { data: link } = await svc
      .from('order_invoice_matches')
      .select('id, invoice_id, purchase_order_id, match_method, match_confidence, status')
      .eq('invoice_id', invoiceId)
      .eq('tenant_id', tenantA.id)
      .single()

    expect(link).not.toBeNull()
    expect(link!.purchase_order_id).toBe(po.id)
    expect(link!.match_method).toBe('manual')
    expect(Number(link!.match_confidence)).toBe(1)
    expect(link!.status).toBe('pending')
  })
})
