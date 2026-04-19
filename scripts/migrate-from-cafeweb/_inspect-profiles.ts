#!/usr/bin/env node
/** Inspect existing profiles on target to spot potential email collisions. */
import { targetPool, withClient, closePools } from './shared/clients'

async function main() {
  await withClient(targetPool, async (c) => {
    const { rows: profiles } = await c.query<{ id: string; email: string; full_name: string | null; role: string | null }>(
      `SELECT id, email, full_name, role FROM profiles ORDER BY email`
    )
    console.log(`\nProfiles on target (${profiles.length}):`)
    for (const p of profiles) {
      console.log(`  ${(p.email ?? '(null email)').padEnd(40)} — ${p.full_name ?? '(no name)'} — role=${p.role ?? 'null'} — ${p.id}`)
    }
  })
}

main().catch(e => console.error(e)).finally(() => closePools())
