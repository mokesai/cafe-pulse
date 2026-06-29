/**
 * MOK-183 — resolving a price_variance exception with `approve_cost_update` (the action bulk
 * "Mark Resolved" now sends for price variances) applies the accepted per-individual price to
 * inventory cost and writes a cost-history audit row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as resolvePOST } from '@/app/api/admin/invoice-exceptions/[id]/resolve/route'
import {
  buildAuthedRequest,
  cleanupTenant,
  createInventoryItem,
  createInvoice,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenant: TestTenant
let exceptionId: string
let inventoryItemId: string

beforeAll(async () => {
  tenant = await createTenantForTest('approvecost')
  const supabase = getServiceClient()
  const supplier = await createSupplier(tenant)
  const inv = await createInventoryItem(tenant, { unit_cost: 5, item_type: 'prepackaged' })
  inventoryItemId = inv.id
  const invoice = await createInvoice(tenant, { supplier_id: supplier.id, status: 'pending_exceptions' })

  const { data: item } = await supabase
    .from('invoice_items')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoice.id,
      line_number: 1,
      item_description: 'Widget',
      quantity: 1,
      unit_price: 6.5,
      total_price: 6.5,
      matched_item_id: inventoryItemId,
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
      exception_message: 'price up',
      exception_context: {
        inventory_item_id: inventoryItemId,
        effective_unit_price: 6.5,
        invoice_unit_price: 6.5,
        previous_unit_cost: 5,
        price_mode: 'per_unit',
        pack_size: 1,
      },
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
  await supabase.from('inventory_item_cost_history').delete().eq('tenant_id', tenant.id)
  await cleanupTenant(tenant)
})

describe('invoice-exception resolve — MOK-183 approve_cost_update applies cost', () => {
  it('writes the accepted price to inventory unit_cost + a cost-history row', async () => {
    const req = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${exceptionId}/resolve`,
      body: { action: { type: 'approve_cost_update' } },
    })
    const res = await resolvePOST(req, { params: Promise.resolve({ id: exceptionId }) })
    expect(res.status).toBe(200)

    const supabase = getServiceClient()
    const { data: inv } = await supabase
      .from('inventory_items')
      .select('unit_cost')
      .eq('id', inventoryItemId)
      .single()
    expect(Number(inv!.unit_cost)).toBe(6.5)

    const { data: hist } = await supabase
      .from('inventory_item_cost_history')
      .select('source, new_unit_cost')
      .eq('tenant_id', tenant.id)
      .eq('inventory_item_id', inventoryItemId)
    expect(
      (hist ?? []).some((h) => h.source === 'approve_cost_update' && Number(h.new_unit_cost) === 6.5),
    ).toBe(true)
  })
})
