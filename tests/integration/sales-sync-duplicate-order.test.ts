/**
 * MOK-185 — sales-sync must skip, not crash, when a Square order is already recorded.
 *
 * sales_transactions.square_order_id carries a GLOBAL unique constraint that predates
 * multi-tenancy. The sweep-all-tenants cron hit an order already stored under one tenant while
 * syncing another; the old tenant-scoped dedup check missed it and the insert threw 23505,
 * aborting the whole run. Regression: insertSalesTransaction treats any pre-existing order id
 * (same OR different tenant) as an already-synced skip and never throws / never double-inserts.
 */
import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { insertSalesTransaction } from '@/lib/square/sales-sync'
import {
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  type TestTenant,
} from './helpers/tenant'

type OrderArg = Parameters<typeof insertSalesTransaction>[2]

let tenantA: TestTenant
let tenantB: TestTenant

beforeAll(async () => {
  ;[tenantA, tenantB] = await Promise.all([
    createTenantForTest('salesdupa'),
    createTenantForTest('salesdupb'),
  ])
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function seedSalesTransaction(tenant: TestTenant, squareOrderId: string) {
  const supabase = getServiceClient()
  const { error } = await supabase.from('sales_transactions').insert({
    tenant_id: tenant.id,
    square_order_id: squareOrderId,
    location_id: 'L-TEST',
    ordered_at: new Date().toISOString(),
    raw_payload: {},
  })
  if (error) throw new Error(`seed sales_transaction failed: ${error.message}`)
}

function fakeOrder(id: string): OrderArg {
  return {
    id,
    location_id: 'L-TEST',
    created_at: new Date().toISOString(),
    line_items: [],
  } as OrderArg
}

async function countByOrderId(squareOrderId: string): Promise<number> {
  const supabase = getServiceClient()
  const { count } = await supabase
    .from('sales_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('square_order_id', squareOrderId)
  return count ?? 0
}

describe('sales-sync duplicate order handling (MOK-185)', () => {
  it('skips an order already recorded under a DIFFERENT tenant instead of throwing', async () => {
    const orderId = `dup-x-${crypto.randomBytes(6).toString('hex')}`
    await seedSalesTransaction(tenantA, orderId)

    // Tenant B's sync sees the same Square order (shared-credential case). Must not throw.
    const result = await insertSalesTransaction(
      getServiceClient(),
      tenantB.id,
      fakeOrder(orderId),
      crypto.randomUUID(),
      false,
    )

    expect(result?.wasInserted).toBe(false)
    // No second row — an insert would have violated the global unique constraint (the old bug).
    expect(await countByOrderId(orderId)).toBe(1)
  })

  it('skips an order already recorded under the SAME tenant', async () => {
    const orderId = `dup-s-${crypto.randomBytes(6).toString('hex')}`
    await seedSalesTransaction(tenantA, orderId)

    const result = await insertSalesTransaction(
      getServiceClient(),
      tenantA.id,
      fakeOrder(orderId),
      crypto.randomUUID(),
      false,
    )

    expect(result?.wasInserted).toBe(false)
    expect(await countByOrderId(orderId)).toBe(1)
  })
})
