// In-memory tenant cache using globalThis pattern
// Follows the same approach as siteSettings.edge.ts

import type { Tenant } from './types'

type TenantCacheEntry = {
  tenant: Tenant
  expiresAt: number
}

const TENANT_CACHE_TTL_MS = 60 * 1000 // 60 seconds

declare global {
  var __tenantCache: Map<string, TenantCacheEntry> | undefined
}

function getCache(): Map<string, TenantCacheEntry> {
  if (!globalThis.__tenantCache) {
    globalThis.__tenantCache = new Map()
  }
  return globalThis.__tenantCache
}

/**
 * Get a cached tenant by slug.
 * Returns the tenant if found and not expired, null otherwise.
 */
export function getCachedTenant(slug: string): Tenant | null {
  const cache = getCache()
  const entry = cache.get(slug)

  if (!entry) return null

  if (entry.expiresAt <= Date.now()) {
    cache.delete(slug)
    return null
  }

  return entry.tenant
}

/**
 * Store a tenant in the cache, keyed by slug with a 60-second TTL.
 */
export function setCachedTenant(slug: string, tenant: Tenant): void {
  const cache = getCache()
  cache.set(slug, {
    tenant,
    expiresAt: Date.now() + TENANT_CACHE_TTL_MS,
  })
}

/**
 * Invalidate a specific tenant cache entry by slug,
 * or clear the entire cache if no slug is provided.
 */
export function invalidateTenantCache(slug?: string): void {
  const cache = getCache()
  if (slug) {
    cache.delete(slug)
  } else {
    cache.clear()
  }
}
