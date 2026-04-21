/**
 * Shared DB clients for cafe-web → cafe-pulse migration.
 *
 * Connects to source (cafe-web-app-prod) and target (cafe-pulse-dev | cafe-pulse-prod)
 * using plain postgres connections. Service-role keys aren't sufficient because
 * information_schema isn't exposed via PostgREST.
 *
 * Environment variables expected (set in .env.migration or exported in shell):
 *
 *   SOURCE_DATABASE_URL   — postgres://... for etihvnzzmtxsnbifftfh (cafe-web-app-prod)
 *   TARGET_DATABASE_URL   — postgres://... for the active target (dev or prod)
 *
 * Connection strings come from Supabase Dashboard → Project Settings → Database →
 * Connection string → URI (use the "Direct connection" or "Session pooler" form).
 */

import { Pool, PoolClient } from 'pg'
import dotenv from 'dotenv'
import path from 'path'

const envFile = process.env.MIGRATION_ENV_FILE ?? '.env.migration'
dotenv.config({ path: path.resolve(process.cwd(), envFile) })

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `Missing required env var: ${name}. Set it in ${envFile} or your shell.`
    )
  }
  return v
}

export const sourcePool = new Pool({
  connectionString: requireEnv('SOURCE_DATABASE_URL'),
  max: 4,
  idleTimeoutMillis: 30_000,
  statement_timeout: 60_000,
})

export const targetPool = new Pool({
  connectionString: requireEnv('TARGET_DATABASE_URL'),
  max: 4,
  idleTimeoutMillis: 30_000,
  statement_timeout: 60_000,
})

export async function withClient<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

export async function closePools(): Promise<void> {
  await Promise.all([sourcePool.end(), targetPool.end()])
}
