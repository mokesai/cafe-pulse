import { createClient as createSupabaseJs } from '@supabase/supabase-js'
import { createServerClient as createSsrClient } from '@supabase/ssr'
import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { setTestCookies, setTestHeaders } from '../setup'

export interface TestTenant {
  id: string
  slug: string
  adminEmail: string
  adminPassword: string
  adminUserId: string
  sessionCookies: Array<{ name: string; value: string }>
}

export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error(
      'Integration tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local',
    )
  }
  return createSupabaseJs(url, key, { auth: { persistSession: false } })
}

/**
 * Supabase Auth admin/sign-in calls are rate-limited. When the whole integration suite runs in
 * parallel, createTenantForTest bursts many at once and hits "Request rate limit reached". Retry
 * such calls with exponential backoff + jitter so the parallel run stays green.
 */
async function retryOnAuthRateLimit<R extends { error: { message: string } | null }>(
  op: () => Promise<R>,
  attempts = 8,
): Promise<R> {
  let result = await op()
  for (let i = 1; i < attempts && result.error && /rate limit/i.test(result.error.message); i++) {
    const delayMs = Math.min(15000, 400 * 2 ** (i - 1)) + Math.floor(Math.random() * 500)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    result = await op()
  }
  return result
}

export async function createTenantForTest(prefix = 'itest'): Promise<TestTenant> {
  const supabase = getServiceClient()
  const stamp = Date.now()
  const rnd = crypto.randomBytes(3).toString('hex')
  const slug = `${prefix}-${stamp}-${rnd}`
  const email = `${prefix}+admin-${stamp}-${rnd}@cafepulse.test`
  const password = `Test-${crypto.randomBytes(8).toString('hex')}`

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      slug,
      name: `Test Tenant ${stamp}`,
      business_name: `Test Biz ${stamp}`,
      is_active: true,
      status: 'active',
    })
    .select('id, slug')
    .single()
  if (tenantError || !tenant) {
    throw new Error(`Failed to create test tenant: ${tenantError?.message}`)
  }

  // Stagger the initial auth burst across parallel workers to stay under the auth rate limit.
  await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 2500)))

  const { data: userData, error: userError } = await retryOnAuthRateLimit(() =>
    supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    }),
  )
  if (userError || !userData.user) {
    await supabase.from('tenants').delete().eq('id', tenant.id)
    throw new Error(`Failed to create test user: ${userError?.message}`)
  }

  const { error: memErr } = await supabase.from('tenant_memberships').insert({
    tenant_id: tenant.id,
    user_id: userData.user.id,
    role: 'admin',
  })
  if (memErr) {
    await supabase.auth.admin.deleteUser(userData.user.id)
    await supabase.from('tenants').delete().eq('id', tenant.id)
    throw new Error(`Failed to create membership: ${memErr.message}`)
  }

  const captured = new Map<string, string>()
  const ssr = createSsrClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () =>
          Array.from(captured.entries()).map(([name, value]) => ({ name, value })),
        setAll: (toSet) => {
          for (const c of toSet) captured.set(c.name, c.value)
        },
      },
    },
  )
  const { error: signInErr } = await retryOnAuthRateLimit(() =>
    ssr.auth.signInWithPassword({ email, password }),
  )
  if (signInErr) {
    await supabase.auth.admin.deleteUser(userData.user.id)
    await supabase.from('tenants').delete().eq('id', tenant.id)
    throw new Error(`Failed to sign in test user: ${signInErr.message}`)
  }

  return {
    id: tenant.id,
    slug: tenant.slug,
    adminEmail: email,
    adminPassword: password,
    adminUserId: userData.user.id,
    sessionCookies: Array.from(captured.entries()).map(([name, value]) => ({
      name,
      value,
    })),
  }
}

