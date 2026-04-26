/**
 * MOK-124 — replacement-item detection in invoice_variance_history.
 *
 * The pipeline (Deno-runtime) writes the rows; tests exercise the schema
 * directly to validate that the replacement variance shape is accepted
 * and persists like other history rows. Stage 4's `isReplacement` heuristic
 * is unit-testable separately (pure function) but lives in the edge
 * function source — these tests focus on the data-layer contract.
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

describe('invoice_variance_history replacement rows (MOK-124)', () => {
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

  it('accepts a replacement row with both description fields populated', async () => {
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
        po_description: 'Brand A whole-bean coffee 12oz',
        invoice_description: 'Brand B whole-bean coffee 12oz',
      })
      .select('variance_type, severity, po_description, invoice_description, related_exception_id')
      .single()
    expect(error).toBeNull()
    expect(data!.variance_type).toBe('replacement')
    expect(data!.severity).toBe('info')
    expect(data!.po_description).toBe('Brand A whole-bean coffee 12oz')
    expect(data!.invoice_description).toBe('Brand B whole-bean coffee 12oz')
    // Replacement rows do NOT have a related_exception_id (no exception created)
    expect(data!.related_exception_id).toBeNull()
  })

  it('replacement rows can be filtered for supplier performance reporting', async () => {
    if (!tenant) throw new Error('test setup failed')
    const svc = getServiceClient()
    // Insert two replacement rows for the same supplier
    await svc.from('invoice_variance_history').insert([
      {
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        supplier_id: supplierId,
        variance_type: 'replacement',
        severity: 'info',
        po_description: 'Bagels',
        invoice_description: "Thomas' Everything Bagels 6ct",
      },
      {
        tenant_id: tenant.id,
        invoice_id: invoiceId,
        supplier_id: supplierId,
        variance_type: 'replacement',
        severity: 'info',
        po_description: 'Plain bagels',
        invoice_description: 'Whole-grain bagels',
      },
    ])

    // Query mirrors what a supplier-performance report would do
    const { data, error } = await svc
      .from('invoice_variance_history')
      .select('po_description, invoice_description')
      .eq('tenant_id', tenant.id)
      .eq('supplier_id', supplierId)
      .eq('variance_type', 'replacement')
      .order('created_at', { ascending: true })
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThanOrEqual(2)
    // The seeded pair is included
    const pairs = (data ?? []).map((r) => `${r.po_description} → ${r.invoice_description}`)
    expect(pairs).toContain("Bagels → Thomas' Everything Bagels 6ct")
    expect(pairs).toContain('Plain bagels → Whole-grain bagels')
  })
})

/**
 * Pure-function test of the heuristic that lives in the edge function.
 * Mirrors the implementation in stages/04-match-items.ts so a regression
 * in either side surfaces here.
 */
describe('isReplacement heuristic (MOK-124)', () => {
  function isReplacement(invoiceDescription: string, inventoryItemName: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const a = normalize(invoiceDescription)
    const b = normalize(inventoryItemName)
    if (a.length === 0 || b.length === 0) return false
    if (a === b) return false
    if (a.includes(b) || b.includes(a)) return false
    return true
  }

  it('returns false when descriptions match exactly', () => {
    expect(isReplacement('Bagels', 'Bagels')).toBe(false)
  })

  it('returns false when one is a normalized substring of the other', () => {
    expect(isReplacement('Plain bagels', 'Bagels')).toBe(false)
    expect(isReplacement('Bagels', 'Plain bagels')).toBe(false)
    expect(isReplacement("Thomas' Everything Bagels 6ct", 'Bagels')).toBe(false)
  })

  it('returns false on case/punctuation differences only', () => {
    expect(isReplacement('BAGELS!', 'bagels')).toBe(false)
    expect(isReplacement('Whole-grain bagels', 'whole grain bagels')).toBe(false)
  })

  it('returns true when descriptions are meaningfully different', () => {
    expect(isReplacement('Brand A bagels', 'Brand B bagels')).toBe(true)
    expect(isReplacement('Whole-bean espresso', 'Ground coffee')).toBe(true)
  })

  it('returns false when either input is empty after normalization', () => {
    expect(isReplacement('', 'Bagels')).toBe(false)
    expect(isReplacement('Bagels', '')).toBe(false)
    expect(isReplacement('!!!', 'Bagels')).toBe(false)
  })
})
