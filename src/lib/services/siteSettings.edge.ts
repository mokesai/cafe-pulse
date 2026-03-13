import type { NextRequest } from 'next/server'
import type { SiteStatus } from '@/types/settings'
import { DEFAULT_SITE_STATUS } from './siteSettings.shared'

type CacheEntry = {
  status: SiteStatus
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 1000

declare global {
  var __siteStatusCacheEdge: Map<string, CacheEntry> | undefined
}

function getCache(): Map<string, CacheEntry> {
  if (!globalThis.__siteStatusCacheEdge) {
    globalThis.__siteStatusCacheEdge = new Map()
  }
  return globalThis.__siteStatusCacheEdge
}

async function fetchSiteStatus(request: NextRequest, tenantId: string): Promise<SiteStatus> {
  try {
    const statusUrl = new URL('/api/public/site-status', request.url)
    statusUrl.searchParams.set('tenantId', tenantId)
    const response = await fetch(statusUrl, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store'
    })

    if (!response.ok) {
      console.error('Failed to load site status route:', response.status)
      return DEFAULT_SITE_STATUS
    }

    const data = await response.json()
    return data.status ?? DEFAULT_SITE_STATUS
  } catch (error) {
    console.error('Error fetching site status via middleware:', error)
    return DEFAULT_SITE_STATUS
  }
}

export async function getCachedSiteStatus(request: NextRequest, tenantId: string, forceRefresh = false): Promise<SiteStatus> {
  const now = Date.now()
  const cache = getCache()
  const cached = cache.get(tenantId)

  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.status
  }

  const status = await fetchSiteStatus(request, tenantId)
  cache.set(tenantId, { status, expiresAt: now + CACHE_TTL_MS })

  return status
}

export function invalidateSiteStatusCache(tenantId?: string) {
  if (tenantId) {
    getCache().delete(tenantId)
  } else {
    globalThis.__siteStatusCacheEdge = undefined
  }
}
