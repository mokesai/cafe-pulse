// Tenant context resolution module
// Provides functions to resolve tenants by slug, read tenant from cookies,
// and extract subdomains from Host headers.

import { cookies, headers } from 'next/headers'

import { createServiceClient } from '@/lib/supabase/server'

import { getCachedTenant, setCachedTenant } from './cache'
import { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from './types'
import type { Tenant } from './types'

/**
 * Resolve a tenant by slug, checking the in-memory cache first.
 * Uses the service role client because this runs in middleware before auth context exists.
 * Returns null if the tenant is not found or inactive.
 */
export async function resolveTenantBySlug(slug: string): Promise<Tenant | null> {
  // Check cache first
  const cached = getCachedTenant(slug)
  if (cached) return cached

  // Cache miss — query the database
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .is('deleted_at', null)
    .single()

  if (error || !data) return null

  // Store in cache and return
  setCachedTenant(slug, data as Tenant)
  return data as Tenant
}

/**
 * Read the current tenant ID.
 * Checks the cookie first (set by middleware on prior requests).
 * Falls back to resolving from the Host header subdomain (handles the case
 * where middleware sets the cookie on the response but cookies() in server
 * components only sees the incoming request cookies).
 * Only works in Server Components and API routes (NOT middleware).
 */
export async function getCurrentTenantId(): Promise<string> {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get('x-tenant-id')?.value
  if (cookieValue) return cookieValue

  // Cookie not set yet — resolve from Host header directly
  return (await resolveFromHost())?.id ?? DEFAULT_TENANT_ID
}

/**
 * Read the current tenant slug.
 * Same fallback strategy as getCurrentTenantId().
 * Only works in Server Components and API routes (NOT middleware).
 */
export async function getCurrentTenantSlug(): Promise<string> {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get('x-tenant-slug')?.value
  if (cookieValue) return cookieValue

  // Cookie not set yet — resolve from Host header directly
  return (await resolveFromHost())?.slug ?? DEFAULT_TENANT_SLUG
}

/**
 * Resolve tenant from the Host header subdomain.
 * Used as a fallback when the middleware cookie isn't visible to server components.
 * Uses the same in-memory cache as resolveTenantBySlug (no extra DB queries).
 */
async function resolveFromHost(): Promise<Tenant | null> {
  const headerStore = await headers()
  const host = headerStore.get('host') || ''
  const slug = extractSubdomain(host)
  if (!slug) return null
  return resolveTenantBySlug(slug)
}

/**
 * Extract the subdomain from a Host header value.
 * Handles both development (slug.localhost:PORT) and production (slug.domain.com).
 * Returns null for bare localhost or bare domain (no subdomain).
 *
 * Examples:
 *   'littlecafe.localhost:3000' -> 'littlecafe'
 *   'localhost:3000'            -> null
 *   'littlecafe.example.com'   -> 'littlecafe'
 *   'example.com'              -> null
 */
export function extractSubdomain(host: string): string | null {
  // Strip port number if present
  const hostname = host.split(':')[0]

  // Bare localhost — no subdomain
  if (hostname === 'localhost') return null

  const parts = hostname.split('.')

  // slug.localhost pattern (development)
  if (parts.length === 2 && parts[1] === 'localhost') {
    return parts[0]
  }

  // slug.domain.com (or deeper, e.g. slug.app.domain.com)
  if (parts.length >= 3) {
    return parts[0]
  }

  // Bare domain (e.g. example.com) — no subdomain
  return null
}
