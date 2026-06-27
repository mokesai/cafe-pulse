/**
 * MOK-159 / KDS v3 phase 6.5 — publish + discard-draft route + render-source
 * selection integration tests.
 *
 * Plan: .planning/kds-v3/PHASE-6.5-PLAN.md (T7)
 *
 * Covers (paraphrasing acceptance criteria):
 *   1. Publish creates published snapshot when none exists; diff reflects all
 *      boxes as `added`
 *   2. Publish replaces existing snapshot; diff reflects changed boxes
 *   3. Discard-draft 422 when no published version exists
 *   4. Discard-draft replaces draft from published; ticks draft_updated_at to
 *      published_at so the unpublished flag flips off
 *   5. Cross-tenant publish: tenant A calling on tenant B's screen → 404
 *   6. resolveScreenForRender source='published' vs source='draft' return
 *      different data after draft diverges from published
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'

import { POST as publishPOST } from '@/app/api/admin/kds-v3/screens/[id]/publish/route'
import { POST as discardPOST } from '@/app/api/admin/kds-v3/screens/[id]/discard-draft/route'
import { resolveScreenForRender } from '@/lib/kds/v3-render'

import {
  buildAuthedRequest,
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  seedTestMenuGroup,
  type TestTenant,
} from './helpers/tenant'

let tenantA: TestTenant
let tenantB: TestTenant

beforeAll(async () => {
  tenantA = await createTenantForTest('kds-v3-pub-a')
  tenantB = await createTenantForTest('kds-v3-pub-b')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function clearAll(tenantId: string) {
  const supabase = getServiceClient()
  await supabase.from('kds_published_grid_boxes').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_published_screens').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_grid_boxes').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_screens').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  await Promise.all([clearAll(tenantA.id), clearAll(tenantB.id)])
})

async function seedScreen(tenant: TestTenant, opts: { name?: string } = {}) {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('kds_screens')
    .insert({
      tenant_id: tenant.id,
      name: opts.name ?? `Test ${crypto.randomBytes(3).toString('hex')}`,
      grid_rows: 4,
      grid_cols: 4,
      theme: 'warm',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedScreen: ${error?.message}`)
  return data.id as string
}

async function seedBox(
  tenant: TestTenant,
  screenId: string,
  position: number,
  layoutMode = 'simple_list',
  groupId: string | null = null,
) {
  const supabase = getServiceClient()
  const { error } = await supabase.from('kds_grid_boxes').insert({
    tenant_id: tenant.id,
    screen_id: screenId,
    position,
    row_start: position,
    col_start: 1,
    row_span: 1,
    col_span: 1,
    box_type: 'menu_group',
    square_menu_group_id: groupId,
    layout_mode: layoutMode,
    price_display_mode: 'lowest',
    density: 'normal',
    title_size: 'medium',
    title_align: 'left',
  })
  if (error) throw new Error(`seedBox: ${error.message}`)
}

function req(tenant: TestTenant, method: 'POST', url: string) {
  return buildAuthedRequest({ tenant, method, url })
}

describe('MOK-159 — publish + discard-draft routes', () => {
  // 1
  it('publish creates a published snapshot when none exists', async () => {
    const screenId = await seedScreen(tenantA)
    await seedBox(tenantA, screenId, 1)
    await seedBox(tenantA, screenId, 2)

    const res = await publishPOST(
      req(tenantA, 'POST', `/api/admin/kds-v3/screens/${screenId}/publish`),
      { params: Promise.resolve({ id: screenId }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.published_at).toBeTruthy()
    expect(body.data.diff).toEqual({ added: 2, changed: 0, removed: 0 })

    const supabase = getServiceClient()
    const { count } = await supabase
      .from('kds_published_grid_boxes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantA.id)
      .eq('screen_id', screenId)
    expect(count).toBe(2)
  })

  // 2
  it('publish replaces existing snapshot; diff reflects changed boxes', async () => {
    const supabase = getServiceClient()
    const screenId = await seedScreen(tenantA)
    await seedBox(tenantA, screenId, 1, 'simple_list')

    // First publish.
    await publishPOST(
      req(tenantA, 'POST', `/api/admin/kds-v3/screens/${screenId}/publish`),
      { params: Promise.resolve({ id: screenId }) },
    )

    // Mutate the draft box; second publish should report it as changed.
    await supabase
      .from('kds_grid_boxes')
      .update({ layout_mode: 'flavor_list' })
      .eq('tenant_id', tenantA.id)
      .eq('screen_id', screenId)
      .eq('position', 1)

    const res = await publishPOST(
      req(tenantA, 'POST', `/api/admin/kds-v3/screens/${screenId}/publish`),
      { params: Promise.resolve({ id: screenId }) },
    )
    const body = await res.json()
    expect(body.data.diff).toEqual({ added: 0, changed: 1, removed: 0 })
  })

  // 3
  it('discard-draft returns 422 when no published version exists', async () => {
    const screenId = await seedScreen(tenantA)
    const res = await discardPOST(
      req(tenantA, 'POST', `/api/admin/kds-v3/screens/${screenId}/discard-draft`),
      { params: Promise.resolve({ id: screenId }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('KDS_NO_PUBLISHED_VERSION')
  })

  // 4
  it('discard-draft replaces draft from published; draft_updated_at == published_at', async () => {
    const supabase = getServiceClient()
    const screenId = await seedScreen(tenantA)
    await seedBox(tenantA, screenId, 1, 'simple_list')

    // Publish baseline.
    await publishPOST(
      req(tenantA, 'POST', `/api/admin/kds-v3/screens/${screenId}/publish`),
      { params: Promise.resolve({ id: screenId }) },
    )

    // Diverge: add a second draft box. The published snapshot still has 1.
    await seedBox(tenantA, screenId, 2, 'compact_list')
    await supabase
      .from('kds_screens')
      .update({ draft_updated_at: new Date(Date.now() + 60_000).toISOString() })
      .eq('id', screenId)

    // Discard.
    const res = await discardPOST(
      req(tenantA, 'POST', `/api/admin/kds-v3/screens/${screenId}/discard-draft`),
      { params: Promise.resolve({ id: screenId }) },
    )
    expect(res.status).toBe(200)

    // Draft should now have only 1 box again.
    const { count } = await supabase
      .from('kds_grid_boxes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantA.id)
      .eq('screen_id', screenId)
    expect(count).toBe(1)

    // draft_updated_at should equal the published_at (badge → "Up to date").
    const { data: draftScreen } = await supabase
      .from('kds_screens')
      .select('draft_updated_at')
      .eq('id', screenId)
      .single()
    const { data: pubScreen } = await supabase
      .from('kds_published_screens')
      .select('published_at')
      .eq('id', screenId)
      .single()
    expect(draftScreen?.draft_updated_at).toBe(pubScreen?.published_at)
  })

  // 5
  it('cross-tenant publish returns 404', async () => {
    const screenIdB = await seedScreen(tenantB)
    // Tenant A authenticates, hits publish on tenant B's screen.
    const res = await publishPOST(
      req(tenantA, 'POST', `/api/admin/kds-v3/screens/${screenIdB}/publish`),
      { params: Promise.resolve({ id: screenIdB }) },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('KDS_SCREEN_NOT_FOUND')
  })

  // 6
  it('source selection: published vs draft return different data after draft diverges', async () => {
    const supabase = getServiceClient()
    const screenId = await seedScreen(tenantA, { name: 'SourceSelect' })
    // Bind to a real menu group so resolveScreenForRender returns
    // kind: 'menu_group' (not 'unbound') and we can read formatting off it.
    const group = await seedTestMenuGroup(tenantA, { name: 'Hot Drinks' })
    await seedBox(tenantA, screenId, 1, 'simple_list', group.id)

    // Publish baseline.
    await publishPOST(
      req(tenantA, 'POST', `/api/admin/kds-v3/screens/${screenId}/publish`),
      { params: Promise.resolve({ id: screenId }) },
    )

    // Mutate draft: change layout to flavor_list. Do NOT publish.
    await supabase
      .from('kds_grid_boxes')
      .update({ layout_mode: 'flavor_list' })
      .eq('tenant_id', tenantA.id)
      .eq('screen_id', screenId)
      .eq('position', 1)

    const pub = await resolveScreenForRender(supabase, tenantA.id, screenId, {
      source: 'published',
    })
    const draft = await resolveScreenForRender(supabase, tenantA.id, screenId, {
      source: 'draft',
    })

    expect(pub).not.toBeNull()
    expect(draft).not.toBeNull()
    const pubBox = pub!.boxes[0]
    const draftBox = draft!.boxes[0]
    if (pubBox.slotA.kind !== 'menu_group') throw new Error('expected menu_group slotA pub')
    if (draftBox.slotA.kind !== 'menu_group') throw new Error('expected menu_group slotA draft')
    expect(pubBox.slotA.formatting.layout_mode).toBe('simple_list')
    expect(draftBox.slotA.formatting.layout_mode).toBe('flavor_list')
  })
})
