import { describe, it, expect } from 'vitest'

import { getServiceClient } from './helpers/tenant'

// MOK-113: tenant_id columns on tenant-scoped tables no longer have a DEFAULT.
// Inserting a row without tenant_id now raises a NOT NULL violation instead of
// silently landing on the littlecafe tenant (id = 00000000-...-000001).
// This guards against a regression where someone re-adds the default in a future
// migration.
describe('tenant_id defaults are dropped (MOK-113)', () => {
  it('INSERT into suppliers without tenant_id raises NOT NULL violation', async () => {
    const svc = getServiceClient()
    const { error } = await svc
      .from('suppliers')
      .insert({ name: 'Regression Test — no tenant_id', is_active: true })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23502') // not_null_violation
    expect(error!.message.toLowerCase()).toContain('tenant_id')
  })

  it('INSERT into inventory_items without tenant_id raises NOT NULL violation', async () => {
    const svc = getServiceClient()
    const { error } = await svc
      .from('inventory_items')
      .insert({
        square_item_id: 'regression-test-no-tenant',
        item_name: 'Regression Test',
        current_stock: 0,
      })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23502')
    expect(error!.message.toLowerCase()).toContain('tenant_id')
  })
})
