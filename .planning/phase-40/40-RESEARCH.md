# Phase 40: Tenant-Aware Square Integration - Research

**Researched:** 2026-02-14
**Domain:** Supabase Vault credential management, Square API client refactoring, multi-tenant webhook routing
**Confidence:** HIGH

## Summary

This phase transforms the Square integration from a single-tenant env-var-based approach to a multi-tenant factory pattern with encrypted credential storage. The codebase currently has a single active Square client (`fetch-client.ts`) that reads `process.env.SQUARE_*` at call time in two key functions (`getHeaders()`, `getLocationId()`) and one exported config object (`squareConfig`). In addition, 7 admin API routes and 2 webhook handlers read Square env vars directly (not through fetch-client), creating a total of ~10 sites that need tenant-aware credential injection.

The core strategy is:
1. Store sensitive credentials (access_token, webhook_signature_key) in Supabase Vault with UUID references on the tenants table
2. Parameterize `fetch-client.ts` functions to accept a config object instead of reading env vars
3. Create a credential-loading layer that resolves tenant config from Vault (with env var fallback for default tenant)
4. Route webhooks by looking up `merchant_id` in the tenants table

**Primary recommendation:** Build the credential loading layer first (Vault migration + SECURITY DEFINER functions + `getTenantSquareConfig()` helper), then parameterize fetch-client.ts, then update consumers one-by-one. This ordering minimizes blast radius since each step can be tested independently.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `supabase_vault` | 0.3.1 | Encrypt secrets at rest | Already installed on dev project |
| `pgcrypto` | 1.3 | Cryptographic functions for Vault | Already installed on dev project |
| Supabase JS | existing | Service role client for Vault reads | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| No new libraries needed | - | - | - |

This phase requires zero new npm dependencies. All work is SQL migrations, TypeScript refactoring, and wiring changes.

**Installation:** None required.

## Architecture Patterns

### Recommended File Structure (new/modified files)
```
src/lib/
├── square/
│   ├── fetch-client.ts          # MODIFY: parameterize with SquareConfig
│   ├── config.ts                # NEW: getTenantSquareConfig(), credential loading
│   ├── types.ts                 # NEW: SquareConfig interface
│   ├── catalog.ts               # MODIFY: accept/pass SquareConfig
│   ├── orders.ts                # MODIFY: accept/pass SquareConfig, tenant-scope cache
│   ├── customers.ts             # MODIFY: accept/pass SquareConfig
│   ├── tax-validation.ts        # MODIFY: accept/pass SquareConfig
│   ├── client.ts                # DELETE (dead code, 1 import)
│   └── simple-client.ts         # DELETE (dead code, 1 import)
├── tenant/
│   ├── types.ts                 # MODIFY: update for Vault references
│   └── square-credentials.ts    # NEW: Vault-specific credential operations
supabase/migrations/
└── 20260215XXXXXX_vault_square_credentials.sql  # NEW: Vault schema + functions
```

### Pattern 1: SquareConfig Interface (Configuration Object)
**What:** A single interface that encapsulates all Square credentials needed for API calls.
**When to use:** Passed through every function call chain that touches Square API.
**Example:**
```typescript
// src/lib/square/types.ts
export interface SquareConfig {
  accessToken: string
  applicationId: string
  locationId: string
  environment: 'sandbox' | 'production'
  merchantId?: string
  webhookSignatureKey?: string
}
```