// Tables with tenant_id → tenants.id (RESTRICT) that block a tenant delete.
// Order: dependents (via intra-tenant FKs) before parents so a single pass clears
// the tree. CASCADE-linked descendants drop automatically when their parent is
// deleted (e.g., invoice_items when invoices is cleared).
const TENANT_CHILD_TABLES = [
  // COGS leaves reference inventory_items with RESTRICT — must precede it
  'cogs_product_recipe_lines',
  'cogs_modifier_option_recipe_lines',
  'cogs_sellable_recipe_override_ops',
  'cogs_sellable_aliases',
  'cogs_product_recipes',
  'cogs_modifier_option_recipes',
  'cogs_sellable_recipe_overrides',
  'cogs_products',
  'cogs_sellables',
  'cogs_modifier_options',
  'cogs_modifier_sets',
  'cogs_reports',
  'inventory_valuations',
  'cogs_periods',
  // KDS
  'kds_images',
  'kds_settings',
  'kds_menu_items',
  'kds_categories',
  // KDS v3 (phase 1 + 2 + 2.5 + 3 + 4)
  // kds_grid_boxes has FK CASCADE to kds_screens, but listing both for clarity.
  // kds_aesthetic_images: FK from kds_grid_boxes is ON DELETE SET NULL, so
  // dropping boxes first leaves images cleanly droppable.
  'kds_grid_boxes',
  'kds_screens',
  'kds_display_overrides',
  'kds_aesthetic_images',
  'square_menu_item_categories',
  'square_menu_item_variations',
  'square_menu_items',
  'square_menu_categories',
  'square_menu_sync_state',
  // Parents whose cascades cover many children
  'invoices',
  'purchase_orders',
  'sales_transactions',
  'inventory_sales_sync_runs',
  'orders',
  'inventory_items',
  'suppliers',
  // Remaining tenant-scoped tables
  'inventory_locations',
  'inventory_settings',
  'inventory_unit_types',
  'site_settings',
  'notifications',
  'webhook_events',
  'credential_audit_log',
  'user_addresses',
  'user_favorites',
]

export async function cleanupTenant(t: TestTenant | undefined): Promise<void> {
  if (!t) return
  const supabase = getServiceClient()

  for (const table of TENANT_CHILD_TABLES) {
    const { error } = await supabase.from(table).delete().eq('tenant_id', t.id)
    if (error) {
      console.warn(`[cleanupTenant ${t.slug}] ${table}: ${error.message}`)
    }
  }

  const { error: tenantErr } = await supabase.from('tenants').delete().eq('id', t.id)
  if (tenantErr) {
    throw new Error(
      `Failed to delete test tenant ${t.slug} (${t.id}): ${tenantErr.message}. ` +
        `Child rows likely remain — check TENANT_CHILD_TABLES in tests/integration/helpers/tenant.ts.`,
    )
  }

  await supabase.auth.admin.deleteUser(t.adminUserId).catch(() => {})
}

/**
 * MOK-155 / KDS v3 phase 3 — seed a row into the mirrored Square menu groups
 * table for integration tests that need a tenant-scoped menu group to bind
 * to. Bypasses the live Square sandbox so tests stay deterministic + isolated.
 *
 * Returns the synthetic Square ID so callers can pass it as
 * `square_menu_group_id` in PUT bodies.
 */
export interface SeedTestMenuGroupOptions {
  name?: string
  is_deleted?: boolean
  parentMenuId?: string | null
  parentMenuName?: string | null
  itemCount?: number
}

