# Phase 40 Context: Tenant-Aware Square Integration

## Goals
- Refactor Square client from env-var singletons to a tenant-aware factory pattern
- Store Square credentials securely using Supabase Vault (defense in depth)
- Make webhook handlers multi-tenant via merchant_id resolution
- Deliver frontend Square config via server-rendered props (not client-side fetch)

## Constraints
- Backend infrastructure only — no credential management UI in this phase
- `fetch-client.ts` is the sole active Square client (SDK `client.ts` is dead code)
- KDS menus read from Supabase after initial setup — they work without Square access
- Online ordering menus require live Square access for catalog + payments
- SaaS ops team runs scripts (in `scripts/`) that need Square credentials for tenant setup
- Default tenant (Little Cafe) credentials currently live in env vars

## Decisions

### Credential Security: 3-Layer Defense in Depth

**Layer 1 — Vault encrypts at rest**
- Each Square credential (access_token, webhook_signature_key) stored as a `vault.secrets` entry
- `tenants` table stores `vault_secret_id` UUID references, NOT plaintext credential values
- DB dump = useless (only encrypted ciphertext without Supabase's internal key)
- `supabase_vault` (v0.3.1) and `pgcrypto` (v1.3) are already installed on dev project

**Layer 2 — SECURITY DEFINER function gates access**
- `get_tenant_square_credentials(p_tenant_id)` function verifies caller is tenant `owner` role via `auth.uid()` + `tenant_memberships` before reading from `vault.decrypted_secrets`
- Separate internal function for server-side API calls (service_role context) — reads credentials without owner check but requires service_role privileges
- Raises exception if unauthorized

**Layer 3 — RLS on tenants table**
- Credential reference columns (vault_secret_id fields) only accessible through the SECURITY DEFINER function, not directly via RLS SELECT
- Public-safe fields (slug, name, business_name, etc.) remain RLS-accessible to tenant members

**Rationale:** Plain columns were the original Phase 10 decision ("Vault migration in later phase"). User elevated this to Phase 40 scope. The 3-layer approach ensures: DB breach = useless (Vault), RLS bypass = no creds exposed (SECURITY DEFINER), role escalation = owner-only gate (tenant_memberships check).

### Credential Display
- **Masked only**: Show `sq0atp-****xxxx` (last 4 chars) in any future UI
- Owner can replace but never re-read the full token
- Rationale: Minimizes exposure window; if owner needs the token, they get it from Square Dashboard

### Credential Access Roles
- **Owner only** can view/manage Square credentials (not admin, not staff)
- SaaS operations team accesses credentials via **service_role + tenant flag** (CLI scripts with `--tenant-id` or `--tenant-slug`)
- Rationale: Credentials are high-value; delegation to admin role deferred until explicit need

### Audit Logging
- **Writes only**: Log credential create, update, delete events
- Do NOT log routine credential reads by API routes (too noisy, low signal)
- Log to existing audit infrastructure (or new `credential_audit_log` table)

### Default Tenant Migration
- **Vault + env var fallback**: New tenants use Vault exclusively. Default tenant (Little Cafe) falls back to env vars if Vault entry is empty
- Migration path: Phase 40 builds the fallback chain. Later phase copies Little Cafe's env var creds into Vault and removes the fallback
- Rationale: Safer transition; existing deployment continues working without manual credential migration step

### No-Credentials Behavior
- **Hide online storefront**: Tenant's customer-facing site shows "setup in progress" page when Square credentials are not configured
- KDS screens still work (they read from Supabase `kds_categories`/`kds_menu_items` tables after initial setup)
- Admin pages remain accessible for configuration
- Rationale: Prevents confusing UX where menu appears but checkout fails

### Webhook Routing
- **Shared URL**: Single `/api/webhooks/square/*` endpoint for all tenants
- Resolve tenant from `merchant_id` in webhook payload → lookup `tenants.square_merchant_id`
- **Unknown merchant_id**: Log warning with merchant_id details, return HTTP 200 to prevent Square retries
- Rationale: Simpler infrastructure; one webhook registration in Square per event type. Per-tenant URLs add complexity with no security benefit (signature verification handles authenticity)

### Frontend Square Config Delivery
- **Server-render into page**: Inject `applicationId` and `locationId` as server component props during page render
- Eliminates the client-side `/api/square/config` fetch entirely
- The config endpoint may remain for backward compatibility but is no longer the primary delivery mechanism
- Rationale: Server components already have tenant context; avoids an extra API round-trip and potential race condition at SDK init

### Square Client Consolidation
- **Parameterize `fetch-client.ts`** as the sole Square client: convert `getHeaders()` and `getLocationId()` from env-var readers to accept tenant config parameters
- **Clean up dead code**: Remove `client.ts` (SDK singleton, 1 import) and `simple-client.ts` (test-only, 1 import)
- Domain layers (`catalog.ts`, `orders.ts`, `customers.ts`, `tax-validation.ts`) will pass tenant config through to fetch-client functions
- Rationale: fetch-client.ts is already the active client (12+ API route imports). The SDK client exists only because of sandbox/production compatibility issues that fetch-client already solves

### Script Tenant Access
- Setup scripts (`sync-square-catalog.js`, `seed-inventory.js`, `setup-square-webhooks.js`, etc.) accept `--tenant-id` or `--tenant-slug` flag
- Scripts use service_role to read tenant credentials from Vault
- Without a flag, scripts could default to the default tenant (backward compatible)
- Rationale: SaaS ops needs to run scripts per-tenant for KDS menu setup, inventory population, and webhook registration

## Open Questions
- None — all gray areas resolved through discussion

## Deferred Ideas
- Credential management UI for tenant owners (Phase 50 or 60)
- Connection testing UI (verify Square credentials before saving)
- App-layer encryption on top of Vault (belt + suspenders — revisit if threat model changes)
- Remove env var fallback for default tenant (after manual migration to Vault)
- Platform admin role for credential access (currently service_role only)

## Key Files (Current State)
- `src/lib/square/fetch-client.ts` — Primary Square client (to be parameterized)
- `src/lib/square/client.ts` — Dead SDK client (to be removed)
- `src/lib/square/simple-client.ts` — Dead test client (to be removed)
- `src/lib/square/catalog.ts` — Menu fetching (wraps fetch-client)
- `src/lib/square/orders.ts` — Order/payment processing (wraps fetch-client, has module-level cache that needs tenant-scoping)
- `src/lib/square/customers.ts` — Customer operations
- `src/lib/square/tax-validation.ts` — Tax config validation
- `src/app/api/square/config/route.ts` — Config endpoint (to be superseded by server-rendered props)
- `src/app/api/webhooks/square/catalog/route.ts` — Catalog webhook (needs merchant_id→tenant resolution)
- `src/app/api/webhooks/square/inventory/route.ts` — Inventory webhook (needs merchant_id→tenant resolution)
- `src/lib/tenant/context.ts` — Tenant resolution (existing)
- `src/lib/tenant/types.ts` — Tenant type with Square credential fields (to be updated for Vault references)
