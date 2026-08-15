/**
 * C1 / MOK-177 — the COGS seed harness produces a coherent dataset that exercises the Cluster-A
 * cases. Runs a small (7-day) seed against an ephemeral tenant and asserts the shape, then resets.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seedDemoData, resetTenantData } from '../../scripts/seed-cogs-dataset'
import {
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

let tenant: TestTenant
let result: Awaited<ReturnType<typeof seedDemoData>>

beforeAll(async () => {
  tenant = await createTenantForTest('cogsseed')
  result = await seedDemoData(getServiceClient(), tenant.id, { days: 7, adminId: tenant.adminUserId })
}, 60_000)

afterAll(async () => {
  await resetTenantData(getServiceClient(), tenant.id)
  await cleanupTenant(tenant)
})

describe('seed-cogs-dataset — C1 (MOK-177)', () => {
  it('seeds suppliers, inventory, invoices, and one daily summary per day', () => {
    expect(result.suppliers).toBe(4)
    expect(result.inventory).toBeGreaterThanOrEqual(20)
    expect(result.invoices).toBeGreaterThan(0)
    expect(result.dailySummaries).toBe(7)
  })

  it('seeds daily COGS summaries the dashboard can read (chained, non-zero)', async () => {
    const { data } = await getServiceClient()
      .from('ai_cogs_daily_summaries')
      .select('summary_date, periodic_cogs, ending_inventory_value')
      .eq('tenant_id', tenant.id)
    expect(data?.length).toBe(7)
    expect((data ?? []).every((r) => Number(r.ending_inventory_value) > 0)).toBe(true)
  })

  it('covers A2 — two package_label products on one square_item_id for one supplier', async () => {
    const { data } = await getServiceClient()
      .from('inventory_items')
      .select('package_label, pack_size, supplier_id')
      .eq('tenant_id', tenant.id)
      .eq('square_item_id', 'demo-sq-cokezero')
      .gt('pack_size', 1)
    const labels = (data ?? []).map((r) => r.package_label).filter(Boolean).sort()
    expect(labels).toEqual(['From variety pack', 'Standalone case'])
    expect(new Set((data ?? []).map((r) => r.supplier_id)).size).toBe(1)
    expect(new Set((data ?? []).map((r) => Number(r.pack_size)))).toEqual(new Set([12]))
  })

  it('covers A3 — non-divisible package_cost preserved, unit_cost derived', async () => {
    const { data } = await getServiceClient()
      .from('inventory_items')
      .select('package_cost, unit_cost')
      .eq('tenant_id', tenant.id)
      .eq('item_name', 'Blueberry Muffin 3pk')
      .single()
    expect(Number(data!.package_cost)).toBe(5)
    expect(Number(data!.unit_cost)).toBeCloseTo(1.6667, 4)
  })

  it('covers A1 — variance history in both tiers (info + block)', async () => {
    const { data } = await getServiceClient()
      .from('invoice_variance_history')
      .select('severity')
      .eq('tenant_id', tenant.id)
      .eq('variance_type', 'price_variance')
    const severities = new Set((data ?? []).map((r) => r.severity))
    expect(severities.has('info')).toBe(true)
    expect(severities.has('block')).toBe(true)
  })

  it('covers the pack-pair invariant — single + pack share a square_item_id', async () => {
    const { data } = await getServiceClient()
      .from('inventory_items')
      .select('pack_size')
      .eq('tenant_id', tenant.id)
      .eq('square_item_id', 'demo-sq-croissant')
    const sizes = new Set((data ?? []).map((r) => Number(r.pack_size)))
    expect(sizes.has(1)).toBe(true)
    expect(sizes.has(4)).toBe(true)
  })
})
