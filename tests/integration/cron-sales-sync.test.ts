/**
 * A4 / MOK-172 — the scheduled /api/cron/sales-sync job runs runSalesSync per active tenant.
 *
 * Coverage (kept side-effect-free by scoping to a freshly-created tenant with no Square config,
 * which runSalesSync treats as a skip — so we never touch real tenants' Square accounts):
 *   - rejects requests without the CRON_SECRET bearer (401)
 *   - with the secret, runs and reports tenants with no Square config as 'skipped'
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import { GET as cronGET } from '@/app/api/cron/sales-sync/route'
import { cleanupTenant, createTenantForTest, type TestTenant } from './helpers/tenant'

const SECRET = 'test-cron-secret-mok172'
let tenant: TestTenant

beforeAll(async () => {
  process.env.CRON_SECRET = SECRET
  tenant = await createTenantForTest('cronsales')
})

afterAll(async () => {
  await cleanupTenant(tenant)
})

function cronReq(opts: { auth?: string; tenantId?: string }) {
  const url = new URL('http://localhost/api/cron/sales-sync')
  if (opts.tenantId) url.searchParams.set('tenant_id', opts.tenantId)
  const headers = new Headers()
  if (opts.auth) headers.set('authorization', opts.auth)
  return new NextRequest(url, { method: 'GET', headers })
}

describe('cron/sales-sync — MOK-172 scheduled sales sync', () => {
  it('rejects requests without the cron secret', async () => {
    const res = await cronGET(cronReq({}))
    expect(res.status).toBe(401)
  })

  it('rejects a wrong bearer', async () => {
    const res = await cronGET(cronReq({ auth: 'Bearer nope' }))
    expect(res.status).toBe(401)
  })

  it('runs with the cron secret and skips tenants without Square configured', async () => {
    const res = await cronGET(cronReq({ auth: `Bearer ${SECRET}`, tenantId: tenant.id }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.tenants).toBe(1)
    const result = (body.results as Array<{ tenant_id: string; status: string }>).find(
      (r) => r.tenant_id === tenant.id,
    )
    expect(result?.status).toBe('skipped') // no Square config → no-op, no side effects
  })
})