export async function seedTestMenuGroup(
  tenant: TestTenant,
  overrides: SeedTestMenuGroupOptions = {},
): Promise<{ id: string; name: string }> {
  const supabase = getServiceClient()
  const suffix = crypto.randomBytes(3).toString('hex')
  const groupId = `test-mg-${suffix}`
  const parentId = overrides.parentMenuId ?? `test-menu-${suffix}`
  const parentName = overrides.parentMenuName ?? `Test Menu ${suffix}`

  const now = new Date().toISOString()

  // Ensure the parent menu (top-level) row exists. Idempotent on (tenant_id, id).
  // updated_at is NOT NULL with no default in the mirror schema — sync service
  // sources it from the Square object's mtime; tests just pin to "now".
  const { error: parentErr } = await supabase
    .from('square_menu_categories')
    .upsert(
      {
        tenant_id: tenant.id,
        id: parentId,
        name: parentName,
        is_top_level: true,
        parent_id: null,
        ordinal: 0,
        channels: [],
        online_visibility: true,
        square_version: 1,
        raw_json: {},
        is_deleted: false,
        updated_at: now,
      },
      { onConflict: 'tenant_id,id' },
    )
  if (parentErr) {
    throw new Error(`Failed to seed parent menu: ${parentErr.message}`)
  }

  // The group itself.
  const groupName = overrides.name ?? `Test Group ${suffix}`
  const { error: groupErr } = await supabase
    .from('square_menu_categories')
    .insert({
      tenant_id: tenant.id,
      id: groupId,
      name: groupName,
      is_top_level: false,
      parent_id: parentId,
      ordinal: 0,
      channels: [],
      online_visibility: true,
      square_version: 1,
      raw_json: {},
      is_deleted: overrides.is_deleted ?? false,
      updated_at: now,
    })
  if (groupErr) {
    throw new Error(`Failed to seed menu group: ${groupErr.message}`)
  }

  // Optionally seed `itemCount` items + memberships so the route's item_count
  // computation has something to report.
  const want = overrides.itemCount ?? 0
  if (want > 0) {
    const itemRows = Array.from({ length: want }, (_, i) => ({
      tenant_id: tenant.id,
      id: `${groupId}-item-${i}`,
      name: `Item ${i}`,
      square_version: 1,
      raw_json: {},
      is_deleted: false,
      updated_at: now,
    }))
    const { error: itemErr } = await supabase.from('square_menu_items').insert(itemRows)
    if (itemErr) {
      throw new Error(`Failed to seed menu items: ${itemErr.message}`)
    }
    const membershipRows = itemRows.map((it, i) => ({
      tenant_id: tenant.id,
      item_id: it.id,
      category_id: groupId,
      ordinal: i,
    }))
    const { error: memErr } = await supabase
      .from('square_menu_item_categories')
      .insert(membershipRows)
    if (memErr) {
      throw new Error(`Failed to seed menu memberships: ${memErr.message}`)
    }
  }

  return { id: groupId, name: groupName }
}

/**
 * MOK-156 / KDS v3 phase 4 — seed a tenant-scoped row into
 * kds_aesthetic_images for integration tests that need an image binding to
 * exist. Bypasses Storage entirely: for source_kind='uploaded' we just
 * write a synthetic storage_path that points nowhere (route-level upload
 * validation is the boundary we care about; the actual Storage write is a
 * third-party concern covered by the manual walk).
 *
 * Returns the synthetic image id so callers can pass it as
 * `aesthetic_image_id` in PUT bodies.
 */
export interface SeedTestAestheticImageOptions {
  source_kind?: 'uploaded' | 'external'
  name?: string
  external_url?: string
  storage_path?: string
  is_deleted?: boolean
  alt_text?: string | null
}

export async function seedTestAestheticImage(
  tenant: TestTenant,
  overrides: SeedTestAestheticImageOptions = {},
): Promise<{ id: string; name: string; source_kind: 'uploaded' | 'external' }> {
  const supabase = getServiceClient()
  const suffix = crypto.randomBytes(3).toString('hex')
  const source_kind = overrides.source_kind ?? 'external'
  const name = overrides.name ?? `Test image ${suffix}`

  const row: Record<string, unknown> = {
    tenant_id: tenant.id,
    name,
    source_kind,
    alt_text: overrides.alt_text ?? null,
    is_deleted: overrides.is_deleted ?? false,
  }
  if (source_kind === 'uploaded') {
    row.storage_path = overrides.storage_path ?? `${tenant.id}/test-${suffix}.png`
    row.mime_type = 'image/png'
    row.bytes = 1024
  } else {
    row.external_url = overrides.external_url ?? `https://example.com/${suffix}.png`
  }

  const { data, error } = await supabase
    .from('kds_aesthetic_images')
    .insert(row)
    .select('id, name, source_kind')
    .single()
  if (error || !data) {
    throw new Error(`Failed to seed aesthetic image: ${error?.message}`)
  }
  return data as { id: string; name: string; source_kind: 'uploaded' | 'external' }
}

