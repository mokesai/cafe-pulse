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

export async function cleanupTenant(t: TestTenant | undefined): Promise<void> {
  if (!t) return
  const supabase = getServiceClient()
  await supabase.from('tenants').delete().eq('id', t.id)
  await supabase.auth.admin.deleteUser(t.adminUserId).catch(() => {})
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
