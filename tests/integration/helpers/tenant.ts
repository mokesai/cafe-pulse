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

  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
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
  const { error: signInErr } = await ssr.auth.signInWithPassword({ email, password })
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

  const headers = new Headers({
    'content-type': 'application/json',
    host: tenantHost,
    origin: `http://${tenantHost}`,
    ...(opts.headers ?? {}),
  })

  const init: RequestInit = {
    method: opts.method,
    headers,
  }
  if (opts.body !== undefined && opts.method !== 'GET' && opts.method !== 'HEAD') {
    init.body = JSON.stringify(opts.body)
  }

  return new NextRequest(new URL(opts.url, `http://${tenantHost}`), init)
}
