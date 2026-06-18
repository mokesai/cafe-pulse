/**
 * MOK-158 / KDS v3 phase 6 — integration tests for the single-batched
 * render-fetch helper (resolveScreenForRender).
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T11)
 *
 * Covers:
 *   1. Resolves a screen with one undivided menu_group box bound to a
 *      group — returns the group with items + variations + override
 *      precedence applied
 *   2. Resolves a divided box (slotA + slotB bound to different groups);
 *      both halves render
 *   3. Items with hidden_from_kds=true (item-level override) excluded
 *   4. alt_display_name override surfaces post-resolution
 *   5. Cross-tenant guard: tenant A calling with tenant B's screen_id
 *      returns null
 *   6. image_only slot resolves to the image (external_url passes through)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'

import { resolveScreenForRender } from '@/lib/kds/v3-render'
import {
  cleanupTenant,
  createTenantForTest,
  getServiceClient,
  seedTestAestheticImage,
  seedTestMenuGroup,
  seedTestSquareItem,
  seedTestSquareVariation,
  type TestTenant,
} from './helpers/tenant'

let tenantA: TestTenant
let tenantB: TestTenant

beforeAll(async () => {
  tenantA = await createTenantForTest('kds-v3-rf-a')
  tenantB = await createTenantForTest('kds-v3-rf-b')
})

afterAll(async () => {
  await cleanupTenant(tenantA)
  await cleanupTenant(tenantB)
})

async function clearAll(tenantId: string) {
  const supabase = getServiceClient()
  // Order matters — kds_grid_boxes references kds_screens; kds_display_overrides
  // references kds_aesthetic_images; square_menu_item_variations references
  // square_menu_items.
  await supabase.from('kds_grid_boxes').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_screens').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_display_overrides').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_item_categories').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_item_variations').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_items').delete().eq('tenant_id', tenantId)
  await supabase.from('square_menu_categories').delete().eq('tenant_id', tenantId)
  await supabase.from('kds_aesthetic_images').delete().eq('tenant_id', tenantId)
}

beforeEach(async () => {
  await Promise.all([clearAll(tenantA.id), clearAll(tenantB.id)])
})

interface SeedScreenOptions {
  grid_rows?: number
  grid_cols?: number
  theme?: 'warm' | 'dark' | 'wps'
  name?: string
}

async function seedScreen(tenant: TestTenant, opts: SeedScreenOptions = {}) {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('kds_screens')
    .insert({
      tenant_id: tenant.id,
      name: opts.name ?? `Test Screen ${crypto.randomBytes(3).toString('hex')}`,
      grid_rows: opts.grid_rows ?? 4,
      grid_cols: opts.grid_cols ?? 4,
      theme: opts.theme ?? 'warm',
    })
    .select('id, theme, name, grid_rows, grid_cols')
    .single()
  if (error || !data) throw new Error(`seedScreen: ${error?.message}`)
  return data
}

async function attachItemToGroup(
  tenant: TestTenant,
  itemId: string,
  groupId: string,
  ordinal = 0,
) {
  const supabase = getServiceClient()
  const { error } = await supabase.from('square_menu_item_categories').insert({
    tenant_id: tenant.id,
    item_id: itemId,
    category_id: groupId,
    ordinal,
  })
  if (error) throw new Error(`attachItemToGroup: ${error.message}`)
}

interface SeedBoxOptions {
  position: number
  row_start?: number
  col_start?: number
  row_span?: number
  col_span?: number
  box_type?: 'menu_group' | 'image_only'
  square_menu_group_id?: string | null
  aesthetic_image_id?: string | null
  header_override?: string | null
  layout_mode?: 'simple_list' | 'variation_column_header' | 'flavor_list' | 'compact_list'
  // Slot-B (divided)
  division?: 'none' | 'horizontal' | 'vertical'
  box_type_b?: 'menu_group' | 'image_only' | null
  square_menu_group_id_b?: string | null
  aesthetic_image_id_b?: string | null
  layout_mode_b?:
    | 'simple_list'
    | 'variation_column_header'
    | 'flavor_list'
    | 'compact_list'
    | null
}

async function seedBox(tenant: TestTenant, screenId: string, opts: SeedBoxOptions) {
  const supabase = getServiceClient()
  const divided = opts.division && opts.division !== 'none'
  const { error } = await supabase.from('kds_grid_boxes').insert({
    tenant_id: tenant.id,
    screen_id: screenId,
    position: opts.position,
    row_start: opts.row_start ?? 1,
    col_start: opts.col_start ?? 1,
    row_span: opts.row_span ?? 1,
    col_span: opts.col_span ?? 1,
    box_type: opts.box_type ?? 'menu_group',
    header_override: opts.header_override ?? null,
    square_menu_group_id: opts.square_menu_group_id ?? null,
    aesthetic_image_id: opts.aesthetic_image_id ?? null,
    division: opts.division ?? 'none',
    box_type_b: opts.box_type_b ?? null,
    square_menu_group_id_b: opts.square_menu_group_id_b ?? null,
    aesthetic_image_id_b: opts.aesthetic_image_id_b ?? null,
    layout_mode: opts.layout_mode ?? 'simple_list',
    price_display_mode: 'lowest',
    density: 'normal',
    title_size: 'medium',
    title_align: 'left',
    // Slot-B formatting: required when divided, NULL when undivided
    layout_mode_b: divided ? opts.layout_mode_b ?? 'simple_list' : null,
    price_display_mode_b: divided ? 'lowest' : null,
    density_b: divided ? 'normal' : null,
    title_size_b: divided ? 'medium' : null,
    title_align_b: divided ? 'left' : null,
  })
  if (error) throw new Error(`seedBox: ${error.message}`)
}

describe('MOK-158 — resolveScreenForRender', () => {
  // 1
  it('resolves an undivided menu_group box with items + variations', async () => {
    const supabase = getServiceClient()
    const group = await seedTestMenuGroup(tenantA, { name: 'Hot Drinks' })
    const screen = await seedScreen(tenantA, { name: 'Test 1' })

    const latte = await seedTestSquareItem(tenantA, { name: 'Latte' })
    const tall = await seedTestSquareVariation(tenantA, {
      item_id: latte.id,
      name: 'Tall',
      price_cents: 495,
      ordinal: 0,
    })
    const grande = await seedTestSquareVariation(tenantA, {
      item_id: latte.id,
      name: 'Grande',
      price_cents: 555,
      ordinal: 1,
    })
    await attachItemToGroup(tenantA, latte.id, group.id, 0)

    await seedBox(tenantA, screen.id, {
      position: 1,
      square_menu_group_id: group.id,
      layout_mode: 'variation_column_header',
    })

    const resolved = await resolveScreenForRender(supabase, tenantA.id, screen.id, { source: 'draft' })
    expect(resolved).not.toBeNull()
    expect(resolved!.screen.name).toBe('Test 1')
    expect(resolved!.boxes).toHaveLength(1)

    const box = resolved!.boxes[0]
    expect(box.slotA.kind).toBe('menu_group')
    if (box.slotA.kind !== 'menu_group') throw new Error('expected menu_group')
    expect(box.slotA.group.name).toBe('Hot Drinks')
    expect(box.slotA.formatting.layout_mode).toBe('variation_column_header')
    expect(box.slotA.group.items).toHaveLength(1)
    const item = box.slotA.group.items[0]
    expect(item.display_name).toBe('Latte')
    expect(item.variations.map((v) => v.display_name)).toEqual(['Tall', 'Grande'])
    expect(item.variations.map((v) => v.price_cents)).toEqual([495, 555])
    expect(box.slotB).toBeNull()
    // Test that the ordinals were used (we seeded variations with ordinal=0 each,
    // so the array reflects insertion order via id-string-stable sort).
    expect(item.variations[0].id).toBe(tall.id)
    expect(item.variations[1].id).toBe(grande.id)
  })

  // 2
  it('resolves a divided box with both slots bound to different groups', async () => {
    const supabase = getServiceClient()
    const groupA = await seedTestMenuGroup(tenantA, { name: 'Coffee' })
    const groupB = await seedTestMenuGroup(tenantA, { name: 'Crème' })
    const screen = await seedScreen(tenantA, { name: 'Divided' })

    const mocha = await seedTestSquareItem(tenantA, { name: 'Mocha Frappuccino' })
    await seedTestSquareVariation(tenantA, {
      item_id: mocha.id,
      name: 'Tall',
      price_cents: 625,
    })
    await attachItemToGroup(tenantA, mocha.id, groupA.id, 0)

    const vanilla = await seedTestSquareItem(tenantA, { name: 'Vanilla Bean' })
    await seedTestSquareVariation(tenantA, {
      item_id: vanilla.id,
      name: 'Tall',
      price_cents: 595,
    })
    await attachItemToGroup(tenantA, vanilla.id, groupB.id, 0)

    await seedBox(tenantA, screen.id, {
      position: 1,
      square_menu_group_id: groupA.id,
      division: 'vertical',
      box_type_b: 'menu_group',
      square_menu_group_id_b: groupB.id,
      layout_mode: 'variation_column_header',
      layout_mode_b: 'simple_list',
    })

    const resolved = await resolveScreenForRender(supabase, tenantA.id, screen.id, { source: 'draft' })
    expect(resolved!.boxes).toHaveLength(1)
    const box = resolved!.boxes[0]
    expect(box.division).toBe('vertical')
    if (box.slotA.kind !== 'menu_group') throw new Error('slotA wrong kind')
    if (!box.slotB || box.slotB.kind !== 'menu_group') throw new Error('slotB wrong kind')
    expect(box.slotA.group.name).toBe('Coffee')
    expect(box.slotB.group.name).toBe('Crème')
    expect(box.slotA.formatting.layout_mode).toBe('variation_column_header')
    expect(box.slotB.formatting.layout_mode).toBe('simple_list')
  })

  // 3
  it('hidden_from_kds=true item is excluded from the resolved group', async () => {
    const supabase = getServiceClient()
    const group = await seedTestMenuGroup(tenantA, { name: 'Frapps' })
    const screen = await seedScreen(tenantA)

    const visible = await seedTestSquareItem(tenantA, { name: 'Caffè' })
    const hidden = await seedTestSquareItem(tenantA, { name: 'Mocha Cookie Crumble' })
    await attachItemToGroup(tenantA, visible.id, group.id, 0)
    await attachItemToGroup(tenantA, hidden.id, group.id, 1)

    await supabase.from('kds_display_overrides').insert({
      tenant_id: tenantA.id,
      target_kind: 'item',
      target_id: hidden.id,
      hidden_from_kds: true,
    })

    await seedBox(tenantA, screen.id, { position: 1, square_menu_group_id: group.id })

    const resolved = await resolveScreenForRender(supabase, tenantA.id, screen.id, { source: 'draft' })
    const box = resolved!.boxes[0]
    if (box.slotA.kind !== 'menu_group') throw new Error('expected menu_group')
    expect(box.slotA.group.items.map((it) => it.display_name)).toEqual(['Caffè'])
  })

  // 4
  it('alt_display_name override surfaces post-resolution', async () => {
    const supabase = getServiceClient()
    const group = await seedTestMenuGroup(tenantA, { name: 'Hot Drinks' })
    const screen = await seedScreen(tenantA)
    const latte = await seedTestSquareItem(tenantA, { name: 'Latte' })
    await attachItemToGroup(tenantA, latte.id, group.id, 0)

    await supabase.from('kds_display_overrides').insert({
      tenant_id: tenantA.id,
      target_kind: 'item',
      target_id: latte.id,
      alt_display_name: 'Café Latte',
    })

    await seedBox(tenantA, screen.id, { position: 1, square_menu_group_id: group.id })

    const resolved = await resolveScreenForRender(supabase, tenantA.id, screen.id, { source: 'draft' })
    const box = resolved!.boxes[0]
    if (box.slotA.kind !== 'menu_group') throw new Error('expected menu_group')
    expect(box.slotA.group.items[0].display_name).toBe('Café Latte')
  })

  // 5
  it('cross-tenant guard: tenant A calling with tenant B screen_id returns null', async () => {
    const supabase = getServiceClient()
    const screenB = await seedScreen(tenantB, { name: 'B screen' })

    const resolved = await resolveScreenForRender(supabase, tenantA.id, screenB.id, { source: 'draft' })
    expect(resolved).toBeNull()
  })

  // 6
  it('image_only slot resolves to the image (external_url passes through)', async () => {
    const supabase = getServiceClient()
    const image = await seedTestAestheticImage(tenantA, {
      source_kind: 'external',
      external_url: 'https://example.com/test.png',
      name: 'External hero',
    })
    const screen = await seedScreen(tenantA)
    await seedBox(tenantA, screen.id, {
      position: 1,
      box_type: 'image_only',
      aesthetic_image_id: image.id,
      header_override: 'Welcome',
    })

    const resolved = await resolveScreenForRender(supabase, tenantA.id, screen.id, { source: 'draft' })
    const box = resolved!.boxes[0]
    if (box.slotA.kind !== 'image_only') throw new Error('expected image_only')
    expect(box.slotA.image).not.toBeNull()
    expect(box.slotA.image!.url).toBe('https://example.com/test.png')
    expect(box.slotA.header_override).toBe('Welcome')
  })
})
