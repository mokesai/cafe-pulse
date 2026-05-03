/**
 * MOK-115 — re-upload via the PO modal must find the prior invoice via the
 * PO link, not via (supplier_id, invoice_number).
 *
 * The PO modal auto-fills invoice_number = `${PO_number}-${count+1}` (a
 * placeholder). Stage 1 extraction then overwrites the row's invoice_number
 * with the real one from the PDF. A subsequent re-upload sends the same
 * placeholder, but the prior row no longer has that number — so the legacy
 * `(supplier_id, invoice_number)` lookup misses, a duplicate row is
 * inserted, stage 1 fails on the unique constraint, and the row sits
 * silently in `status='error'`.
 *
 * Fix: lookup the prior invoice via order_invoice_matches.purchase_order_id.
 * If that prior is non-confirmed, treat as re-upload (DELETE+INSERT, MOK-109).
 */
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

function makePdfFormData(opts: {
  supplier_id: string
  invoice_number: string
  invoice_date?: string
  purchase_order_id: string
  file_name?: string
}): FormData {
  const fd = new FormData()
  const pdfBlob = new Blob(['%PDF-1.4\n1 0 obj\n<<\n>>\nendobj\n'], {
    type: 'application/pdf',
  })
  fd.append('file', pdfBlob, opts.file_name ?? 'test-invoice.pdf')
  fd.append('supplier_id', opts.supplier_id)
  fd.append('invoice_number', opts.invoice_number)
  fd.append('invoice_date', opts.invoice_date ?? new Date().toISOString().slice(0, 10))
  fd.append('purchase_order_id', opts.purchase_order_id)
  return fd
}

async function createPOForUpload(tenant: TestTenant) {
  const supplier = await createSupplier(tenant)
  const inventoryItem = await createInventoryItem(tenant)
  const po = await createPurchaseOrder(tenant, {
    supplier_id: supplier.id,
    inventory_item_id: inventoryItem.id,
  })
  return { supplier, inventoryItem, po }
}

