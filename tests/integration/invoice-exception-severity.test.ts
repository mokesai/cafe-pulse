/**
 * MOK-121 — invoice_exceptions.severity behavior
 *
 * Validates the new column's constraints and defaults at the database level.
 * The edge function's createException helper (`exceptions.ts`) is Deno-runtime
 * code that's not easily importable into Vitest, so these tests exercise the
 * underlying schema directly.
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

describe('invoice_exceptions.severity (MOK-121)', () => {
  let tenant: TestTenant | undefined
  let invoiceId: string

  beforeAll(async () => {
    tenant = await createTenantForTest()
    if (!tenant) throw new Error('test setup failed')
    const supplier = await createSupplier(tenant)
    const invoice = await createInvoice(tenant, { supplier_id: supplier.id })
    invoiceId = invoice.id
  })

  afterAll(async () => {
    await cleanupTenant(tenant)
  })

  it("defaults severity to 'block' when not specified", async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()
    const { data, error } = await svc
      .from('invoice_exceptions')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        exception_type: 'no_supplier_match',
        exception_message: 'Default severity test',
        exception_context: {},
        status: 'open',
        pipeline_stage_at_creation: 'resolving_supplier',
      })
      .select('severity')
      .single()
    expect(error).toBeNull()
    expect(data!.severity).toBe('block')
  })

  it("accepts severity='info'", async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()
    const { data, error } = await svc
      .from('invoice_exceptions')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        exception_type: 'quantity_variance',
        exception_message: 'Info-severity test',
        exception_context: { variance_pct: 2 },
        status: 'open',
        pipeline_stage_at_creation: 'matching_items',
        severity: 'info',
      })
      .select('severity')
      .single()
    expect(error).toBeNull()
    expect(data!.severity).toBe('info')
  })

  it("rejects invalid severity values", async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()
    const { error } = await svc
      .from('invoice_exceptions')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        exception_type: 'no_po_match',
        exception_message: 'Invalid severity test',
        exception_context: {},
        status: 'open',
        pipeline_stage_at_creation: 'matching_po',
        severity: 'critical',
      })
    expect(error).not.toBeNull()
    // Postgres CHECK violation
    expect(error!.code).toBe('23514')
  })
})