### Pattern 2: Credential Loading with Fallback Chain
**What:** Load Square credentials from Vault for the current tenant, falling back to env vars for the default tenant.
**When to use:** Every API route and server function that needs Square access.
**Example:**
```typescript
// src/lib/square/config.ts
import { createServiceClient } from '@/lib/supabase/server'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/types'
import type { SquareConfig } from './types'

// Cache credentials per-tenant in memory (globalThis pattern)
declare global {
  var __squareConfigCache: Map<string, { config: SquareConfig; expiresAt: number }> | undefined
}

const CACHE_TTL_MS = 60 * 1000 // 60 seconds, matches tenant cache

function getCache() {
  if (!globalThis.__squareConfigCache) {
    globalThis.__squareConfigCache = new Map()
  }
  return globalThis.__squareConfigCache
}

export async function getTenantSquareConfig(tenantId: string): Promise<SquareConfig | null> {
  // Check cache first
  const cache = getCache()
  const cached = cache.get(tenantId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config
  }

  // For default tenant, try env var fallback
  if (tenantId === DEFAULT_TENANT_ID) {
    const envConfig = getEnvSquareConfig()
    if (envConfig) {
      cache.set(tenantId, { config: envConfig, expiresAt: Date.now() + CACHE_TTL_MS })
      return envConfig
    }
  }

  // Load from Vault via service client
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('get_tenant_square_credentials_internal', {
    p_tenant_id: tenantId
  })

  if (error || !data) return null

  const config: SquareConfig = {
    accessToken: data.access_token,
    applicationId: data.application_id,
    locationId: data.location_id,
    environment: data.environment,
    merchantId: data.merchant_id,
    webhookSignatureKey: data.webhook_signature_key,
  }

  cache.set(tenantId, { config, expiresAt: Date.now() + CACHE_TTL_MS })
  return config
}

function getEnvSquareConfig(): SquareConfig | null {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN
  const applicationId = process.env.SQUARE_APPLICATION_ID
  const locationId = process.env.SQUARE_LOCATION_ID
  if (!accessToken || !applicationId || !locationId) return null

  return {
    accessToken,
    applicationId,
    locationId,
    environment: (process.env.SQUARE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
    merchantId: process.env.SQUARE_MERCHANT_ID ?? undefined,
    webhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? undefined,
  }
}
```

### Pattern 3: Parameterized fetch-client.ts
**What:** Convert the module-level `getHeaders()` and `getLocationId()` functions to accept a `SquareConfig` parameter.
**When to use:** This is the core refactoring of the active Square client.
**Example:**
```typescript
// Before (current):
function getHeaders() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN
  return { 'Authorization': `Bearer ${accessToken}`, ... }
}

// After (parameterized):
function getBaseUrl(config: SquareConfig): string {
  return config.environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
}

function getHeaders(config: SquareConfig) {
  return {
    'Square-Version': SQUARE_VERSION,
    'Authorization': `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json'
  }
}

// All exported functions get a config parameter:
export async function listCatalogObjects(config: SquareConfig, types?: string[], cursor?: string) {
  const url = new URL(`${getBaseUrl(config)}/v2/catalog/list`)
  // ... rest uses config instead of env vars
}
```

### Pattern 4: Webhook Tenant Resolution
**What:** Look up tenant by `merchant_id` from the webhook payload before processing.
**When to use:** All Square webhook handlers.
**Example:**
```typescript
// At the top of webhook POST handler:
async function resolveTenantFromMerchantId(merchantId: string): Promise<string | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('square_merchant_id', merchantId)
    .eq('is_active', true)
    .single()

  if (error || !data) return null
  return data.id
}

// In POST handler:
const event = JSON.parse(body)
const tenantId = await resolveTenantFromMerchantId(event.merchant_id)
if (!tenantId) {
  console.warn(`Unknown merchant_id: ${event.merchant_id}`)
  return NextResponse.json({ success: false, message: 'Unknown merchant' }, { status: 200 })
}
// Load tenant's Square config for subsequent API calls
const squareConfig = await getTenantSquareConfig(tenantId)
```

### Pattern 5: Server-Rendered Square Config for Frontend
**What:** Replace client-side `/api/square/config` fetch with server component prop injection.
**When to use:** Site layout that wraps customer-facing pages.
**Example:**
```typescript
// src/app/(site)/layout.tsx (server component)
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

export default async function SiteLayout({ children }) {
  const tenantId = await getCurrentTenantId()
  const squareConfig = await getTenantSquareConfig(tenantId)

  // Only pass public-safe fields to client
  const publicConfig = squareConfig ? {
    applicationId: squareConfig.applicationId,
    locationId: squareConfig.locationId,
    environment: squareConfig.environment,
  } : null

  if (!publicConfig) {
    return <SetupInProgress>{children}</SetupInProgress>
  }

  return (
    <SquareProvider
      applicationId={publicConfig.applicationId}
      locationId={publicConfig.locationId}
      environment={publicConfig.environment}
    >
      <CartModalProvider>
        {children}
      </CartModalProvider>
    </SquareProvider>
  )
}
```

### Pattern 6: Tenant-Scoped Cache (orders.ts)
**What:** Replace module-level `catalogItemsCache` with a Map keyed by tenantId.
**When to use:** Any in-memory cache that currently holds data for a single tenant.
**Example:**
```typescript
// Before (single tenant):
let catalogItemsCache: CatalogObject[] | null = null
let cacheTimestamp = 0

