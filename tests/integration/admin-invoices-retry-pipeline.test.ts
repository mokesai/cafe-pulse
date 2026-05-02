/**
 * MOK-127 — POST /api/admin/invoices/[id]/retry-pipeline.
 *
 * Validates the retry route's contract:
 *   - Resets pipeline state (status→'uploaded', stage/error/completed_at→NULL)
 *   - Returns 202 on a retriable status
 *   - Rejects 422 on a non-retriable status
 *   - Returns 404 cross-tenant
 *
 * The route also pings the Edge Function via `fetch`. The dev edge function
 * IS reachable from CI, and when it answers fast it actually claims the
 * invoice (UPDATE status='pipeline_running' WHERE status='uploaded') and
 * then errors out because the seeded invoice has no file_url — leaving
 * status='error' instead of 'uploaded' and breaking the reset assertions
 * below. The race is non-deterministic; CI saw it pass for weeks before it
 * fired on PR #85.
 *
 * Fix: stub the global fetch JUST for the edge-function URL so the route's
 * outbound call is a no-op in tests. Supabase-js DB calls go through their
 * own SDK and are unaffected.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

const realFetch = global.fetch
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString()
    if (url.includes('/functions/v1/invoice-pipeline')) {
      // Pretend the edge function accepted the call but did nothing — matches
      // the route's "best-effort, non-fatal" expectation.
      return new Response(JSON.stringify({ ok: true, mocked: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return realFetch(input, init)
  })
})

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

  // ───────────────────────────────────────────────────────────────────────────
  // MOK-128: retry dismisses stale open exceptions for the invoice
  // ───────────────────────────────────────────────────────────────────────────

  it('MOK-128: dismisses open exceptions on the invoice when pipeline is retried', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const invoice = await createInvoice(tenantA, {
      supplier_id: supplierAId,
      status: 'pending_exceptions' as never,
    })
    const svc = getServiceClient()

    // Seed three open exceptions (mix of types and severities) and one
    // already-resolved exception (control: should NOT be touched).
    await svc.from('invoice_exceptions').insert([
      {
        tenant_id: tenantA.id,
        invoice_id: invoice.id,
        exception_type: 'price_variance',
        exception_message: 'stale price var',
        exception_context: {},
        status: 'open',
        severity: 'block',
        pipeline_stage_at_creation: 'matching_items',
      },
      {
        tenant_id: tenantA.id,
        invoice_id: invoice.id,
        exception_type: 'no_item_match',
        exception_message: 'stale no_item',
        exception_context: {},
        status: 'open',
        severity: 'block',
        pipeline_stage_at_creation: 'matching_items',
      },
      {
        tenant_id: tenantA.id,
        invoice_id: invoice.id,
        exception_type: 'quantity_variance',
        exception_message: 'stale info qty',
        exception_context: {},
        status: 'open',
        severity: 'info',
        pipeline_stage_at_creation: 'matching_items',
      },
      {
        tenant_id: tenantA.id,
        invoice_id: invoice.id,
        exception_type: 'price_variance',
        exception_message: 'previously resolved',
        exception_context: {},
        status: 'resolved',
        severity: 'block',
        pipeline_stage_at_creation: 'matching_items',
        resolved_at: new Date().toISOString(),
      },
    ])

    // Defensive re-pin (AFTER INSERT trigger races as in the other tests).
    await svc
      .from('invoices')
      .update({ status: 'pending_exceptions', pipeline_stage: 'matching_items' })
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
    // The 3 open exceptions are dismissed; the previously-resolved one isn't counted.
    expect(body.stale_exceptions_dismissed).toBe(3)

    // All open exceptions are now dismissed with notes; resolved one is unchanged.
    const { data: rows } = await svc
      .from('invoice_exceptions')
      .select('exception_message, status, resolution_notes')
      .eq('invoice_id', invoice.id)
      .eq('tenant_id', tenantA.id)
      .order('exception_message')

    const messageStatus = Object.fromEntries(
      (rows ?? []).map((r) => [r.exception_message, { status: r.status, notes: r.resolution_notes }]),
    )
    expect(messageStatus['stale price var'].status).toBe('dismissed')
    expect(messageStatus['stale no_item'].status).toBe('dismissed')
    expect(messageStatus['stale info qty'].status).toBe('dismissed')
    expect(messageStatus['stale price var'].notes).toMatch(/Superseded by pipeline re-run/)
    // The pre-resolved exception is untouched
    expect(messageStatus['previously resolved'].status).toBe('resolved')
    expect(messageStatus['previously resolved'].notes).toBeNull()
  })

  it('MOK-128: zero stale exceptions on a clean retry (no pre-existing open ones)', async () => {
    if (!tenantA) throw new Error('test setup failed')
    const invoice = await createInvoice(tenantA, {
      supplier_id: supplierAId,
      status: 'error' as never,
    })
    const svc = getServiceClient()
    await svc.from('invoices').update({ status: 'error' }).eq('id', invoice.id)

    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/${invoice.id}/retry-pipeline`,
      body: {},
    })
    const res = await retryPOST(req, { params: Promise.resolve({ id: invoice.id }) })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.stale_exceptions_dismissed).toBe(0)
  })

  it("MOK-128: tenant isolation — retry on tenant A's invoice doesn't touch tenant B's exceptions", async () => {
    if (!tenantA || !tenantB) throw new Error('test setup failed')
    // Tenant A invoice + open exception
    const invoiceA = await createInvoice(tenantA, {
      supplier_id: supplierAId,
      status: 'pending_exceptions' as never,
    })
    // Tenant B invoice + open exception (control)
    const supplierB = await createSupplier(tenantB)
    const invoiceB = await createInvoice(tenantB, {
      supplier_id: supplierB.id,
      status: 'pending_exceptions' as never,
    })

    const svc = getServiceClient()
    await svc.from('invoice_exceptions').insert([
      {
        tenant_id: tenantA.id,
        invoice_id: invoiceA.id,
        exception_type: 'price_variance',
        exception_message: 'tenant A exception',
        exception_context: {},
        status: 'open',
        severity: 'block',
        pipeline_stage_at_creation: 'matching_items',
      },
      {
        tenant_id: tenantB.id,
        invoice_id: invoiceB.id,
        exception_type: 'price_variance',
        exception_message: 'tenant B exception',
        exception_context: {},
        status: 'open',
        severity: 'block',
        pipeline_stage_at_creation: 'matching_items',
      },
    ])
    await svc
      .from('invoices')
      .update({ status: 'pending_exceptions' })
      .eq('id', invoiceA.id)
    await svc
      .from('invoices')
      .update({ status: 'pending_exceptions' })
      .eq('id', invoiceB.id)

    // Tenant A retries A's invoice
    const req = buildAuthedRequest({
      tenant: tenantA,
      method: 'POST',
      url: `/api/admin/invoices/${invoiceA.id}/retry-pipeline`,
      body: {},
    })
    const res = await retryPOST(req, { params: Promise.resolve({ id: invoiceA.id }) })
    expect(res.status).toBe(202)
    expect((await res.json()).stale_exceptions_dismissed).toBe(1)

    // Tenant A's exception is dismissed; tenant B's stays open.
    const { data: aException } = await svc
      .from('invoice_exceptions')
      .select('status')
      .eq('exception_message', 'tenant A exception')
      .single()
    expect(aException!.status).toBe('dismissed')

    const { data: bException } = await svc
      .from('invoice_exceptions')
      .select('status')
      .eq('exception_message', 'tenant B exception')
      .single()
    expect(bException!.status).toBe('open')
  })
})
