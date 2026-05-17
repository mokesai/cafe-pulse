/**
 * MOK-156 / KDS v3 phase 4 — integration tests for the aesthetic image
 * library routes.
 *
 * Plan: .planning/kds-v3/PHASE-4-PLAN.md (T8)
 *
 * Covers:
 *   E1. POST /external creates a source_kind='external' row
 *   E2. POST /external rejects 400 on non-HTTPS URL
 *   E3. POST /external rejects 400 on empty name
 *   E4. POST /upload rejects 400 on oversize file
 *   E5. POST /upload rejects 400 on non-image mime type
 *   L1. GET / lists tenant's images
 *   L2. GET / tenant isolation: doesn't return other tenant's rows
 *   P1. PATCH /[id] updates name + alt_text; immutable fields unchanged
 *   D1. DELETE /[id] soft-deletes (is_deleted=true; row still present)
 *
 * The actual storage upload happy path is exercised by the T9 manual walk
 * against bigcafe — these tests focus on route-level validation, which is
 * the boundary we care about for safety. (Testing the third-party
 * supabase.storage.upload() call doesn't add signal here.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as listGET } from '@/app/api/admin/kds-v3/aesthetic-images/route'
import { POST as externalPOST } from '@/app/api/admin/kds-v3/aesthetic-images/external/route'
import { POST as uploadPOST } from '@/app/api/admin/kds-v3/aesthetic-images/upload/route'
import {
  PATCH as itemPATCH,
  DELETE as itemDELETE,
} from '@/app/api/admin/kds-v3/aesthetic-images/[id]/route'

import {
  buildAuthedRequest,
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  seedTestAestheticImage,
  type TestTenant,
} from './helpers/tenant'

let tenantA: TestTenant
let tenantB: TestTenant

beforeAll(async () => {
  tenantA = await createTenantForTest('kds-v3-aimg-a')
  tenantB = await createTenantForTest('kds-v3-aimg-b')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function clearImages(tenantId: string) {
  const supabase = getServiceClient()
  await supabase.from('kds_aesthetic_images').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  await Promise.all([clearImages(tenantA.id), clearImages(tenantB.id)])
})

function reqJson(tenant: TestTenant, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  return buildAuthedRequest({ tenant, method, url, body })
}

// Build a multipart request manually. buildAuthedRequest takes a body and a
// JSON content-type by default — for multipart we need to construct via the
// FormData → Request pipeline.
function reqMultipart(tenant: TestTenant, url: string, form: FormData) {
  const base = buildAuthedRequest({ tenant, method: 'POST', url })
  const headers = new Headers(base.headers)
  headers.delete('content-type') // let the FormData polyfill set the boundary
  return new Request(base.url, {
    method: 'POST',
    headers,
    body: form,
  }) as unknown as Parameters<typeof uploadPOST>[0]
}

describe('MOK-156 — kds-v3 aesthetic-images routes', () => {
  // E1
  it('POST /external creates a source_kind="external" row', async () => {
    const res = await externalPOST(
      reqJson(tenantA, 'POST', '/api/admin/kds-v3/aesthetic-images/external', {
        name: 'Seasonal banner',
        external_url: 'https://example.com/banner.png',
        alt_text: 'A banner',
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.source_kind).toBe('external')
    expect(body.data.external_url).toBe('https://example.com/banner.png')
    expect(body.data.alt_text).toBe('A banner')
    expect(body.data.storage_path).toBeNull()
    expect(body.data.thumbnail_url).toBe('https://example.com/banner.png')
  })

  // E2
  it('POST /external returns 400 on non-HTTPS URL', async () => {
    const res = await externalPOST(
      reqJson(tenantA, 'POST', '/api/admin/kds-v3/aesthetic-images/external', {
        name: 'Bad',
        external_url: 'http://example.com/insecure.png',
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('KDS_AESTHETIC_IMAGE_BAD_REQUEST')
    expect((body.validation_errors as string[]).some((e) => /https/.test(e))).toBe(true)
  })

  // E3
  it('POST /external returns 400 on empty name', async () => {
    const res = await externalPOST(
      reqJson(tenantA, 'POST', '/api/admin/kds-v3/aesthetic-images/external', {
        name: '',
        external_url: 'https://example.com/x.png',
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect((body.validation_errors as string[]).some((e) => /name is required/.test(e))).toBe(true)
  })

  // E4
  it('POST /upload returns 400 on oversize file (> 5 MB)', async () => {
    // Build a 6 MB blob to exceed the cap
    const bigBytes = new Uint8Array(6 * 1024 * 1024)
    const bigFile = new File([bigBytes], 'big.png', { type: 'image/png' })
    const form = new FormData()
    form.append('file', bigFile)
    form.append('name', 'Too big')

    const res = await uploadPOST(reqMultipart(tenantA, '/api/admin/kds-v3/aesthetic-images/upload', form))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('KDS_AESTHETIC_IMAGE_BAD_REQUEST')
    expect((body.validation_errors as string[]).some((e) => /<= 5242880 bytes/.test(e))).toBe(true)
  })

  // E5
  it('POST /upload returns 400 on non-image mime type', async () => {
    const blob = new File([new Uint8Array(100)], 'doc.pdf', { type: 'application/pdf' })
    const form = new FormData()
    form.append('file', blob)
    form.append('name', 'Not an image')

    const res = await uploadPOST(reqMultipart(tenantA, '/api/admin/kds-v3/aesthetic-images/upload', form))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect((body.validation_errors as string[]).some((e) => /mime type/.test(e))).toBe(true)
  })

  // L1
  it('GET / lists the tenant images including is_deleted=true', async () => {
    const live = await seedTestAestheticImage(tenantA, { name: 'Live one' })
    const dead = await seedTestAestheticImage(tenantA, { name: 'Dead one', is_deleted: true })

    const res = await listGET(reqJson(tenantA, 'GET', '/api/admin/kds-v3/aesthetic-images'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const rows = body.data as Array<{ id: string; name: string; is_deleted: boolean }>
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(live.id)?.is_deleted).toBe(false)
    expect(byId.get(dead.id)?.is_deleted).toBe(true)
  })

  // L2
  it('GET / returns ONLY the calling tenant rows', async () => {
    const aImg = await seedTestAestheticImage(tenantA, { name: 'A image' })
    const bImg = await seedTestAestheticImage(tenantB, { name: 'B image' })

    const resA = await listGET(reqJson(tenantA, 'GET', '/api/admin/kds-v3/aesthetic-images'))
    const bodyA = await resA.json()
    const idsA = (bodyA.data as Array<{ id: string }>).map((r) => r.id)
    expect(idsA).toContain(aImg.id)
    expect(idsA).not.toContain(bImg.id)

    const resB = await listGET(reqJson(tenantB, 'GET', '/api/admin/kds-v3/aesthetic-images'))
    const bodyB = await resB.json()
    const idsB = (bodyB.data as Array<{ id: string }>).map((r) => r.id)
    expect(idsB).toContain(bImg.id)
    expect(idsB).not.toContain(aImg.id)
  })

  // P1
  it('PATCH /[id] updates name + alt_text without touching immutable fields', async () => {
    const img = await seedTestAestheticImage(tenantA, {
      name: 'Original',
      external_url: 'https://example.com/original.png',
    })

    const res = await itemPATCH(
      reqJson(tenantA, 'PATCH', `/api/admin/kds-v3/aesthetic-images/${img.id}`, {
        name: 'Renamed',
        alt_text: 'New alt',
      }),
      { params: Promise.resolve({ id: img.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.name).toBe('Renamed')
    expect(body.data.alt_text).toBe('New alt')
    // Immutable: external_url, source_kind unchanged
    expect(body.data.external_url).toBe('https://example.com/original.png')
    expect(body.data.source_kind).toBe('external')
  })

  // D1
  it('DELETE /[id] soft-deletes (row still present, is_deleted=true)', async () => {
    const img = await seedTestAestheticImage(tenantA, { name: 'Doomed' })

    const res = await itemDELETE(
      reqJson(tenantA, 'DELETE', `/api/admin/kds-v3/aesthetic-images/${img.id}`),
      { params: Promise.resolve({ id: img.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.is_deleted).toBe(true)

    // Row still readable via service client
    const supabase = getServiceClient()
    const { data: row } = await supabase
      .from('kds_aesthetic_images')
      .select('id, is_deleted')
      .eq('id', img.id)
      .single()
    expect(row?.is_deleted).toBe(true)
  })

  it('PATCH /[id] returns 404 for cross-tenant request', async () => {
    const bImg = await seedTestAestheticImage(tenantB, { name: 'B image' })

    const res = await itemPATCH(
      reqJson(tenantA, 'PATCH', `/api/admin/kds-v3/aesthetic-images/${bImg.id}`, { name: 'Stolen' }),
      { params: Promise.resolve({ id: bImg.id }) },
    )
    expect(res.status).toBe(404)
  })
})
