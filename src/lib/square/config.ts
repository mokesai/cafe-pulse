// Square credential loading layer
// Provides tenant-aware credential resolution from Vault with env var fallback

import { randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/types'
import type { SquareConfig } from './types'

// Cache credentials per-tenant using globalThis pattern
declare global {
  var __squareConfigCache:
    | Map<string, { config: SquareConfig; expiresAt: number }>
    | undefined
}

const CACHE_TTL_MS = 60 * 1000 // 60 seconds

function getCache() {
  if (!globalThis.__squareConfigCache) {
    globalThis.__squareConfigCache = new Map()
  }
  return globalThis.__squareConfigCache
}

/**
 * Load Square credentials for a specific tenant.
 * Checks cache first, then Vault (via RPC), with env var fallback for default tenant.
 * Returns null if tenant has no credentials configured.
 */
export async function getTenantSquareConfig(
  tenantId: string
): Promise<SquareConfig | null> {
  // Check cache first
  const cache = getCache()
  const cached = cache.get(tenantId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config
  }

  // For default tenant, try env var fallback first
  if (tenantId === DEFAULT_TENANT_ID) {
    const envConfig = getEnvSquareConfig()
    if (envConfig) {
      cache.set(tenantId, {
        config: envConfig,
        expiresAt: Date.now() + CACHE_TTL_MS,
      })
      return envConfig
    }
  }

  // Load from Vault via service client RPC
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc(
    'get_tenant_square_credentials_internal',
    {
      p_tenant_id: tenantId,
    }
  )

  // RPC returns an array (RETURNS TABLE)
  if (error || !data || !Array.isArray(data) || data.length === 0) {
    return null
  }

  const row = data[0]

  // Map snake_case DB fields to camelCase SquareConfig
  const config: SquareConfig = {
    accessToken: row.access_token,
    applicationId: row.application_id,
    locationId: row.location_id,
    environment: row.environment as 'sandbox' | 'production',
    merchantId: row.merchant_id ?? undefined,
    webhookSignatureKey: row.webhook_signature_key ?? undefined,
  }

  // Cache and return
  cache.set(tenantId, { config, expiresAt: Date.now() + CACHE_TTL_MS })
  return config
}

/**
 * Read Square credentials from environment variables (default tenant fallback).
 * Returns null if any required variable is missing.
 */
function getEnvSquareConfig(): SquareConfig | null {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN
  const applicationId = process.env.SQUARE_APPLICATION_ID
  const locationId = process.env.SQUARE_LOCATION_ID

  // All three required fields must be present
  if (!accessToken || !applicationId || !locationId) {
    return null
  }

  return {
    accessToken,
    applicationId,
    locationId,
    environment:
      (process.env.SQUARE_ENVIRONMENT as 'sandbox' | 'production') ?? 'sandbox',
    merchantId: process.env.SQUARE_MERCHANT_ID ?? undefined,
    webhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? undefined,
  }
}

/**
 * Resolve tenant ID from Square merchant_id.
 * Used by webhook handlers to identify which tenant an event belongs to.
 * Returns null if no active tenant has this merchant_id.
 */
export async function resolveTenantFromMerchantId(
  merchantId: string
): Promise<string | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('square_merchant_id', merchantId)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    return null
  }

  return data.id
}

/**
 * Generate a cryptographically secure OAuth state parameter for CSRF protection.
 * Format: tenantId:randomToken:environment
 * The random token should be stored server-side and verified in the callback.
 */
export function generateOAuthState(
  tenantId: string,
  environment: 'sandbox' | 'production'
): string {
  const randomToken = randomBytes(32).toString('hex')
  return `${tenantId}:${randomToken}:${environment}`
}

/**
 * Parse OAuth state parameter back into its components.
 * Returns null if the state format is invalid.
 */
export function parseOAuthState(state: string): {
  tenantId: string
  stateToken: string
  environment: 'sandbox' | 'production'
} | null {
  const parts = state.split(':')
  if (parts.length !== 3) {
    return null
  }

  const [tenantId, stateToken, environment] = parts

  // Validate environment
  if (environment !== 'sandbox' && environment !== 'production') {
    return null
  }

  return {
    tenantId,
    stateToken,
    environment,
  }
}
