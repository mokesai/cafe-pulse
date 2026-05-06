/**
 * MOK-150 — re-match re-validation: when an operator corrects a wrongly-
 * matched invoice item via the resolve route's `match_item` action, the
 * quantity-variance check must re-run against the new match's PO line.
 *
 * Pre-MOK-150 stage 4's `checkQuantityVariance` ran once during pipeline
 * processing and was never re-invoked after a manual re-match. Result: an
 * invoice line corrected to point at the right inventory item could leave
 * a real PO-quantity discrepancy silent.
 *
 * Live repro 2026-05-03 on PO-752389: 3 burritos under-shipped (5 ordered,
 * 4 invoiced). Initial wrong-supplier match made checkQuantityVariance
 * exit early (no PO line for the wrong inventory_item_id); after re-match
 * to the correct supplier-owned item the check never re-ran.
 *
 * Coverage:
 *   - re-match to an item with a PO-qty mismatch raises a quantity_variance
 *   - re-match to an item with matching PO qty raises nothing
 *   - re-match to an item with NO PO line raises nothing (invoice line
 *     legitimately not on this PO; let stage 4's path handle it elsewhere)
 *   - tenant isolation: another tenant's PO line cannot be hit
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as resolvePOST } from '@/app/api/admin/invoice-exceptions/[id]/resolve/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createInventoryItem,
  createInvoice,
  createPurchaseOrder,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenant: TestTenant

beforeAll(async () => {
  tenant = await createTenantForTest('mok150-rematch')
})

afterAll(async () => {
  await cleanupTenant(tenant)
})

async function setupInvoiceWithBadMatch(opts: {
  invoiceQty: number
  invoiceUnitPrice: number
  poQtyOrdered: number
  rematchTargetUnitCost?: number
}): Promise<{
  invoiceId: string
  invoiceItemId: string
  exceptionId: string
  rightInventoryId: string
  poId: string
}> {
  const supabase = getServiceClient()
  const supplier = await createSupplier(tenant)

  // The "right" inventory item — the one we'll re-match to. Has a PO line.
  const rightItem = await createInventoryItem(tenant, {
    item_name: 'Right Item',
    unit_cost: opts.rematchTargetUnitCost ?? opts.invoiceUnitPrice,
    pack_size: 1,
  })

  // Decoy "wrong" item the matcher initially landed on. NOT on the PO.
  const wrongItem = await createInventoryItem(tenant, {
    item_name: 'Wrong Item',
    unit_cost: opts.invoiceUnitPrice,
    pack_size: 1,
  })

  // PO with a line for the right item (qty matters for the variance).
  const po = await createPurchaseOrder(tenant, {
    supplier_id: supplier.id,
    inventory_item_id: rightItem.id,
    quantity_ordered: opts.poQtyOrdered,
    unit_cost: opts.invoiceUnitPrice,
    status: 'received',
  })

  // Invoice + invoice_item, initially matched to the wrong item.
  const invoice = await createInvoice(tenant, {
    supplier_id: supplier.id,
    status: 'pending_exceptions',
  })

  // Link the invoice to the PO so the re-match helper finds the PO.
  const { data: oimRow, error: oimErr } = await supabase
    .from('order_invoice_matches')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoice.id,
      purchase_order_id: po.id,
      match_method: 'manual',
      match_confidence: 1.0,
      status: 'pending',
    })
    .select('id')
    .single()
  if (oimErr || !oimRow) throw new Error(`oim insert failed: ${oimErr?.message}`)

  const { data: iiRow, error: iiErr } = await supabase
    .from('invoice_items')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoice.id,
      line_number: 1,
      item_description: 'Test line',
      quantity: opts.invoiceQty,
      unit_price: opts.invoiceUnitPrice,
      total_price: opts.invoiceQty * opts.invoiceUnitPrice,
      matched_item_id: wrongItem.id,
      match_method: 'fuzzy',
      match_confidence: 0.9,
    })
    .select('id')
    .single()
  if (iiErr || !iiRow) throw new Error(`invoice_item insert failed: ${iiErr?.message}`)

  // A no_item_match exception that the operator will resolve via match_item.
  const { data: excRow, error: excErr } = await supabase
    .from('invoice_exceptions')
    .insert({
      tenant_id: tenant.id,
      invoice_id: invoice.id,
      invoice_item_id: iiRow.id,
      exception_type: 'no_item_match',
      severity: 'block',
      status: 'open',
      exception_message: 'wrong match — operator should re-match',
      exception_context: {},
      pipeline_stage_at_creation: 'matching_items',
    })
    .select('id')
    .single()
  if (excErr || !excRow) throw new Error(`exception insert failed: ${excErr?.message}`)

  return {
    invoiceId: invoice.id,
    invoiceItemId: iiRow.id,
    exceptionId: excRow.id,
    rightInventoryId: rightItem.id,
    poId: po.id,
  }
}

describe('MOK-150 — re-match re-validation raises quantity_variance', () => {
  it('raises quantity_variance when operator re-matches to an item whose PO qty differs', async () => {
    // Invoice qty 4, PO qty 5 → 20% under-ship. Threshold default is 5%, so this is block.
    const setup = await setupInvoiceWithBadMatch({
      invoiceQty: 4,
      invoiceUnitPrice: 4.5,
      poQtyOrdered: 5,
    })

    const req = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${setup.exceptionId}/resolve`,
      body: {
        action: { type: 'match_item', inventory_item_id: setup.rightInventoryId },
        resolution_notes: 'Re-matched to correct item',
      },
    })
    const res = await resolvePOST(req, { params: Promise.resolve({ id: setup.exceptionId }) })
    expect(res.status).toBe(200)

    // Assert: a fresh quantity_variance exception exists for this invoice item
    // pointing at the new (right) match, with raised_by_rematch flag.
    const supabase = getServiceClient()
    const { data: qvRows } = await supabase
      .from('invoice_exceptions')
      .select('exception_type, severity, status, exception_context, exception_message')
      .eq('tenant_id', tenant.id)
      .eq('invoice_item_id', setup.invoiceItemId)
      .eq('exception_type', 'quantity_variance')

    expect(qvRows ?? []).toHaveLength(1)
    const qv = qvRows![0]
    expect(qv.severity).toBe('block')
    expect(qv.status).toBe('open')
    const ctx = qv.exception_context as Record<string, unknown>
    expect(ctx.raised_by_rematch).toBe(true)
    expect(ctx.po_quantity).toBe(5)
    expect(ctx.invoice_quantity).toBe(4)
    expect(qv.exception_message).toMatch(/differs from PO/)
  })

  it('raises NOTHING when re-match target has matching PO qty', async () => {
    const setup = await setupInvoiceWithBadMatch({
      invoiceQty: 5,
      invoiceUnitPrice: 4.5,
      poQtyOrdered: 5,
    })

    const req = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${setup.exceptionId}/resolve`,
      body: {
        action: { type: 'match_item', inventory_item_id: setup.rightInventoryId },
        resolution_notes: 'Re-matched',
      },
    })
    const res = await resolvePOST(req, { params: Promise.resolve({ id: setup.exceptionId }) })
    expect(res.status).toBe(200)

    const supabase = getServiceClient()
    const { data: qvRows } = await supabase
      .from('invoice_exceptions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('invoice_item_id', setup.invoiceItemId)
      .eq('exception_type', 'quantity_variance')

    expect(qvRows ?? []).toHaveLength(0)
  })

  it('raises NOTHING when re-match target has no PO line at all', async () => {
    const setup = await setupInvoiceWithBadMatch({
      invoiceQty: 4,
      invoiceUnitPrice: 4.5,
      poQtyOrdered: 5,
    })
    // Re-match to a THIRD item that's not on the PO (instead of `rightInventoryId`).
    const supabase = getServiceClient()
    const orphan = await createInventoryItem(tenant, {
      item_name: 'Orphan',
      unit_cost: 4.5,
      pack_size: 1,
    })

    const req = buildAuthedRequest({
      tenant,
      method: 'POST',
      url: `/api/admin/invoice-exceptions/${setup.exceptionId}/resolve`,
      body: {
        action: { type: 'match_item', inventory_item_id: orphan.id },
        resolution_notes: 'Re-matched to off-PO item',
      },
    })
    const res = await resolvePOST(req, { params: Promise.resolve({ id: setup.exceptionId }) })
    expect(res.status).toBe(200)

    const { data: qvRows } = await supabase
      .from('invoice_exceptions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('invoice_item_id', setup.invoiceItemId)
      .eq('exception_type', 'quantity_variance')

    expect(qvRows ?? []).toHaveLength(0)
  })
})
