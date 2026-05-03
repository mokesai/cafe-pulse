/**
 * MOK-143 — same-file fallback in the upload route catches re-uploads of
 * legacy invoices (pre-MOK-120) that have no `order_invoice_matches` PO
 * link AND whose `invoice_number` was rewritten by stage 1 to something
 * other than what the user types now.
 *
 * Repro shape: Lotus Plant Power invoice from 2026-04-20 sat in
 * `pending_exceptions` with no PO link. User re-uploaded the same PDF via
 * the PO modal (placeholder `${PO}-N`); pre-MOK-143 the upload created a
 * fresh row, stage 1 extracted the same number → unique-constraint UPDATE
 * failure → zombie row in `status='error'`.
 *
 * Coverage:
 *   - same supplier + same file_name + non-confirmed prior → re-upload
 *     (DELETE+INSERT semantics)
 *   - same supplier + same file_name + confirmed prior → fallback skips,
 *     fresh row inserted (the earlier (supplier, invoice_number) check
 *     already 409s the confirmed-conflict case)
 *   - different file_name → fallback misses, fresh row inserted
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

describe('admin invoices/upload — MOK-143 file-name fallback', () => {
  let tenant: TestTenant | undefined

  beforeAll(async () => {
    tenant = await createTenantForTest('mok143-upload')
  })

  afterAll(async () => {
    await cleanupTenant(tenant)
  })

  it('catches a same-file re-upload when the prior has no PO link and a different invoice_number', async () => {
    if (!tenant) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenant)
    const sameFileName = `lotus-${Date.now()}.pdf`

    // Insert a legacy prior: same supplier, same filename, NO PO link,
    // status='pending_exceptions', invoice_number = the parsed value (so
    // the (supplier, invoice_number) lookup misses on re-upload).
    const svc = getServiceClient()
    const realInvoiceNumber = `LEGACY-${Date.now()}`
    const { data: priorInsert, error: priorErr } = await svc
      .from('invoices')
      .insert({
        tenant_id: tenant.id,
        supplier_id: supplier.id,
        invoice_number: realInvoiceNumber,
        invoice_date: new Date().toISOString().slice(0, 10),
        status: 'pending_exceptions',
        file_name: sameFileName,
        file_path: 'legacy/path.pdf',
      })
      .select('id')
      .single()
    if (priorErr || !priorInsert) throw new Error(`prior setup failed: ${priorErr?.message}`)
    const firstInvoiceId = priorInsert.id

    // Re-upload the same file via the PO modal — placeholder invoice_number,
    // different from the prior's real one, no PO link on the prior to find.
    const req = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `${po.order_number}-1`,
        purchase_order_id: po.id,
        file_name: sameFileName,
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    const secondInvoiceId: string = body.data.id

    // DELETE+INSERT: prior row gone, fresh row in its place.
    expect(secondInvoiceId).not.toBe(firstInvoiceId)
    const { data: priorRow } = await svc
      .from('invoices')
      .select('id')
      .eq('id', firstInvoiceId)
      .maybeSingle()
    expect(priorRow).toBeNull()

    const { data: newRow } = await svc
      .from('invoices')
      .select('file_name, supplier_id')
      .eq('id', secondInvoiceId)
      .single()
    expect(newRow?.file_name).toBe(sameFileName)
    expect(newRow?.supplier_id).toBe(supplier.id)
  })

  it('does NOT trigger fallback when filename differs (fresh row inserted)', async () => {
    if (!tenant) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenant)
    const priorFileName = `prior-${Date.now()}.pdf`
    const newFileName = `different-${Date.now()}.pdf`

    const svc = getServiceClient()
    const { data: priorInsert } = await svc
      .from('invoices')
      .insert({
        tenant_id: tenant.id,
        supplier_id: supplier.id,
        invoice_number: `LEGACY-A-${Date.now()}`,
        invoice_date: new Date().toISOString().slice(0, 10),
        status: 'pending_exceptions',
        file_name: priorFileName,
        file_path: 'legacy/a.pdf',
      })
      .select('id')
      .single()
    const firstInvoiceId = priorInsert!.id

    const req = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `${po.order_number}-1`,
        purchase_order_id: po.id,
        file_name: newFileName,
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    const secondInvoiceId: string = body.data.id

    // Different filename → fallback misses → prior preserved, new row coexists.
    expect(secondInvoiceId).not.toBe(firstInvoiceId)
    const { data: priorRow } = await svc
      .from('invoices')
      .select('id')
      .eq('id', firstInvoiceId)
      .maybeSingle()
    expect(priorRow).not.toBeNull()
  })

  it('does NOT trigger fallback when prior is confirmed (filter excludes confirmed)', async () => {
    if (!tenant) throw new Error('test setup failed')
    const { supplier, po } = await createPOForUpload(tenant)
    const sameFileName = `confirmed-${Date.now()}.pdf`

    const svc = getServiceClient()
    const { data: priorInsert } = await svc
      .from('invoices')
      .insert({
        tenant_id: tenant.id,
        supplier_id: supplier.id,
        invoice_number: `CONFIRMED-${Date.now()}`,
        invoice_date: new Date().toISOString().slice(0, 10),
        status: 'confirmed',
        file_name: sameFileName,
        file_path: 'confirmed/path.pdf',
      })
      .select('id')
      .single()
    const firstInvoiceId = priorInsert!.id

    const req = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: '/api/admin/invoices/upload',
      body: makePdfFormData({
        supplier_id: supplier.id,
        invoice_number: `${po.order_number}-1`,
        purchase_order_id: po.id,
        file_name: sameFileName,
      }),
    })
    const res = await uploadPOST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    const secondInvoiceId: string = body.data.id

    // Confirmed prior preserved; new row created (file-name fallback's
    // `.neq('status', 'confirmed')` filter rules out the confirmed match).
    expect(secondInvoiceId).not.toBe(firstInvoiceId)
    const { data: priorRow } = await svc
      .from('invoices')
      .select('id, status')
      .eq('id', firstInvoiceId)
      .single()
    expect(priorRow?.status).toBe('confirmed')
  })
})
