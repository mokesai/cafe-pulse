#!/usr/bin/env node
/**
 * Diagnostic: parse and test both DATABASE_URLs independently, with password masking.
 * Prints what pg is actually seeing so we can spot URL format / encoding issues.
 *
 * Usage:
 *   npx tsx scripts/migrate-from-cafeweb/test-connections.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { Client } from 'pg'

dotenv.config({ path: path.resolve(process.cwd(), '.env.migration') })

function inspect(label: string, url: string | undefined): void {
  console.log(`\n── ${label} ──`)
  if (!url) {
    console.log('  ❌ env var is missing or empty')
    return
  }
  try {
    const u = new URL(url)
    console.log(`  protocol: ${u.protocol}`)
    console.log(`  host:     ${u.hostname}`)
    console.log(`  port:     ${u.port || '(default)'}`)
    console.log(`  user:     ${u.username}`)
    console.log(`  password: ${u.password ? `***${u.password.slice(-3)}  (length: ${u.password.length})` : '(empty)'}`)
    console.log(`  database: ${u.pathname.replace(/^\//, '')}`)
  } catch (err) {
    console.log(`  ❌ Failed to parse as URL: ${(err as Error).message}`)
  }
}

async function testConnection(label: string, url: string | undefined): Promise<void> {
  console.log(`\n→ Attempting connection: ${label}`)
  if (!url) {
    console.log('  ❌ Skipped (no URL)')
    return
  }
  const client = new Client({ connectionString: url, statement_timeout: 10_000 })
  try {
    await client.connect()
    const { rows } = await client.query<{ current_database: string; current_user: string }>(
      'SELECT current_database(), current_user'
    )
    console.log(`  ✅ Connected. database=${rows[0].current_database}, user=${rows[0].current_user}`)
  } catch (err) {
    console.log(`  ❌ ${(err as Error).message}`)
  } finally {
    await client.end().catch(() => {})
  }
}

async function main() {
  console.log('🔍 Connection string diagnostic')
  inspect('SOURCE_DATABASE_URL', process.env.SOURCE_DATABASE_URL)
  inspect('TARGET_DATABASE_URL', process.env.TARGET_DATABASE_URL)

  await testConnection('SOURCE', process.env.SOURCE_DATABASE_URL)
  await testConnection('TARGET', process.env.TARGET_DATABASE_URL)
}

main().catch((err) => {
  console.error('Diagnostic failed:', err)
  process.exitCode = 1
})
