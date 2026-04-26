/**
 * MOK-122 — invoice_variance_history shadow table behavior.
 *
 * The pipeline (Deno-runtime) writes to this table; tests exercise the
 * schema directly to validate columns, constraints, and the persistence
 * guarantee that distinguishes history rows from exceptions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  cleanupTenant,
  createInvoice,
  createSupplier,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

describe('invoice_variance_history (MOK-122)', () => {
  let tenant: TestTenant | undefined
  let invoiceId: string
  let supplierId: string

  beforeAll(async () => {
    tenant = await createTenantForTest()
    if (!tenant) throw new Error('test setup failed')
    const supplier = await createSupplier(tenant)
    supplierId = supplier.id
    const invoice = await createInvoice(tenant, { supplier_id: supplier.id })
    invoiceId = invoice.id
  })

  afterAll(async () => {
    await cleanupTenant(tenant)
  })

  it('accepts a quantity_variance row with severity=block', async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()
    const { data, error } = await svc
      .from('invoice_variance_history')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        supplier_id: supplierId,
        variance_type: 'quantity_variance',
        severity: 'block',
        po_quantity: 10,
        invoice_quantity: 8,
        variance_pct: 20,
        threshold_pct: 5,
      })
      .select('id, variance_type, severity')
      .single()
    expect(error).toBeNull()
    expect(data!.variance_type).toBe('quantity_variance')
    expect(data!.severity).toBe('block')
  })

  it('accepts a price_variance row with severity=info (sub-threshold)', async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()
    const { data, error } = await svc
      .from('invoice_variance_history')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        supplier_id: supplierId,
        variance_type: 'price_variance',
        severity: 'info',
        po_unit_cost: 10,
        invoice_unit_price: 10.3,
        variance_pct: 3,
        threshold_pct: 5,
      })
      .select('id, severity')
      .single()
    expect(error).toBeNull()
    expect(data!.severity).toBe('info')
  })

  it('accepts a replacement row with description fields', async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()
    const { data, error } = await svc
      .from('invoice_variance_history')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        supplier_id: supplierId,
        variance_type: 'replacement',
        severity: 'info',
        po_description: 'Brand A bagels 12-pack',
        invoice_description: 'Brand B bagels 12-pack',
      })
      .select('variance_type, po_description, invoice_description')
      .single()
    expect(error).toBeNull()
    expect(data!.variance_type).toBe('replacement')
    expect(data!.po_description).toBe('Brand A bagels 12-pack')
    expect(data!.invoice_description).toBe('Brand B bagels 12-pack')
  })

  it('rejects unknown variance_type values', async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()
    const { error } = await svc
      .from('invoice_variance_history')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        variance_type: 'mystery_variance',
        severity: 'info',
      })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23514') // CHECK violation
  })

  it('rejects unknown severity values', async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()
    const { error } = await svc
      .from('invoice_variance_history')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        variance_type: 'quantity_variance',
        severity: 'critical',
      })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23514')
  })

  it("preserves history row even after the linked exception is deleted (ON DELETE SET NULL)", async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()

    // Create an exception, link a history row to it
    const { data: exc } = await svc
      .from('invoice_exceptions')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        exception_type: 'quantity_variance',
        exception_message: 'Test exception for cascade test',
        exception_context: {},
        status: 'open',
        pipeline_stage_at_creation: 'matching_items',
        severity: 'block',
      })
      .select('id')
      .single()

    const { data: history } = await svc
      .from('invoice_variance_history')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        variance_type: 'quantity_variance',
        severity: 'block',
        related_exception_id: exc!.id,
      })
      .select('id, related_exception_id')
      .single()
    expect(history!.related_exception_id).toBe(exc!.id)

    // Delete the exception
    await svc.from('invoice_exceptions').delete().eq('id', exc!.id)

    // History row still exists; related_exception_id is now NULL (per FK ON DELETE SET NULL)
    const { data: stillHere } = await svc
      .from('invoice_variance_history')
      .select('id, related_exception_id')
      .eq('id', history!.id)
      .single()
    expect(stillHere).not.toBeNull()
    expect(stillHere!.related_exception_id).toBeNull()
  })
})
