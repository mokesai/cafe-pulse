#!/usr/bin/env node
/**
 * MOK-89 — Phase 2.1: Migrate profiles.
 *
 * Scope turned out smaller than originally planned:
 *
 *  - `profiles.id` has FK to `auth.users(id)` — 1:1 relationship. We cannot
 *    insert a profile row without a matching auth user. Per the cutover
 *    auth strategy, customers re-sign-up; the existing on_auth_user_created
 *    trigger auto-creates their profile at signup.
 *  - `sales_transactions` on source does NOT link to profiles (just a
 *    `customer_name` text field). So historical orders carry their customer
 *    name forward for display without needing a profile migration.
 *  - Net effect: the only profile work is to sync Jerry's name from source
 *    to target, since his auth user already exists.
 *
 * The 2 remaining source profiles (gayachgayathri99@, talentedchamp@) have
 * no auth.users rows on target and are explicitly skipped — they'll sign
 * up fresh post-cutover.
 *
 * Usage:
 *   npx tsx scripts/migrate-from-cafeweb/02-profiles.ts [--dry-run]
 */

import { sourcePool, targetPool, withClient, closePools } from './shared/clients'

const DRY_RUN = process.argv.includes('--dry-run')

interface SourceProfile {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  created_at: string
  role: string | null
}

async function main() {
  console.log('👤 Phase 2.1: Migrate profiles')
  console.log(`   Dry run: ${DRY_RUN}`)
  console.log('')

  // ── Read source profiles ──────────────────────────────────────────────
  const sourceProfiles = await withClient(sourcePool, async (c) => {
    const { rows } = await c.query<SourceProfile>(
      `SELECT id, email, full_name, phone, created_at, role
       FROM profiles ORDER BY created_at`
    )
    return rows
  })
  console.log(`→ Source profiles: ${sourceProfiles.length}`)
  for (const p of sourceProfiles) {
    console.log(`  ${(p.email ?? '(null email)').padEnd(35)} — ${p.full_name ?? '(no name)'}`)
  }
  console.log('')

  // ── Process each against target ───────────────────────────────────────
  let synced = 0
  let skippedNoAuth = 0
  let alreadyInSync = 0

  await withClient(targetPool, async (c) => {
    for (const srcProfile of sourceProfiles) {
      if (!srcProfile.email) {
        console.log(`  ⚠️  Source profile ${srcProfile.id} has no email — skipping`)
        continue
      }

      // Check for matching auth user on target (by email).
      const { rows: targetAuth } = await c.query<{ id: string }>(
        `SELECT id FROM auth.users WHERE email = $1 LIMIT 1`,
        [srcProfile.email]
      )

      if (targetAuth.length === 0) {
        console.log(`  ⏭️  ${srcProfile.email} — no auth user on target; will self-register post-cutover`)
        skippedNoAuth++
        continue
      }

      const targetUserId = targetAuth[0].id

      // Get existing target profile (should exist via on_auth_user_created trigger).
      const { rows: targetProf } = await c.query<{ full_name: string | null; phone: string | null }>(
        `SELECT full_name, phone FROM profiles WHERE id = $1`,
        [targetUserId]
      )

      if (targetProf.length === 0) {
        console.log(`  ⚠️  ${srcProfile.email} — auth user exists but no profile row; creating`)
        if (!DRY_RUN) {
          await c.query(
            `INSERT INTO profiles (id, email, full_name, phone) VALUES ($1, $2, $3, $4)`,
            [targetUserId, srcProfile.email, srcProfile.full_name, srcProfile.phone]
          )
        }
        synced++
        continue
      }

      // Build patch: only fill target fields that are null/empty and source has a value.
      const patch: Record<string, unknown> = {}
      if (srcProfile.full_name && !targetProf[0].full_name) patch.full_name = srcProfile.full_name
      if (srcProfile.phone && !targetProf[0].phone) patch.phone = srcProfile.phone

      if (Object.keys(patch).length === 0) {
        console.log(`  ✓ ${srcProfile.email} — already in sync (or target has richer data)`)
        alreadyInSync++
        continue
      }

      const setClauses: string[] = []
      const values: unknown[] = [targetUserId]
      let i = 2
      for (const [col, val] of Object.entries(patch)) {
        setClauses.push(`${col} = $${i++}`)
        values.push(val)
      }

      if (DRY_RUN) {
        console.log(`  [dry-run] ${srcProfile.email} — would set ${JSON.stringify(patch)}`)
      } else {
        await c.query(
          `UPDATE profiles SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $1`,
          values
        )
        console.log(`  ✅ ${srcProfile.email} — updated: ${Object.keys(patch).join(', ')}`)
      }
      synced++
    }
  })

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('')
  console.log('─'.repeat(60))
  console.log('✅ Profiles migration complete')
  console.log(`   Source total:            ${sourceProfiles.length}`)
  console.log(`   Synced to target:        ${synced}`)
  console.log(`   Already in sync:         ${alreadyInSync}`)
  console.log(`   Skipped (no auth user):  ${skippedNoAuth}`)
  console.log('─'.repeat(60))
  if (skippedNoAuth > 0) {
    console.log(`   ℹ️  Skipped customers will self-register post-cutover.`)
    console.log(`      Their historical order history lives in sales_transactions`)
    console.log(`      with customer_name as plain text — no FK to profiles needed.`)
  }
}

main()
  .catch((err) => {
    console.error('💥 Profiles migration failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => closePools())
