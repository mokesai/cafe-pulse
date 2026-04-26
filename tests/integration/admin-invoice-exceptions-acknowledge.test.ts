/**
 * MOK-123 — POST /api/admin/invoice-exceptions/[id]/acknowledge
 *
 * Validates the acknowledge route's behavior:
 *   - Sets exception.status='acknowledged' with admin metadata
 *   - Updates the linked invoice_variance_history row's acknowledgment fields
 *   - Rejects acknowledging an already-non-open exception
 *   - Tenant-isolated (cross-tenant request → 404)
 *   - Reuses existing resolution_notes / resolved_by / resolved_at columns
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as acknowledgePOST } from '@/app/api/admin/invoice-exceptions/[id]/acknowledge/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInvoice,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

interface ExceptionFixture {
  id: string
  invoice_id: string
}

async function createOpenException(
  tenant: TestTenant,
  invoiceId: string,
  type = 'quantity_variance',
  severity: 'info' | 'block' = 'block',
): Promise<ExceptionFixture> {
  const svc = getServiceClient()
  const { data, error } = await svc
    .from('invoice_exceptions')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoiceId,
      exception_type: type,
      exception_message: `Test ${type} exception`,
      exception_context: { variance_pct: 10 },
      status: 'open',
      pipeline_stage_at_creation: 'matching_items',
      severity,
    })
    .select('id, invoice_id')
    .single()
  if (error || !data) throw new Error(`Failed to seed exception: ${error?.message}`)
  return data
}

async function createVarianceHistoryFor(
  tenant: TestTenant,
  invoiceId: string,
  exceptionId: string,
) {
  const svc = getServiceClient()
  const { data, error } = await svc
    .from('invoice_variance_history')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoiceId,
      variance_type: 'quantity_variance',
      severity: 'block',
      related_exception_id: exceptionId,
    })
    .select('id, acknowledged_at')
    .single()
  if (error || !data) throw new Error(`Failed to seed variance history: ${error?.message}`)
  return data
}

describe('POST /api/admin/invoice-exceptions/[id]/acknowledge (MOK-123)', () => {
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

  it("transitions exception status from 'open' to 'acknowledged' with admin metadata", async () => {
    if (!tenantA) throw new Error('test setup failed')
    const exc = await createOpenException(tenantA, invoiceIdA)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exc.id}/acknowledge`,
      body: { notes: 'Supplier short-shipped, accepted as-is' },
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: exc.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.status).toBe('acknowledged')

    const svc = getServiceClient()
    const { data } = await svc
      .from('invoice_exceptions')
      .select('status, resolved_by, resolved_at, resolution_notes')
      .eq('id', exc.id)
      .single()
    expect(data!.status).toBe('acknowledged')
    expect(data!.resolved_at).not.toBeNull()
    expect(data!.resolution_notes).toBe('Supplier short-shipped, accepted as-is')
    expect(data!.resolved_by).not.toBeNull()
  })

  it('propagates acknowledgment to the linked invoice_variance_history row', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const exc = await createOpenException(tenantA, invoiceIdA)
    const history = await createVarianceHistoryFor(tenantA, invoiceIdA, exc.id)
    expect(history.acknowledged_at).toBeNull()

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exc.id}/acknowledge`,
      body: { notes: 'noted' },
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: exc.id }) })
    expect(res.status).toBe(200)

    const svc = getServiceClient()
    const { data } = await svc
      .from('invoice_variance_history')
      .select('acknowledged_at, acknowledged_by, acknowledgment_notes')
      .eq('id', history.id)
      .single()
    expect(data!.acknowledged_at).not.toBeNull()
    expect(data!.acknowledged_by).not.toBeNull()
    expect(data!.acknowledgment_notes).toBe('noted')
  })

  it('rejects acknowledging an already-resolved exception (422)', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const exc = await createOpenException(tenantA, invoiceIdA)

    // Pre-resolve it
    const svc = getServiceClient()
    await svc
      .from('invoice_exceptions')
      .update({ status: 'resolved' })
      .eq('id', exc.id)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exc.id}/acknowledge`,
      body: {},
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: exc.id }) })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('already resolved')
  })

  it('returns 404 when the exception belongs to a different tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplierB = await createSupplier(tenantB)
    const invoiceB = await createInvoice(tenantB, { supplier_id: supplierB.id })
    const excB = await createOpenException(tenantB, invoiceB.id)

    // Tenant A tries to acknowledge tenant B's exception
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${excB.id}/acknowledge`,
      body: {},
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: excB.id }) })
    expect(res.status).toBe(404)
  })

  it('does not leave the invoice auto-confirmed (acknowledge ≠ confirm)', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const supplier = await createSupplier(tenantA)
    const invoice = await createInvoice(tenantA, { supplier_id: supplier.id })

    // Put invoice into pending_exceptions
    const svc = getServiceClient()
    await svc
      .from('invoices')
      .update({ status: 'pending_exceptions' })
      .eq('id', invoice.id)

    const exc = await createOpenException(tenantA, invoice.id)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exc.id}/acknowledge`,
      body: {},
    })
    const res = await acknowledgePOST(req, { params: Promise.resolve({ id: exc.id }) })
    expect(res.status).toBe(200)

    // Acknowledge alone should NOT auto-confirm the invoice — admin still
    // needs to confirm explicitly via /resolve or /confirm.
    const { data } = await svc
      .from('invoices')
      .select('status')
      .eq('id', invoice.id)
      .single()
    expect(data!.status).toBe('pending_exceptions')
  })
})
