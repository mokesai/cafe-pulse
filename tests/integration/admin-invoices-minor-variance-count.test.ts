/**
 * A1 / MOK-169 — the Invoices API surfaces a per-invoice count of sub-threshold ("minor")
 * price changes, computed on read from invoice_variance_history. These no longer create
 * per-line exceptions; they're reported as a single FYI count. Only info-severity
 * price_variance rows count — block-severity (real exceptions) and other variance types don't.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as invoicesGET } from '@/app/api/admin/invoices/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInvoice,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenant: TestTenant
let supplier: { id: string; name: string }
let invoiceId: string

beforeAll(async () => {
  tenant = await createTenantForTest('minorvar')
  supplier = await createSupplier(tenant)
  const invoice = await createInvoice(tenant, { supplier_id: supplier.id, status: 'confirmed' })
  invoiceId = invoice.id

  const supabase = getServiceClient()
  const rows = [
    { variance_type: 'price_variance', severity: 'info' }, // counted
    { variance_type: 'price_variance', severity: 'info' }, // counted
    { variance_type: 'price_variance', severity: 'info' }, // counted
    { variance_type: 'price_variance', severity: 'block' }, // above threshold — NOT counted
    { variance_type: 'quantity_variance', severity: 'info' }, // different type — NOT counted
  ].map((r) => ({
    tenant_id: tenant.id,
    invoice_id: invoiceId,
    variance_type: r.variance_type,
    severity: r.severity,
  }))
  const { error } = await supabase.from('invoice_variance_history').insert(rows)
  if (error) throw new Error(`seed variance history failed: ${error.message}`)
})

afterAll(async () => {
  const supabase = getServiceClient()
  await supabase.from('invoice_variance_history').delete().eq('tenant_id', tenant.id)
  await cleanupTenant(tenant)
})

describe('admin/invoices — MOK-169 minor price change FYI count', () => {
  it('returns minor_price_variance_count = count of info-severity price variances only', async () => {
    const req = buildAuthedRequest({
      tenant,
      method: 'GET',
      url: `/api/admin/invoices?supplier_id=${supplier.id}&include_pre_pipeline=true&limit=50`,
    })
    const res = await invoicesGET(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    const row = (body.data as Array<{ id: string; minor_price_variance_count: number }>).find(
      (r) => r.id === invoiceId,
    )
    expect(row).toBeDefined()
    expect(row!.minor_price_variance_count).toBe(3)
  })
})
