/**
 * Build a source → target user ID remap by joining source.profiles.email to
 * target.auth.users.email. Any `*_by` column in source that doesn't map to
 * a target auth user gets set to NULL during migration.
 */
import { sourcePool, targetPool, withClient } from './clients'

export async function buildUserIdRemap(): Promise<Map<string, string | null>> {
  const sourceUsers = await withClient(sourcePool, (c) =>
    c.query<{ id: string; email: string }>(
      `SELECT id, email FROM profiles WHERE email IS NOT NULL`
    )
  ).then((r) => r.rows)

  const targetUsers = await withClient(targetPool, (c) =>
    c.query<{ id: string; email: string }>(
      `SELECT id, email FROM auth.users WHERE email IS NOT NULL`
    )
  ).then((r) => r.rows)

  const targetByEmail = new Map(
    targetUsers.map((u) => [u.email.toLowerCase(), u.id])
  )

  const map = new Map<string, string | null>()
  for (const s of sourceUsers) {
    map.set(s.id, targetByEmail.get(s.email.toLowerCase()) ?? null)
  }
  return map
}

/** Remap a `*_by`-style user ID. Returns null if source had null or unmapped. */
export function remapUser(
  map: Map<string, string | null>,
  sourceId: string | null | undefined
): string | null {
  if (!sourceId) return null
  return map.get(sourceId) ?? null
}
