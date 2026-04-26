/**
 * MOK-127 — POST /api/admin/invoices/[id]/retry-pipeline.
 *
 * Validates the retry route's contract:
 *   - Resets pipeline state (status→'uploaded', stage/error/completed_at→NULL)
 *   - Returns 202 on a retriable status
 *   - Rejects 422 on a non-retriable status
 *   - Returns 404 cross-tenant
 *
 * The route also pings the Edge Function. That call is best-effort
 * (wrapped in try/catch, non-fatal) so we don't assert on it here — the
 * edge function isn't running in the integration test environment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as retryPOST } from '@/app/api/admin/invoices/[id]/retry-pipeline/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInvoice,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

describe('POST /api/admin/invoices/[id]/retry-pipeline (MOK-127)', () => {
  let tenantA: TestTenant | undefined
  let tenantB: TestTenant | undefined
  let supplierAId: string

  beforeAll(async () => {
    tenantA = await createTenantForTest()
    tenantB = await createTenantForTest()
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplierA = await createSupplier(tenantA)
    supplierAId = supplierA.id
  })

  afterAll(async () => {
    await Promise.all([cleanupTenant(tenantA), cleanupTenant(tenantB)])
  })

  it("resets pipeline state and returns 202 from a 'pending_exceptions' invoice", async () => {
    if (!tenantA) throw new Error('test setup failed')
    const invoice = await createInvoice(tenantA, {
      supplier_id: supplierAId,
      status: 'pending_exceptions' as never,
    })
    const svc = getServiceClient()
    // Defensive re-pin: the AFTER INSERT trigger fires the pipeline edge
    // function asynchronously; explicitly include `status` in the update so
    // we win even if the edge function raced and changed it.
    await svc
      .from('invoices')
      .update({
        status: 'pending_exceptions',
        pipeline_stage: 'matching_items',
        pipeline_started_at: new Date().toISOString(),
        pipeline_completed_at: new Date().toISOString(),
        pipeline_error: 'previous failure',
      })
      .eq('id', invoice.id)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/${invoice.id}/retry-pipeline`,
      body: {},
    })
    const res = await retryPOST(req, { params: Promise.resolve({ id: invoice.id }) })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.success).toBe(true)

    const { data: refreshed } = await svc
      .from('invoices')
      .select('status, pipeline_stage, pipeline_error, pipeline_completed_at')
      .eq('id', invoice.id)
      .single()
    expect(refreshed!.status).toBe('uploaded')
    expect(refreshed!.pipeline_stage).toBeNull()
    expect(refreshed!.pipeline_error).toBeNull()
    expect(refreshed!.pipeline_completed_at).toBeNull()
  })

  it("rejects retry on a non-retriable status (e.g. 'confirmed') with 422", async () => {
    if (!tenantA) throw new Error('test setup failed')
    const invoice = await createInvoice(tenantA, {
      supplier_id: supplierAId,
      status: 'confirmed',
    })
    const svc = getServiceClient()
    // Defensive re-pin against the AFTER INSERT pipeline trigger.
    await svc.from('invoices').update({ status: 'confirmed' }).eq('id', invoice.id)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/${invoice.id}/retry-pipeline`,
      body: {},
    })
    const res = await retryPOST(req, { params: Promise.resolve({ id: invoice.id }) })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/cannot retry/i)
  })

  it('returns 404 when the invoice belongs to a different tenant', async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    const supplierB = await createSupplier(tenantB)
    const invoiceB = await createInvoice(tenantB, {
      supplier_id: supplierB.id,
      status: 'error' as never,
    })
    const svc = getServiceClient()
    // Defensive re-pin against the AFTER INSERT pipeline trigger.
    await svc.from('invoices').update({ status: 'error' }).eq('id', invoiceB.id)

    // Tenant A tries to retry tenant B's invoice
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/${invoiceB.id}/retry-pipeline`,
      body: {},
    })
    const res = await retryPOST(req, { params: Promise.resolve({ id: invoiceB.id }) })
    expect(res.status).toBe(404)

    // Confirm tenant B's invoice was not mutated by the cross-tenant attempt
    const { data } = await svc
      .from('invoices')
      .select('status')
      .eq('id', invoiceB.id)
      .single()
    expect(data!.status).toBe('error')
  })
})