// After (tenant-scoped):
const catalogCacheByTenant = new Map<string, { items: CatalogObject[]; expiresAt: number }>()

async function getCatalogItems(config: SquareConfig, tenantId: string): Promise<CatalogObject[]> {
  const cached = catalogCacheByTenant.get(tenantId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items
  }

  const result = await searchAllCatalogItems(config)
  const items = result.objects?.filter(obj => obj.type === 'ITEM') || []
  catalogCacheByTenant.set(tenantId, { items, expiresAt: Date.now() + CACHE_DURATION })
  return items
}
```

### Anti-Patterns to Avoid
- **Module-level env var reads at import time:** `const SQUARE_BASE_URL = process.env.SQUARE_ENVIRONMENT === 'production' ? ...` -- This evaluates once at module load and cannot change per-tenant. Move to function scope.
- **Hardcoded tenant references:** `source: { name: 'Little Cafe Website' }` in orders.ts -- Should come from tenant config.
- **Module-level singleton clients:** `const supabase = createClient(...)` at top of file (e.g., `sync-square/route.ts`) -- Must be created per-request with tenant context.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret encryption | Custom encryption layer | Supabase Vault (`vault.create_secret()`) | Vault uses `pgsodium` with auto-key management; rolling your own crypto is a security liability |
| Webhook signature verification | Custom HMAC from scratch | Existing `verifySquareSignature()` function (already exists in both webhook handlers) | Already implemented and working; just needs to accept per-tenant signature key |
| Credential caching | Custom LRU cache | `globalThis` Map + TTL pattern (matches existing `tenant/cache.ts` and `siteSettings.edge.ts`) | Project already uses this pattern; consistency matters more than optimization |
| Merchant ID index | Application-level lookup table | PostgreSQL index on `tenants.square_merchant_id` | DB index is faster, simpler, and handles concurrency correctly |

## Common Pitfalls

### Pitfall 1: Module-Level Env Var Capture
**What goes wrong:** Variables like `const SQUARE_BASE_URL = process.env.SQUARE_ENVIRONMENT === 'production' ? ...` capture the env var value at import time. In a multi-tenant system, different tenants have different environments (sandbox vs production).
**Why it happens:** The current code was written for single-tenant use; module-level constants are natural in that context.
**How to avoid:** Move ALL env var reads into functions that accept `SquareConfig`. The base URL, headers, and location ID must all be derived from the config parameter.
**Warning signs:** Any `const` or `let` at module scope that references `process.env.SQUARE_*`.

**Files affected:**
- `src/lib/square/fetch-client.ts` (line 2-3: `SQUARE_BASE_URL`)
- `src/app/api/admin/inventory/sync-square/route.ts` (lines 6-8: all Square vars at module level)
- `src/app/api/admin/inventory/square-search/route.ts` (lines 4-5)
- `src/app/api/admin/menu/items/[itemId]/route.ts` (lines 4-6)
- `src/app/api/admin/menu/availability/route.ts` (lines 4-6)
- `src/app/api/debug-tax/route.ts` (line 4)

### Pitfall 2: Vault Access from RLS Context
**What goes wrong:** Regular users don't have access to `vault.decrypted_secrets`. If a SECURITY DEFINER function doesn't properly set `search_path`, the Vault lookup fails.
**Why it happens:** The `vault` schema is not in the default search path. SECURITY DEFINER functions run as the function owner (usually `postgres`), which has access, but the search_path must include `vault`.
**How to avoid:** All Vault-reading functions must be `SECURITY DEFINER` with explicit `SET search_path = vault, public` or use fully-qualified `vault.decrypted_secrets` references.
**Warning signs:** "permission denied for schema vault" errors at runtime.

### Pitfall 3: Caching Decrypted Credentials in Wrong Scope
**What goes wrong:** Caching credentials in a module-level variable that persists across requests can leak tenant A's credentials to tenant B's request in a serverless/edge environment.
**Why it happens:** Next.js API routes share the same process; module-level state persists between requests.
**How to avoid:** Always key the cache by `tenantId`. The existing `globalThis.__tenantCache` Map pattern (keyed by slug) is the right approach -- just apply the same pattern keyed by tenantId for Square credentials.
**Warning signs:** A cached credential variable without a tenant key.

### Pitfall 4: Webhook Signature Verification with Wrong Key
**What goes wrong:** After tenant resolution, the webhook handler must use THAT TENANT's `square_webhook_signature_key`, not the env var. Using the wrong key causes all signature checks to fail for non-default tenants.
**Why it happens:** The current code reads `process.env.SQUARE_WEBHOOK_SIGNATURE_KEY` directly.
**How to avoid:** After resolving tenant from `merchant_id`, load the tenant's webhook signature key from Vault and pass it to the verification function.
**Warning signs:** Webhook signature failures for new tenants while the default tenant works fine.

### Pitfall 5: Menu API Cache Collision
**What goes wrong:** The `/api/menu/route.ts` has an in-memory cache (`menuCache`) that stores one tenant's menu. When a different tenant's request hits the cache, they see the wrong menu.
**Why it happens:** The cache is a single object, not keyed by tenant.
**How to avoid:** Key the menu cache by `tenantId` (same Map pattern as tenant cache).
**Warning signs:** Menu data showing wrong items after switching between tenant subdomains.

### Pitfall 6: Admin API Routes with Inline Square Credentials
**What goes wrong:** 7 admin API routes read `process.env.SQUARE_*` directly (not through fetch-client), so parameterizing fetch-client alone is insufficient.
**Why it happens:** These routes were written independently and duplicated the env var pattern.
**How to avoid:** Audit every admin route and refactor to use the centralized `getTenantSquareConfig()`. The 7 affected routes are:
1. `admin/inventory/sync-square/route.ts`
2. `admin/inventory/push-to-square/route.ts`
3. `admin/inventory/sales-sync/route.ts`
4. `admin/inventory/square-search/route.ts`
5. `admin/menu/items/[itemId]/route.ts`
6. `admin/menu/availability/route.ts`
7. `admin/cogs/catalog/sync-square/route.ts`
**Warning signs:** grep for `process.env.SQUARE_` in `src/app/api/admin/` shows hits.

## Code Examples

### Vault Migration SQL
```sql
-- Source: Supabase Vault official docs + project context
-- Migration: Move Square credentials to Vault

