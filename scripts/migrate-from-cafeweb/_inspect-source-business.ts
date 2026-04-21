#!/usr/bin/env node
/** Peek at source site_settings + profiles to prefill JMC tenant bootstrap config. */
import { sourcePool, withClient, closePools } from './shared/clients'

async function main() {
  await withClient(sourcePool, async (c) => {
    const { rows: settings } = await c.query(`SELECT * FROM site_settings LIMIT 5`)
    console.log('\nsite_settings:')
    for (const row of settings) console.log(JSON.stringify(row, null, 2))

    const { rows: profiles } = await c.query(`SELECT id, email, full_name, role, created_at FROM profiles ORDER BY created_at`)
    console.log(`\nprofiles (${profiles.length}):`)
    for (const p of profiles) console.log(`  ${p.email.padEnd(35)} — ${p.full_name ?? '(no name)'} — role=${p.role}`)

    const { rows: cols } = await c.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='site_settings' ORDER BY ordinal_position
    `)
    console.log(`\nsite_settings columns: ${cols.map((r: {column_name: string}) => r.column_name).join(', ')}`)
  })
}

main().catch(e => console.error(e)).finally(() => closePools())
