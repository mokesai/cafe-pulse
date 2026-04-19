#!/usr/bin/env node
/**
 * MOK-87 — Phase 1: Bootstrap JMC Pastry & Coffee tenant + tenant_admin on target.
 *
 * Idempotent:
 *  - Tenant: upsert by slug.
 *  - platform_admins: upsert by (user_id, tenant_id).
 *
 * Writes target only. No reads from source. Safe to re-run.
 * Outputs state/tenant-config.json for downstream migration scripts to pick up
 * the resolved tenant UUID consistently.
 *
 * Usage:
 *   npx tsx scripts/migrate-from-cafeweb/01-bootstrap-tenant.ts
 *   # Optionally with --dry-run to preview
 */

import fs from 'fs'
import path from 'path'
import { targetPool, withClient, closePools } from './shared/clients'

const DRY_RUN = process.argv.includes('--dry-run')
const STATE_DIR = path.resolve(__dirname, 'state')

// ─── Config: JMC Pastry & Coffee ─────────────────────────────────────────
const TENANT_CONFIG = {
  slug: 'jmcpastry',
  name: 'JMC Pastry',
  business_name: 'JMC Pastry & Coffee',
  business_address: '10400 E Alameda Ave, Denver, CO, 80247',
  business_phone: '(303) 250-8721',
  business_email: 'jerry@jmcpastrycoffee.com',
  business_hours: {
    monday: '8:00 AM - 6:00 PM',
    tuesday: '8:00 AM - 6:00 PM',
    wednesday: '8:00 AM - 6:00 PM',
    thursday: '8:00 AM - 6:00 PM',
    friday: '8:00 AM - 6:00 PM',
    saturday: 'Closed',
    sunday: 'Closed',
  },
  square_environment: 'production' as const,
  is_active: true,
}

// Tenant admins to grant access. Must already exist in target auth.users —
// script looks them up by email and errors if not found.
const TENANT_ADMIN_EMAILS = ['jerry.mccommas@gmail.com']

async function main() {
  console.log('🏗️  Phase 1: Bootstrap JMC tenant + admin')
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log(`   Slug:    ${TENANT_CONFIG.slug}`)
  console.log('')

  await withClient(targetPool, async (client) => {
    // ── Upsert tenant ──────────────────────────────────────────────────
    console.log('→ Upserting tenant...')
    let tenantId: string

    if (DRY_RUN) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM tenants WHERE slug = $1`,
        [TENANT_CONFIG.slug]
      )
      tenantId = rows[0]?.id ?? '(would-be-generated)'
      console.log(`  [dry-run] Tenant ${TENANT_CONFIG.slug} would resolve to: ${tenantId}`)
    } else {
      const { rows } = await client.query<{ id: string; action: string }>(
        `
        INSERT INTO tenants (
          slug, name, business_name, business_address, business_phone, business_email,
          business_hours, square_environment, is_active, status, features
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'active'::tenant_status, '{}'::jsonb)
        ON CONFLICT (slug) DO UPDATE SET
          name             = EXCLUDED.name,
          business_name    = EXCLUDED.business_name,
          business_address = EXCLUDED.business_address,
          business_phone   = EXCLUDED.business_phone,
          business_email   = EXCLUDED.business_email,
          business_hours   = EXCLUDED.business_hours,
          is_active        = EXCLUDED.is_active,
          status           = 'active'::tenant_status,
          updated_at       = now()
        RETURNING id, CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [
          TENANT_CONFIG.slug,
          TENANT_CONFIG.name,
          TENANT_CONFIG.business_name,
          TENANT_CONFIG.business_address,
          TENANT_CONFIG.business_phone,
          TENANT_CONFIG.business_email,
          JSON.stringify(TENANT_CONFIG.business_hours),
          TENANT_CONFIG.square_environment,
          TENANT_CONFIG.is_active,
        ]
      )
      tenantId = rows[0].id
      console.log(`  ✅ Tenant ${rows[0].action}: ${tenantId}`)
    }

    // ── Resolve tenant_admin auth users by email ────────────────────────
    console.log('')
    console.log('→ Resolving tenant_admin auth users...')
    const resolvedAdmins: Array<{ email: string; userId: string }> = []
    for (const email of TENANT_ADMIN_EMAILS) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM auth.users WHERE email = $1`,
        [email]
      )
      if (rows.length === 0) {
        throw new Error(
          `No auth.users row for ${email} on target. Create it via Supabase Dashboard → Authentication → Users first, then re-run.`
        )
      }
      resolvedAdmins.push({ email, userId: rows[0].id })
      console.log(`  ✓ ${email} → ${rows[0].id}`)
    }

    // ── Upsert platform_admins rows (tenant_admin scoped to JMC) ────────
    console.log('')
    console.log('→ Upserting platform_admins rows...')
    for (const admin of resolvedAdmins) {
      if (DRY_RUN) {
        console.log(`  [dry-run] Would grant tenant_admin(tenant=${tenantId}) to ${admin.email}`)
        continue
      }
      const { rows } = await client.query<{ action: string }>(
        `
        INSERT INTO platform_admins (user_id, role, tenant_id, created_by)
        VALUES ($1, 'tenant_admin', $2, NULL)
        ON CONFLICT (user_id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
        DO UPDATE SET role = 'tenant_admin'
        RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action
        `,
        [admin.userId, tenantId]
      )
      console.log(`  ✅ ${admin.email} → tenant_admin ${rows[0].action}`)
    }

    // ── Write state file for downstream migration scripts ──────────────
    if (!DRY_RUN) {
      const state = {
        tenantId,
        slug: TENANT_CONFIG.slug,
        businessName: TENANT_CONFIG.business_name,
        adminEmails: resolvedAdmins.map((a) => a.email),
        adminUserIds: Object.fromEntries(resolvedAdmins.map((a) => [a.email, a.userId])),
        bootstrappedAt: new Date().toISOString(),
      }
      fs.mkdirSync(STATE_DIR, { recursive: true })
      fs.writeFileSync(path.join(STATE_DIR, 'tenant-config.json'), JSON.stringify(state, null, 2))
      console.log('')
      console.log(`  ✓ Wrote state/tenant-config.json`)
    }

    // ── Summary ────────────────────────────────────────────────────────
    console.log('')
    console.log('─'.repeat(60))
    console.log('✅ Bootstrap complete')
    console.log(`   Tenant: ${TENANT_CONFIG.slug} (${tenantId})`)
    console.log(`   Admins: ${resolvedAdmins.map((a) => a.email).join(', ')}`)
    console.log('─'.repeat(60))
  })
}

main()
  .catch((err) => {
    console.error('💥 Bootstrap failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => closePools())