describe('admin invoices/upload — MOK-115 PO-link re-upload detection', () => {
  let tenant: TestTenant | undefined

  beforeAll(async () => {
    tenant = await createTenantForTest()
  })

  afterAll(async () => {
    await cleanupTenant(tenant)
  })

  it("replaces a non-confirmed prior even when invoice_number changed (the MOK-115 bug)", async () => {
    if (!tenant) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenant)
    const placeholderNumber = `${po.order_number}-1`

    // First upload: row created with the placeholder invoice_number.
    const req1 = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: placeholderNumber,
        purchase_order_id: po.id,
      }),
    })
    const res1 = await uploadPOST(req1)
    expect(res1.status).toBe(201)
    const body1 = await res1.json()
    const firstInvoiceId: string = body1.data.id

    // Simulate stage 1 rewriting invoice_number with the real number from
    // the PDF (the part of the workflow that was breaking re-uploads).
    const svc = getServiceClient()
    const realInvoiceNumber = `REAL-${Date.now()}`
    await svc
      .from('invoices')
      .update({ invoice_number: realInvoiceNumber, status: 'error' })
      .eq('id', firstInvoiceId)

    // Re-upload via the PO modal — same placeholder, different from the
    // post-extraction real number. Pre-MOK-115 this would mis-detect as a
    // first upload and INSERT a duplicate row.
    const req2 = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `${po.order_number}-2`,
        purchase_order_id: po.id,
      }),
    })
    const res2 = await uploadPOST(req2)
    expect(res2.status).toBe(201)
    const body2 = await res2.json()
    const secondInvoiceId: string = body2.data.id
    // It's a fresh row (DELETE+INSERT semantics from MOK-109).
    expect(secondInvoiceId).not.toBe(firstInvoiceId)

    // The first invoice was deleted, not orphaned.
    const { data: priorRow } = await svc
      .from('invoices')
      .select('id')
      .eq('id', firstInvoiceId)
      .maybeSingle()
    expect(priorRow).toBeNull()

    // Exactly one PO-linked invoice remains.
    const { data: linkedInvoices } = await svc
      .from('order_invoice_matches')
      .select('invoice_id')
      .eq('tenant_id', tenant.id)
      .eq('purchase_order_id', po.id)
    expect(linkedInvoices).toHaveLength(1)
    expect(linkedInvoices![0].invoice_id).toBe(secondInvoiceId)
  })

  // MOK-147: 409 narrowed from "any confirmed prior" to "confirmed prior
  // with the same file_name". This test covers the same-file path.
  it('blocks re-upload with 409 when the prior is confirmed AND has the same filename', async () => {
    if (!tenant) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenant)
    const sameFile = `same-${Date.now()}.pdf`

    const req1 = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `${po.order_number}-1`,
        purchase_order_id: po.id,
        file_name: sameFile,
      }),
    })
    const res1 = await uploadPOST(req1)
    expect(res1.status).toBe(201)
    const body1 = await res1.json()
    const firstInvoiceId: string = body1.data.id

    // Mark the prior invoice as confirmed.
    const svc = getServiceClient()
    await svc.from('invoices').update({ status: 'confirmed' }).eq('id', firstInvoiceId)

    // Re-upload with the SAME filename → 409.
    const req2 = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `${po.order_number}-2`,
        purchase_order_id: po.id,
        file_name: sameFile,
      }),
    })
    const res2 = await uploadPOST(req2)
    expect(res2.status).toBe(409)
    const body2 = await res2.json()
    expect(body2.code ?? body2.error_code ?? '').toBe('INVOICE_ALREADY_CONFIRMED')

    // Original confirmed row is untouched.
    const { data: priorRow } = await svc
      .from('invoices')
      .select('id, status')
      .eq('id', firstInvoiceId)
      .single()
    expect(priorRow!.status).toBe('confirmed')
  })

  // MOK-147: Odeko / multi-invoice POs send a 2nd invoice (different file)
  // after the 1st has confirmed. Pre-MOK-147 this 409'd; now it succeeds and
  // both invoices coexist on the PO.
  it('allows a sibling upload when the prior is confirmed but filename differs', async () => {
    if (!tenant) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenant)

    // First upload + mark confirmed.
    const req1 = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `${po.order_number}-1`,
        purchase_order_id: po.id,
        file_name: `odeko-delivery-${Date.now()}.pdf`,
      }),
    })
    const res1 = await uploadPOST(req1)
    expect(res1.status).toBe(201)
    const firstInvoiceId: string = (await res1.json()).data.id

    const svc = getServiceClient()
    await svc.from('invoices').update({ status: 'confirmed' }).eq('id', firstInvoiceId)

    // Second upload — DIFFERENT filename → sibling, allowed.
    const req2 = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `${po.order_number}-2`,
        purchase_order_id: po.id,
        file_name: `odeko-supplemental-${Date.now()}.pdf`,
      }),
    })
    const res2 = await uploadPOST(req2)
    expect(res2.status).toBe(201)
    const secondInvoiceId: string = (await res2.json()).data.id
    expect(secondInvoiceId).not.toBe(firstInvoiceId)

    // Both rows exist; original is still confirmed.
    const { data: rows } = await svc
      .from('invoices')
      .select('id, status')
      .in('id', [firstInvoiceId, secondInvoiceId])
    expect(rows).toHaveLength(2)
    const first = rows!.find((r) => r.id === firstInvoiceId)
    expect(first?.status).toBe('confirmed')

    // Both linked to the PO.
    const { data: links } = await svc
      .from('order_invoice_matches')
      .select('invoice_id')
      .eq('tenant_id', tenant.id)
      .eq('purchase_order_id', po.id)
    const linkedIds = links!.map((l) => l.invoice_id).sort()
    expect(linkedIds).toEqual([firstInvoiceId, secondInvoiceId].sort())
  })

  it('first upload (no prior PO link) inserts a fresh row', async () => {
    if (!tenant) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenant)

    const req = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `${po.order_number}-1`,
        purchase_order_id: po.id,
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBeTruthy()

    const svc = getServiceClient()
    const { data: linked } = await svc
      .from('order_invoice_matches')
      .select('invoice_id')
      .eq('tenant_id', tenant.id)
      .eq('purchase_order_id', po.id)
    expect(linked).toHaveLength(1)
    expect(linked![0].invoice_id).toBe(body.data.id)
  })

  it('legacy fallback: replaces by (supplier_id, invoice_number) when no PO-link prior exists', async () => {
    if (!tenant) throw new Error('test setup failed')
    // Two POs; first one will be skipped from the lookup. We seed a
    // (supplier, invoice_number) row attached to PO #1, then upload via PO #2
    // with the same invoice_number. The PO-link lookup misses (different PO),
    // but the legacy fallback should still find the row and replace it.
    const supplier = await createSupplier(tenant)
    const inventoryItem = await createInventoryItem(tenant)
    const poA = await createPurchaseOrder(tenant, {
      supplier_id: supplier.id,
      inventory_item_id: inventoryItem.id,
    })
    const poB = await createPurchaseOrder(tenant, {
      supplier_id: supplier.id,
      inventory_item_id: inventoryItem.id,
    })

    const sharedNumber = `LEGACY-${Date.now()}`
    const req1 = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: sharedNumber,
        purchase_order_id: poA.id,
      }),
    })
    const res1 = await uploadPOST(req1)
    expect(res1.status).toBe(201)
    const firstInvoiceId: string = (await res1.json()).data.id

    // Detach the PO link so the PO-link lookup misses on the next upload —
    // simulating data from before MOK-120 / orphaned link state.
    const svc = getServiceClient()
    await svc
      .from('order_invoice_matches')
      .delete()
      .eq('tenant_id', tenant.id)
      .eq('invoice_id', firstInvoiceId)

    const req2 = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: sharedNumber, // exact same number → legacy lookup hits
        purchase_order_id: poB.id,
      }),
    })
    const res2 = await uploadPOST(req2)
    expect(res2.status).toBe(201)
    const secondInvoiceId: string = (await res2.json()).data.id
    expect(secondInvoiceId).not.toBe(firstInvoiceId)

    const { data: priorRow } = await svc
      .from('invoices')
      .select('id')
      .eq('id', firstInvoiceId)
      .maybeSingle()
    expect(priorRow).toBeNull()
  })
})