/**
 * MOK-157 / KDS v3 phase 5 — seed a Square menu item row directly in the
 * mirror. Used by display-overrides integration tests that need an item
 * to bind an override to. Bypasses the live Square sandbox.
 */
export interface SeedTestSquareItemOptions {
  id?: string
  name?: string
  is_deleted?: boolean
}

export async function seedTestSquareItem(
  tenant: TestTenant,
  overrides: SeedTestSquareItemOptions = {},
): Promise<{ id: string; name: string }> {
  const supabase = getServiceClient()
  const suffix = crypto.randomBytes(3).toString('hex')
  const id = overrides.id ?? `test-item-${suffix}`
  const name = overrides.name ?? `Test Item ${suffix}`
  const now = new Date().toISOString()
  const { error } = await supabase.from('square_menu_items').insert({
    tenant_id: tenant.id,
    id,
    name,
    square_version: 1,
    raw_json: {},
    is_deleted: overrides.is_deleted ?? false,
    updated_at: now,
  })
  if (error) {
    throw new Error(`Failed to seed Square item: ${error.message}`)
  }
  return { id, name }
}

/**
 * MOK-157 — seed a Square variation row referencing an existing item.
 * Caller is responsible for ensuring the parent item exists (otherwise the
 * composite FK fires). Use seedTestSquareItem() first.
 */
export interface SeedTestSquareVariationOptions {
  id?: string
  item_id: string
  name?: string
  price_cents?: number | null
  is_deleted?: boolean
  ordinal?: number
}

export async function seedTestSquareVariation(
  tenant: TestTenant,
  overrides: SeedTestSquareVariationOptions,
): Promise<{ id: string; item_id: string; name: string | null }> {
  const supabase = getServiceClient()
  const suffix = crypto.randomBytes(3).toString('hex')
  const id = overrides.id ?? `test-var-${suffix}`
  const name = overrides.name ?? `Test Variation ${suffix}`
  const now = new Date().toISOString()
  const { error } = await supabase.from('square_menu_item_variations').insert({
    tenant_id: tenant.id,
    id,
    item_id: overrides.item_id,
    name,
    price_cents: overrides.price_cents ?? null,
    ordinal: overrides.ordinal ?? 0,
    is_deleted: overrides.is_deleted ?? false,
    updated_at: now,
  })
  if (error) {
    throw new Error(`Failed to seed Square variation: ${error.message}`)
  }
  return { id, item_id: overrides.item_id, name }
}

export interface CreateInventoryItemOptions {
  item_name?: string
  current_stock?: number
  unit_cost?: number
  pack_size?: number
  item_type?: 'supply' | 'ingredient' | 'prepackaged' | 'prepared'
  supplier_id?: string | null
}

export async function createInventoryItem(
  tenant: TestTenant,
  overrides: CreateInventoryItemOptions = {},
): Promise<{ id: string; item_name: string; current_stock: number; unit_cost: number }> {
  const supabase = getServiceClient()
  const suffix = crypto.randomBytes(3).toString('hex')
  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      tenant_id: tenant.id,
      square_item_id: `manual-test-${suffix}`,
      item_name: overrides.item_name ?? `Test Item ${suffix}`,
      current_stock: overrides.current_stock ?? 10,
      minimum_threshold: 5,
      reorder_point: 10,
      unit_cost: overrides.unit_cost ?? 1.5,
      unit_type: 'each',
      pack_size: overrides.pack_size ?? 1,
      is_ingredient: (overrides.item_type ?? 'supply') === 'ingredient',
      item_type: overrides.item_type ?? 'supply',
      supplier_id: overrides.supplier_id ?? null,
      location: 'main',
      last_restocked_at: new Date().toISOString(),
    })
    .select('id, item_name, current_stock, unit_cost')
    .single()
  if (error || !data) {
    throw new Error(`Failed to create test inventory item: ${error?.message}`)
  }
  return data
}

