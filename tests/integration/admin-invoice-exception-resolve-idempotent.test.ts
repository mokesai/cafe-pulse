/**
 * MOK-182 — the exception-resolve route must be bulletproof once the resolution commits:
 *   - resolving succeeds and the exception ends `resolved` (post-resolution auto-confirm is
 *     non-fatal), and
 *   - re-submitting an already-resolved exception is idempotent (200 success, not a 422 that
 *     leaves the UI stuck on "failed to resolve").
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as resolvePOST } from '@/app/api/admin/invoice-exceptions/[id]/resolve/route'
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
let exceptionId: string

beforeAll(async () => {
  tenant = await createTenantForTest('resolveidem')
  const supabase = getServiceClient()
  const supplier = await createSupplier(tenant)
  const invoice = await createInvoice(tenant, { supplier_id: supplier.id, status: 'pending_exceptions' })

  const { data: item } = await supabase
    .from('invoice_items')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoice.id,
      line_number: 1,
      item_description: 'Test line',
      quantity: 2,
      unit_price: 5,
      total_price: 10,
    })
    .select('id')
    .single()

  const { data: exc } = await supabase
    .from('invoice_exceptions')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoice.id,
      invoice_item_id: item!.id,
      exception_type: 'price_variance',
      exception_message: 'test',
      exception_context: {},
      pipeline_stage_at_creation: 'matching_items',
      status: 'open',
      severity: 'block',
    })
    .select('id')
    .single()
  exceptionId = exc!.id
})

afterAll(async () => {
  const supabase = getServiceClient()
  await supabase.from('invoice_exceptions').delete().eq('tenant_id', tenant.id)
  await cleanupTenant(tenant)
})

function resolveReq() {
  return buildAuthedRequest({
    tenant,
    method: 'POST',
    url: `/api/admin/invoice-exceptions/${exceptionId}/resolve`,
    body: { action: { type: 'approve_and_continue' } },
  })
}

const routeCtx = () => ({ params: Promise.resolve({ id: exceptionId }) })

describe('invoice-exception resolve — MOK-182 robustness', () => {
  it('resolves successfully and commits (auto-confirm is non-fatal)', async () => {
    const res = await resolvePOST(resolveReq(), routeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    const { data } = await getServiceClient()
      .from('invoice_exceptions')
      .select('status')
      .eq('id', exceptionId)
      .single()
    expect(data!.status).toBe('resolved')
  })

  it('is idempotent when re-submitting an already-resolved exception (200, not 422)', async () => {
    const res = await resolvePOST(resolveReq(), routeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.already_resolved).toBe(true)
  })
})
