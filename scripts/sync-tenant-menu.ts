#!/usr/bin/env tsx
/**
 * MOK-151 — manually trigger a Square menu mirror sync for a tenant.
 *
 * Equivalent to POST /api/admin/square/menu-sync with { fullResync: true }
 * but runnable from the CLI without spinning up the dev server.
 *
 * Usage:
 *   npx tsx scripts/sync-tenant-menu.ts <tenant-slug-or-uuid> [--full]
 *
 * Examples:
 *   npx tsx scripts/sync-tenant-menu.ts bigcafe --full
 *   npx tsx scripts/sync-tenant-menu.ts 4fa1cbbe-49ff-4cde-a686-8d34252945b4
 */
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const arg = process.argv[2]
  const fullResync = process.argv.slice(3).includes('--full')

  if (!arg) {
    console.error('Usage: npx tsx scripts/sync-tenant-menu.ts <tenant-slug-or-uuid> [--full]')
    process.exit(1)
  }

  // Lazy-load: createServiceClient and syncMenusFromSquare both pull in
  // Next.js runtime helpers that need env vars at import time.
  const { createServiceClient } = await import('@/lib/supabase/server')
  const { syncMenusFromSquare } = await import('@/lib/square/menu-sync')

  const supabase = createServiceClient()

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let tenantId: string

  if (uuidRe.test(arg)) {
    tenantId = arg
  } else {
    const { data, error } = await supabase
      .from('tenants')
      .select('id, name, slug')
      .eq('slug', arg)
      .maybeSingle()
    if (error || !data) {
      console.error(`Tenant not found by slug "${arg}":`, error?.message ?? 'no row')
      process.exit(1)
    }
    tenantId = data.id
    console.log(`Resolved slug "${arg}" → tenant ${data.id} (${data.name})`)
  }

  console.log(`Syncing menus for tenant ${tenantId} (fullResync=${fullResync})…`)
  const result = await syncMenusFromSquare(supabase, tenantId, { fullResync })
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