export async function createSupplier(
  tenant: TestTenant,
  overrides: Partial<{ name: string; email: string; contact_person: string }> = {},
): Promise<{ id: string; name: string }> {
  const supabase = getServiceClient()
  const suffix = crypto.randomBytes(3).toString('hex')
  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      tenant_id: tenant.id,
      name: overrides.name ?? `Test Supplier ${suffix}`,
      email: overrides.email ?? `supplier-${suffix}@cafepulse.test`,
      contact_person: overrides.contact_person ?? 'Test Contact',
      is_active: true,
    })
    .select('id, name')
    .single()
  if (error || !data) {
    throw new Error(`Failed to create test supplier: ${error?.message}`)
  }
  return data
}

export interface CreatePurchaseOrderOptions {
  supplier_id: string
  inventory_item_id: string
  status?: string
  order_number?: string
  quantity_ordered?: number
  unit_cost?: number
}

export async function createPurchaseOrder(
  tenant: TestTenant,
  opts: CreatePurchaseOrderOptions,
): Promise<{ id: string; order_number: string; status: string }> {
  const supabase = getServiceClient()
  const suffix = crypto.randomBytes(3).toString('hex')
  const orderNumber = opts.order_number ?? `TEST-PO-${suffix}`
  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .insert({
      tenant_id: tenant.id,
      supplier_id: opts.supplier_id,
      order_number: orderNumber,
      status: opts.status ?? 'draft',
      order_date: new Date().toISOString(),
      total_amount: (opts.quantity_ordered ?? 2) * (opts.unit_cost ?? 1),
    })
    .select('id, order_number, status')
    .single()
  if (poErr || !po) {
    throw new Error(`Failed to create test PO: ${poErr?.message}`)
  }

  const { error: itemErr } = await supabase.from('purchase_order_items').insert({
    tenant_id: tenant.id,
    purchase_order_id: po.id,
    inventory_item_id: opts.inventory_item_id,
    quantity_ordered: opts.quantity_ordered ?? 2,
    quantity_received: 0,
    unit_cost: opts.unit_cost ?? 1,
  })
  if (itemErr) {
    await supabase.from('purchase_orders').delete().eq('id', po.id)
    throw new Error(`Failed to create test PO item: ${itemErr.message}`)
  }

  return po
}

export async function createInvoice(
  tenant: TestTenant,
  opts: { supplier_id: string; status?: string; total_amount?: number },
): Promise<{ id: string; invoice_number: string; status: string }> {
  const supabase = getServiceClient()
  const suffix = crypto.randomBytes(3).toString('hex')
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      tenant_id: tenant.id,
      supplier_id: opts.supplier_id,
      invoice_number: `INV-TEST-${suffix}`,
      invoice_date: new Date().toISOString().slice(0, 10),
      status: opts.status ?? 'parsed',
      total_amount: opts.total_amount ?? 25.0,
    })
    .select('id, invoice_number, status')
    .single()
  if (error || !data) {
    throw new Error(`Failed to create test invoice: ${error?.message}`)
  }
  return data
}

export interface BuildAuthedRequestOptions {
  tenant: TestTenant
  method: string
  url: string
  body?: unknown
  headers?: Record<string, string>
}

export function buildAuthedRequest(opts: BuildAuthedRequestOptions): NextRequest {
  const tenantHost = `${opts.tenant.slug}.localhost:3000`
  const cookieMap: Record<string, string> = {
    'x-tenant-id': opts.tenant.id,
    'x-tenant-slug': opts.tenant.slug,
  }
  for (const c of opts.tenant.sessionCookies) {
    cookieMap[c.name] = c.value
  }
  setTestCookies(cookieMap)
  setTestHeaders({ host: tenantHost })

  const isFormData = opts.body instanceof FormData
  const defaultContentType = isFormData ? undefined : 'application/json'
  const headers = new Headers({
    host: tenantHost,
    origin: `http://${tenantHost}`,
    ...(defaultContentType ? { 'content-type': defaultContentType } : {}),
    ...(opts.headers ?? {}),
  })

  const init: RequestInit = {
    method: opts.method,
    headers,
  }
  if (opts.body !== undefined && opts.method !== 'GET' && opts.method !== 'HEAD') {
    init.body = isFormData ? (opts.body as FormData) : JSON.stringify(opts.body)
  }

  return new NextRequest(new URL(opts.url, `http://${tenantHost}`), init)
}
