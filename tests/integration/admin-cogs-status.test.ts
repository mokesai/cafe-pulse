/**
 * B1 / MOK-173 — the dashboard COGS-status endpoint buckets weekly COGS, counts only open
 * BLOCK-severity exceptions, and reflects the tenant target; and the invoice-settings route
 * persists the per-tenant target_cogs_percentage_pct (tenant-scoped).
 *
 * Note: the COGS%/revenue math is covered by the computeCogsStatus unit test. Here the test
 * tenant has no orders, so the endpoint should report no_sales / null COGS% — which is the
 * correct, honest behavior we want to verify end-to-end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as cogsStatusGET } from '@/app/api/admin/dashboard/cogs-status/route'
import { GET as settingsGET, PUT as settingsPUT } from '@/app/api/admin/invoice-pipeline-settings/route'
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

function ymd(offset: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - offset)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  tenant = await createTenantForTest('cogsstatus')
  const supabase = getServiceClient()

  // This-week COGS (today + today-2 = 280) and prior-week (today-9 = 250).
  await supabase.from('ai_cogs_daily_summaries').insert([
    { tenant_id: tenant.id, summary_date: ymd(0), periodic_cogs: 180, beginning_inventory_value: 0, purchases_value: 0, ending_inventory_value: 0, computation_method: 'periodic' },
    { tenant_id: tenant.id, summary_date: ymd(2), periodic_cogs: 100, beginning_inventory_value: 0, purchases_value: 0, ending_inventory_value: 0, computation_method: 'periodic' },
    { tenant_id: tenant.id, summary_date: ymd(9), periodic_cogs: 250, beginning_inventory_value: 0, purchases_value: 0, ending_inventory_value: 0, computation_method: 'periodic' },
  ])

  // One open block + one open info exception — only the block should count.
  const supplier = await createSupplier(tenant)
  const invoice = await createInvoice(tenant, { supplier_id: supplier.id, status: 'pending_exceptions' })
  await supabase.from('invoice_exceptions').insert([
    { tenant_id: tenant.id, invoice_id: invoice.id, exception_type: 'price_variance', exception_message: 'block', exception_context: {}, pipeline_stage_at_creation: 'matching_items', status: 'open', severity: 'block' },
    { tenant_id: tenant.id, invoice_id: invoice.id, exception_type: 'price_variance', exception_message: 'info', exception_context: {}, pipeline_stage_at_creation: 'matching_items', status: 'open', severity: 'info' },
  ])
})

afterAll(async () => {
  const supabase = getServiceClient()
  await supabase.from('invoice_exceptions').delete().eq('tenant_id', tenant.id)
  await supabase.from('ai_cogs_daily_summaries').delete().eq('tenant_id', tenant.id)
  await cleanupTenant(tenant)
})

describe('admin/dashboard/cogs-status — MOK-173', () => {
  it('buckets this-week COGS, counts only block exceptions, and reports no_sales without revenue', async () => {
    const req = buildAuthedRequest({ tenant, method: 'GET', url: '/api/admin/dashboard/cogs-status' })
    const res = await cogsStatusGET(req)
    expect(res.status).toBe(200)

    const { data } = await res.json()
    expect(data.weeklyCogs).toBe(280)
    expect(data.cogsPct).toBeNull() // no orders → no sales
    expect(data.signal).toBe('no_sales')
    expect(data.openBlockExceptions).toBe(1) // info exception excluded
    expect(data.targetPct).toBe(30) // default
  })
})

describe('admin/invoice-pipeline-settings — MOK-173 target_cogs_percentage_pct', () => {
  it('persists the per-tenant target and reads it back (tenant-scoped)', async () => {
    const putReq = buildAuthedRequest({
      tenant,
      method: 'PUT',
      url: '/api/admin/invoice-pipeline-settings',
      body: { target_cogs_percentage_pct: 25 },
    })
    const putRes = await settingsPUT(putReq)
    expect(putRes.status).toBe(200)
    const putBody = await putRes.json()
    expect(putBody.data.target_cogs_percentage_pct).toBe(25)

    const getRes = await settingsGET(
      buildAuthedRequest({ tenant, method: 'GET', url: '/api/admin/invoice-pipeline-settings' }),
    )
    const getBody = await getRes.json()
    expect(getBody.data.target_cogs_percentage_pct).toBe(25)

    const { data: row } = await getServiceClient()
      .from('tenants')
      .select('target_cogs_percentage_pct')
      .eq('id', tenant.id)
      .single()
    expect(row!.target_cogs_percentage_pct).toBe(25)
  })

  it('rejects an out-of-range target', async () => {
    const res = await settingsPUT(
      buildAuthedRequest({
        tenant,
        method: 'PUT',
        url: '/api/admin/invoice-pipeline-settings',
        body: { target_cogs_percentage_pct: 250 },
      }),
    )
    expect(res.status).toBe(400)
  })
})
