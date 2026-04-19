#!/usr/bin/env node
/** Map source profile user IDs to target auth user IDs by email. */
import { sourcePool, targetPool, withClient, closePools } from './shared/clients'

async function main() {
  const src = await withClient(sourcePool, (c) =>
    c.query<{ id: string; email: string }>(`SELECT id, email FROM profiles WHERE email IS NOT NULL`)
  ).then((r) => r.rows)

  const tgt = await withClient(targetPool, (c) =>
    c.query<{ id: string; email: string }>(`SELECT id, email FROM auth.users WHERE email IS NOT NULL`)
  ).then((r) => r.rows)

  const tgtByEmail = new Map(tgt.map((u) => [u.email.toLowerCase(), u.id]))
  console.log('source profile → target auth.users (by email):')
  for (const s of src) {
    const tgtId = tgtByEmail.get(s.email.toLowerCase())
    console.log(`  ${s.email.padEnd(35)} source=${s.id} → target=${tgtId ?? 'NONE'}`)
  }
}
main().catch(e => console.error(e)).finally(() => closePools())
