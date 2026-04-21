#!/usr/bin/env node
/** Quick read-only inspection of existing tenants + platform_admins on target. */
import { targetPool, withClient, closePools } from './shared/clients'

async function main() {
  await withClient(targetPool, async (c) => {
    const { rows: tenants } = await c.query<{
      id: string; slug: string; name: string; business_name: string; is_active: boolean; created_at: string
    }>(`SELECT id, slug, name, business_name, is_active, created_at FROM tenants ORDER BY created_at`)
    console.log(`\nTenants on target (${tenants.length}):`)
    for (const t of tenants) {
      console.log(`  ${t.slug.padEnd(20)} — ${t.business_name ?? t.name} — ${t.is_active ? 'active' : 'inactive'} — ${t.id}`)
    }

    const { rows: admins } = await c.query<{
      email: string; role: string; tenant_slug: string | null
    }>(`
      SELECT u.email, pa.role, t.slug AS tenant_slug
      FROM platform_admins pa
      JOIN auth.users u ON u.id = pa.user_id
      LEFT JOIN tenants t ON t.id = pa.tenant_id
      ORDER BY pa.role DESC, u.email
    `)
    console.log(`\nPlatform admins on target (${admins.length}):`)
    for (const a of admins) {
      console.log(`  ${a.email.padEnd(40)} — ${a.role.padEnd(14)} — ${a.tenant_slug ?? '(all tenants)'}`)
    }
  })
}

main().catch(e => console.error(e)).finally(() => closePools())