-- 1. Add vault_secret_id columns to tenants table
ALTER TABLE public.tenants
  ADD COLUMN square_access_token_vault_id uuid REFERENCES vault.secrets(id),
  ADD COLUMN square_webhook_key_vault_id uuid REFERENCES vault.secrets(id);

-- 2. Create internal credential reader (service_role only)
CREATE OR REPLACE FUNCTION public.get_tenant_square_credentials_internal(p_tenant_id uuid)
RETURNS TABLE(
  access_token text,
  application_id text,
  location_id text,
  environment text,
  merchant_id text,
  webhook_signature_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant record;
  v_access_token text;
  v_webhook_key text;
BEGIN
  -- Get tenant row
  SELECT t.square_application_id, t.square_location_id,
         t.square_environment, t.square_merchant_id,
         t.square_access_token_vault_id, t.square_webhook_key_vault_id,
         t.square_access_token AS plain_access_token,
         t.square_webhook_signature_key AS plain_webhook_key
  INTO v_tenant
  FROM public.tenants t
  WHERE t.id = p_tenant_id AND t.is_active = true;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Read access_token: Vault first, then plain column fallback
  IF v_tenant.square_access_token_vault_id IS NOT NULL THEN
    SELECT ds.decrypted_secret INTO v_access_token
    FROM vault.decrypted_secrets ds
    WHERE ds.id = v_tenant.square_access_token_vault_id;
  ELSE
    v_access_token := v_tenant.plain_access_token;
  END IF;

  -- Read webhook_signature_key: Vault first, then plain column fallback
  IF v_tenant.square_webhook_key_vault_id IS NOT NULL THEN
    SELECT ds.decrypted_secret INTO v_webhook_key
    FROM vault.decrypted_secrets ds
    WHERE ds.id = v_tenant.square_webhook_key_vault_id;
  ELSE
    v_webhook_key := v_tenant.plain_webhook_key;
  END IF;

  RETURN QUERY SELECT
    v_access_token,
    v_tenant.square_application_id,
    v_tenant.square_location_id,
    v_tenant.square_environment,
    v_tenant.square_merchant_id,
    v_webhook_key;
END;
$$;

-- Restrict to service_role and postgres
REVOKE ALL ON FUNCTION public.get_tenant_square_credentials_internal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_square_credentials_internal(uuid) TO service_role;

-- 3. Create owner-facing credential reader (checks tenant_memberships)
CREATE OR REPLACE FUNCTION public.get_tenant_square_credentials(p_tenant_id uuid)
RETURNS TABLE(
  access_token text,
  application_id text,
  location_id text,
  environment text,
  merchant_id text,
  webhook_signature_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is tenant owner
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Access denied: owner role required for credential access';
  END IF;

  -- Delegate to internal function
  RETURN QUERY SELECT * FROM public.get_tenant_square_credentials_internal(p_tenant_id);
END;
$$;

-- 4. Create credential writer (stores new secret in Vault)
CREATE OR REPLACE FUNCTION public.set_tenant_square_credentials(
  p_tenant_id uuid,
  p_access_token text DEFAULT NULL,
  p_webhook_signature_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vault_id uuid;
  v_existing_vault_id uuid;
BEGIN
  -- Verify caller is tenant owner
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Access denied: owner role required for credential management';
  END IF;

  -- Update access_token if provided
  IF p_access_token IS NOT NULL THEN
    -- Check for existing vault entry
    SELECT square_access_token_vault_id INTO v_existing_vault_id
    FROM public.tenants WHERE id = p_tenant_id;

    IF v_existing_vault_id IS NOT NULL THEN
      -- Update existing vault secret
      PERFORM vault.update_secret(v_existing_vault_id, p_access_token);
    ELSE
      -- Create new vault secret
      SELECT vault.create_secret(
        p_access_token,
        'square_access_token_' || p_tenant_id::text,
        'Square access token for tenant ' || p_tenant_id::text
      ) INTO v_vault_id;
      UPDATE public.tenants SET square_access_token_vault_id = v_vault_id WHERE id = p_tenant_id;
    END IF;
  END IF;

  -- Update webhook_signature_key if provided
  IF p_webhook_signature_key IS NOT NULL THEN
    SELECT square_webhook_key_vault_id INTO v_existing_vault_id
    FROM public.tenants WHERE id = p_tenant_id;

    IF v_existing_vault_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_existing_vault_id, p_webhook_signature_key);
    ELSE
      SELECT vault.create_secret(
        p_webhook_signature_key,
        'square_webhook_key_' || p_tenant_id::text,
        'Square webhook signature key for tenant ' || p_tenant_id::text
      ) INTO v_vault_id;
      UPDATE public.tenants SET square_webhook_key_vault_id = v_vault_id WHERE id = p_tenant_id;
    END IF;
  END IF;
END;
$$;

-- 5. Credential audit logging table
CREATE TABLE public.credential_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  credential_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.credential_audit_log ENABLE ROW LEVEL SECURITY;
-- No RLS SELECT policy needed; only service_role reads audit logs

-- 6. Index on merchant_id for webhook resolution
CREATE INDEX IF NOT EXISTS idx_tenants_square_merchant_id
  ON public.tenants (square_merchant_id)
  WHERE square_merchant_id IS NOT NULL;
```

### Parameterized fetch-client.ts Function Signature Changes
```typescript
// All 15 exported functions in fetch-client.ts follow this pattern:
// Before: export async function createOrder(orderData: SquareRequestBody)
// After:  export async function createOrder(config: SquareConfig, orderData: SquareRequestBody)

// The squareConfig export at the bottom is removed entirely.
// Instead, consumers call getTenantSquareConfig() and pass the result.

// Domain layer functions (catalog.ts, orders.ts, etc.) also get config:
// Before: export async function fetchMenuCategories()
// After:  export async function fetchMenuCategories(config: SquareConfig)
```

### Script Tenant Flag Pattern
```javascript
// scripts/sync-square-catalog.js (example modification)

// Add tenant flag parsing
function parseArgs() {
  const args = process.argv.slice(2)
  // ...existing args...
  let tenantId = null
  const tenantArg = args.find(arg => arg.startsWith('--tenant-id='))
  if (tenantArg) tenantId = tenantArg.split('=')[1]
  const tenantSlugArg = args.find(arg => arg.startsWith('--tenant-slug='))
  if (tenantSlugArg) {
    // Look up tenant by slug
    tenantId = await resolveTenantBySlug(tenantSlugArg.split('=')[1])
  }
  return { dryRun, tenantId }
}

// Load credentials from Vault via service_role RPC
async function loadTenantSquareCredentials(supabase, tenantId) {
  const { data, error } = await supabase.rpc('get_tenant_square_credentials_internal', {
    p_tenant_id: tenantId
  })
  if (error || !data?.[0]) throw new Error(`Failed to load credentials for tenant ${tenantId}`)
  return data[0]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain text secrets in columns | Vault-encrypted with UUID references | Supabase Vault GA (2023) | Secrets encrypted at rest, safe in DB dumps |
| SDK client (`SquareClient`) | Fetch-based client | Already in codebase (fetch-client.ts) | Better Next.js compatibility, no SDK dependency for basic operations |
| Client-side config fetch (`/api/square/config`) | Server-rendered props | Next.js 13+ App Router | Eliminates client-side race condition, one fewer API call |
| Module-level singletons | Factory pattern with config injection | Standard multi-tenant practice | Enables per-tenant credential isolation |

**Deprecated/outdated:**
- `src/lib/square/client.ts`: Dead code. Only 1 import (`src/app/api/square/test-connection/route.ts` imports `config`). Can be deleted.
- `src/lib/square/simple-client.ts`: Dead code. Only 1 import (`src/app/api/test-square-simple/route.ts` imports `testSquareConnection`). Can be deleted.
- `src/components/CheckoutModal.tsx` lines 175-176: Reads `process.env.NEXT_PUBLIC_SQUARE_*` which is incorrect (client components can't access server env vars without `NEXT_PUBLIC_` prefix, and even with prefix this is not tenant-aware). This component may not be actively used if `SquareProvider`/`DynamicSquareProvider` handles it.

## Scope of Changes (Complete Inventory)

### Files that read `process.env.SQUARE_*` and need tenant-aware refactoring:

**Core library (via fetch-client.ts):**
1. `src/lib/square/fetch-client.ts` -- `getHeaders()`, `getLocationId()`, `SQUARE_BASE_URL`, `squareConfig`

**Domain layers (consume fetch-client):**
2. `src/lib/square/catalog.ts` -- uses `listCatalogObjects`, `searchCatalogItems`
3. `src/lib/square/orders.ts` -- uses `createOrder`, `createPayment`, `getOrder`, `searchAllCatalogItems`
4. `src/lib/square/tax-validation.ts` -- uses `listCatalogTaxes`
5. `src/lib/square/customers.ts` -- currently disabled, no active env var reads

**API routes (use fetch-client indirectly):**
6. `src/app/api/menu/route.ts` -- uses fetch-client + has its own `process.env.SQUARE_LOCATION_ID` read and module-level menu cache
7. `src/app/api/square/config/route.ts` -- reads all 4 Square env vars (to be replaced by server-rendered props)
8. `src/app/api/square/process-payment/route.ts` -- uses orders.ts (indirect)
9. `src/app/api/square/order-preview/route.ts` -- uses orders.ts (indirect)

**Admin API routes (read env vars directly, NOT through fetch-client):**
10. `src/app/api/admin/inventory/sync-square/route.ts` -- inline Square client, module-level vars
11. `src/app/api/admin/inventory/push-to-square/route.ts` -- reads 3 env vars in function body
12. `src/app/api/admin/inventory/sales-sync/route.ts` -- reads 3 env vars in function body
13. `src/app/api/admin/inventory/square-search/route.ts` -- module-level vars
14. `src/app/api/admin/menu/items/[itemId]/route.ts` -- inline `getHeaders()` with env var
15. `src/app/api/admin/menu/availability/route.ts` -- inline `getHeaders()` with env var
16. `src/app/api/admin/cogs/catalog/sync-square/route.ts` -- uses fetch-client BUT also checks env vars for validation

**Webhook handlers (read env vars for signature verification + API calls):**
17. `src/app/api/webhooks/square/catalog/route.ts` -- reads `SQUARE_ACCESS_TOKEN`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_ENVIRONMENT`; has its own inline `getSquareHeaders()`
18. `src/app/api/webhooks/square/inventory/route.ts` -- reads `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_LOCATION_ID`

**Frontend (config consumption):**
19. `src/components/providers/DynamicSquareProvider.tsx` -- fetches from `/api/square/config`
20. `src/app/(site)/layout.tsx` -- wraps with `DynamicSquareProvider`
21. `src/components/CheckoutModal.tsx` -- reads `process.env.NEXT_PUBLIC_SQUARE_*` (possibly dead path)

**Dead code to delete:**
22. `src/lib/square/client.ts`
23. `src/lib/square/simple-client.ts`
24. `src/app/api/square/test-connection/route.ts` (imports dead client.ts)
25. `src/app/api/test-square-simple/route.ts` (imports dead simple-client.ts)

**Debug/test routes (low priority, can remain env-var based):**
26. `src/app/api/debug-tax/route.ts`
27. `src/app/api/test-simple/route.ts`

## Open Questions

1. **Vault access from Edge Runtime:**
   - What we know: Webhook handlers and API routes currently run in Node.js runtime. The Vault RPC call requires Supabase client which works in Node.js.
   - What's unclear: If any of these routes are moved to Edge Runtime in the future, the Supabase client approach still works (supabase-js works in Edge).
   - Recommendation: Not a blocker; proceed with Node.js runtime assumption.

2. **Credential rotation during active requests:**
   - What we know: The 60-second cache TTL means a credential change takes up to 60 seconds to propagate.
   - What's unclear: Whether mid-flight requests with stale credentials need graceful error handling.
   - Recommendation: 60-second TTL is acceptable. If a request fails due to stale credentials, the next request will get fresh ones. No special handling needed.

3. **Square merchant_id discovery:**
   - What we know: `merchant_id` is included in every Square webhook payload. The tenants table has a `square_merchant_id` column.
   - What's unclear: How the merchant_id gets populated in the tenants table during initial setup (likely via the Square Locations API -- `listLocations()` returns the merchant_id).
   - Recommendation: Scripts that set up Square credentials for a tenant should also call `listLocations()` to discover and store the `merchant_id`. Document this in the setup flow.

4. **Backward compatibility of old plain-text columns:**
   - What we know: The migration adds `vault_id` columns alongside existing plain-text columns. The `get_tenant_square_credentials_internal` function checks Vault first, falls back to plain column.
   - What's unclear: When to actually drop the plain-text columns (deferred per CONTEXT).
   - Recommendation: Keep both columns in Phase 40. The fallback chain handles the transition. A future phase removes plain-text columns after all tenants are migrated to Vault.

## Sources

### Primary (HIGH confidence)
- [Supabase Vault Official Documentation](https://supabase.com/docs/guides/database/vault) -- `create_secret()`, `update_secret()`, `decrypted_secrets` API
- [Supabase Vault GitHub](https://github.com/supabase/vault) -- Extension source and README
- Codebase analysis of all 27 files that read `process.env.SQUARE_*`
- Existing project migrations: `20260212100000_create_tenants_table.sql`, `20260213300000_rls_policy_rewrite.sql`

### Secondary (MEDIUM confidence)
- [Supabase Vault Blog Post](https://supabase.com/blog/supabase-vault) -- Architecture rationale
- [Secure API Calls with Supabase Vault](https://tomaspozo.com/articles/secure-api-calls-supabase-pg-net-vault) -- SECURITY DEFINER + Vault pattern
- [Square Webhook Events Reference](https://developer.squareup.com/docs/webhooks/v2webhook-events-tech-ref) -- `merchant_id` payload field

### Tertiary (LOW confidence)
- [Supabase Secrets Management (Medium)](https://drlee.io/stop-hardcoding-api-keys-master-supabase-secrets-management-before-your-next-security-audit-9da78725edf7) -- General patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Vault is already installed, no new dependencies
- Architecture: HIGH -- Based on direct codebase analysis of all 27 affected files
- Vault API: HIGH -- Verified against official Supabase documentation
- Pitfalls: HIGH -- Identified through systematic code review, not speculation
- Code examples: MEDIUM -- SQL patterns verified against Vault docs; TypeScript patterns based on codebase conventions

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (Vault API is stable; codebase changes may invalidate file list)
