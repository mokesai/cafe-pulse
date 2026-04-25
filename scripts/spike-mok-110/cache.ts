/**
 * File-based response cache for spike runs.
 * Keys responses by SHA-256(model + mode + systemPrompt + userPayload).
 * Iterating on the prompt or matrix invalidates the cache automatically.
 *
 * Disable for a run with --no-cache (handled in run.ts) or env SPIKE_NO_CACHE=1.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE_DIR } from './config'

let cacheEnabled = process.env.SPIKE_NO_CACHE !== '1'

export function setCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled
}

export function isCacheEnabled(): boolean {
  return cacheEnabled
}

export function buildCacheKey(parts: { model: string; mode: string; systemPrompt: string; userPayload: string }): string {
  const h = createHash('sha256')
  h.update(parts.model)
  h.update('|')
  h.update(parts.mode)
  h.update('|')
  h.update(parts.systemPrompt)
  h.update('|')
  h.update(parts.userPayload)
  return h.digest('hex')
}

export async function readCache<T>(key: string): Promise<T | null> {
  if (!cacheEnabled) return null
  const path = join(CACHE_DIR, `${key}.json`)
  if (!existsSync(path)) return null
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  if (!cacheEnabled) return
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 2), 'utf8')
}
