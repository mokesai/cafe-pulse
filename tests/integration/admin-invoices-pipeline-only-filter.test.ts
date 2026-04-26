/**
 * MOK-127 — GET /api/admin/invoices default-hides pre-pipeline rows.
 *
 * The Invoices page is for reviewing pipeline outcomes. A row that's
 * `status='uploaded'` with `pipeline_started_at IS NULL` is pre-pipeline
 * (the trigger hasn't fired yet). It should not show by default.
 *
 * Opt-in via `?include_pre_pipeline=true` recovers the old behavior.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as listInvoicesGET } from '@/app/api/admin/invoices/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInvoice,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

describe('GET /api/admin/invoices — pre-pipeline filter (MOK-127)', () => {
  let tenant: TestTenant | undefined
  let supplierId: string
  let prePipelineInvoiceId: string
  let postPipelineInvoiceId: string
  let confirmedInvoiceId: string

  beforeAll(async () => {
    tenant = await createTenantForTest()
    if (!tenant) throw new Error('test setup failed')
    const supplier = await createSupplier(tenant)
    supplierId = supplier.id

    const svc = getServiceClient()

    // The AFTER INSERT pipeline trigger fires the edge function. The edge
    // function only claims rows whose status is 'uploaded' (orchestrator.ts
    // line 70: `.eq('status', 'uploaded')`). So we sidestep the race by
    // never INSERTING with status='uploaded' — every row is created in a
    // non-claimable status first, then UPDATEd to the desired test state.
    // UPDATEs don't fire the trigger.

    // Pre-pipeline: insert as 'confirmed' (edge function short-circuits),
    // then move to status='uploaded' with pipeline_started_at NULL.
    const pre = await createInvoice(tenant, {
      supplier_id: supplierId,
      status: 'confirmed',
    })
    prePipelineInvoiceId = pre.id
    await svc
      .from('invoices')
      .update({
        status: 'uploaded',
        pipeline_started_at: null,
        pipeline_stage: null,
      })
      .eq('id', prePipelineInvoiceId)

    // Post-pipeline (in flight): pipeline_started_at set, status=pipeline_running
    const running = await createInvoice(tenant, {
      supplier_id: supplierId,
      status: 'pipeline_running' as never,
    })
    postPipelineInvoiceId = running.id
    await svc
      .from('invoices')
      .update({
        pipeline_started_at: new Date().toISOString(),
        pipeline_stage: 'matching_items',
      })
      .eq('id', postPipelineInvoiceId)

    // Terminal post-pipeline: status=confirmed (covers the status-list branch
    // of the OR filter even when pipeline_started_at happened to be NULL).
    const done = await createInvoice(tenant, {
      supplier_id: supplierId,
      status: 'confirmed',
    })
    confirmedInvoiceId = done.id
    await svc
      .from('invoices')
      .update({ pipeline_started_at: null })
      .eq('id', confirmedInvoiceId)
  })

  afterAll(async () => {
    await cleanupTenant(tenant)
  })

  it('hides pre-pipeline invoices by default', async () => {
    if (!tenant) throw new Error('test setup failed')
    // Reset state right before the request — the AFTER INSERT trigger fires
    // an async HTTP call to the edge function that can race with our seed
    // updates and write pipeline_started_at on its own. UPDATE does not fire
    // the trigger, so this final reset wins.
    const svc = getServiceClient()
    await svc
      .from('invoices')
      .update({ pipeline_started_at: null, pipeline_stage: null, status: 'uploaded' })
      .eq('id', prePipelineInvoiceId)

    const { data: snapshot } = await svc
      .from('invoices')
      .select('id, status, pipeline_started_at')
      .in('id', [prePipelineInvoiceId, postPipelineInvoiceId, confirmedInvoiceId])
    // Sanity: the pre-pipeline row truly is pre-pipeline at request time.
    const pre = snapshot?.find((r) => r.id === prePipelineInvoiceId)
    expect(pre?.status).toBe('uploaded')
    expect(pre?.pipeline_started_at).toBeNull()

    const req = buildAuthedRequest({
      tenant,
      method: 'GET',
      url: '/api/admin/invoices',
    })
    const res = await listInvoicesGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const ids: string[] = body.data.map((row: { id: string }) => row.id)
    expect(ids).not.toContain(prePipelineInvoiceId)
    expect(ids).toContain(postPipelineInvoiceId)
    expect(ids).toContain(confirmedInvoiceId)
  })

  it('includes pre-pipeline invoices when include_pre_pipeline=true', async () => {
    if (!tenant) throw new Error('test setup failed')
    // Defensive reset, same reasoning as above.
    const svc = getServiceClient()
    await svc
      .from('invoices')
      .update({ pipeline_started_at: null, pipeline_stage: null, status: 'uploaded' })
      .eq('id', prePipelineInvoiceId)

    const req = buildAuthedRequest({
      tenant,
      method: 'GET',
      url: '/api/admin/invoices?include_pre_pipeline=true',
    })
    const res = await listInvoicesGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids: string[] = body.data.map((row: { id: string }) => row.id)
    expect(ids).toContain(prePipelineInvoiceId)
    expect(ids).toContain(postPipelineInvoiceId)
    expect(ids).toContain(confirmedInvoiceId)
  })

  it('queue counts also reflect the pre-pipeline filter', async () => {
    if (!tenant) throw new Error('test setup failed')
    // Defensive: re-pin the pre-pipeline row to status='uploaded',
    // pipeline_started_at=NULL since the AFTER INSERT trigger may have
    // raced and set it during the previous test.
    const svc = getServiceClient()
    await svc
      .from('invoices')
      .update({ pipeline_started_at: null, pipeline_stage: null, status: 'uploaded' })
      .eq('id', prePipelineInvoiceId)

    const reqDefault = buildAuthedRequest({
      tenant,
      method: 'GET',
      url: '/api/admin/invoices',
    })
    const resDefault = await listInvoicesGET(reqDefault)
    const bodyDefault = await resDefault.json()

    const reqIncluded = buildAuthedRequest({
      tenant,
      method: 'GET',
      url: '/api/admin/invoices?include_pre_pipeline=true',
    })
    const resIncluded = await listInvoicesGET(reqIncluded)
    const bodyIncluded = await resIncluded.json()

    // Default 'all' count must be strictly less than the include-pre count
    // (pre-pipeline row contributes only when included).
    expect(bodyDefault.text_queue_counts.all).toBeLessThan(
      bodyIncluded.text_queue_counts.all,
    )
  })
})
