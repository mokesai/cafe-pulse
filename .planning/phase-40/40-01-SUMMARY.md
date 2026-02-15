---
phase: 40-tenant-square-integration
plan: 01
subsystem: security
tags: [supabase-vault, square, credentials, security-definer, rls]

# Dependency graph
requires: [30-03]  # RLS policies complete
provides: [vault-infrastructure, credential-functions, audit-logging]
affects: [40-02, 40-03, 40-04, 40-05, 40-06, 40-07]  # All subsequent Square integration plans

# Tech tracking
tech-stack:
  added: []  # Vault already installed
  patterns: [vault-encryption, security-definer-functions, fallback-chain]

# File tracking
key-files:
  created:
    - supabase/migrations/20260215000000_vault_square_credentials.sql
  modified:
    - src/lib/tenant/types.ts

# Decisions
decisions:
  - id: DEC-40-01
    choice: Store Square credentials in Supabase Vault with fallback to plain columns
    rationale: Provides defense-in-depth encryption while maintaining backward compatibility with default tenant's env vars
  - id: DEC-40-02
    choice: Separate internal and owner-facing credential functions
    rationale: Internal function (service_role only) for API routes; owner-facing function checks auth.uid() for tenant owner role
  - id: DEC-40-03
    choice: Audit logging only for write operations
    rationale: Read operations are too noisy for audit logs; focus on create/update/delete events

# Metrics
metrics:
  duration: 2m 10s
  completed: 2026-02-14
---

# Phase 40 Plan 01: Vault Square Credentials Infrastructure Summary

**One-liner:** Vault-encrypted Square credential storage with SECURITY DEFINER access functions and owner-role authorization gates

## What Shipped

- **Vault schema changes**: Added `square_access_token_vault_id` and `square_webhook_key_vault_id` UUID columns to tenants table with FK references to `vault.secrets`
- **Internal credential reader**: `get_tenant_square_credentials_internal()` SECURITY DEFINER function reads from Vault with fallback to plain columns (service_role only)
- **Owner-facing credential reader**: `get_tenant_square_credentials()` checks auth.uid() is tenant owner before delegating to internal function
- **Credential writer**: `set_tenant_square_credentials()` creates/updates Vault secrets for access_token and webhook_signature_key
- **Audit table**: `credential_audit_log` table with RLS enabled for tracking credential write operations
- **Webhook optimization**: `idx_tenants_square_merchant_id` index for fast tenant resolution from webhook payloads
- **TypeScript types**: Updated `Tenant` interface and `TenantPublic` type to include vault_id fields

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use Vault with plain column fallback | Default tenant still uses env vars; new tenants use Vault | Zero-downtime migration path |
| Separate service_role and owner functions | API routes need unrestricted access; owners need auth check | Clear security boundaries |
| Audit writes only (not reads) | Read operations too noisy for audit logs | Focused audit trail |
| Index on merchant_id | Webhooks need fast tenant lookup by merchant_id | O(1) webhook routing |

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None encountered.

## Follow-ups

- Phase 40-02: Create SquareConfig type and getTenantSquareConfig() loading layer that uses these Vault functions
- Phase 40-07: Webhook handlers will use the merchant_id index for tenant resolution
- Future phase: Migrate default tenant's env var credentials into Vault and remove fallback logic
- Future phase: Build credential management UI for tenant owners to update Square credentials

## Next Phase Readiness

- [x] Vault infrastructure exists for credential storage
- [x] SECURITY DEFINER functions ready for consumption by credential loading layer
- [x] TypeScript types updated to match new schema
- [x] Migration is idempotent and safe to apply to dev/prod
- [ ] Migration not yet applied to Supabase (pending Phase 40-02 completion for integrated testing)

## Technical Notes

### Vault Access Pattern

The migration follows the 3-layer defense-in-depth pattern from 40-CONTEXT.md:

1. **Layer 1 - Vault encryption**: Credentials stored in `vault.secrets`, encrypted at rest
2. **Layer 2 - SECURITY DEFINER gate**: Functions enforce owner role check or service_role requirement
3. **Layer 3 - RLS on tenants**: Vault reference columns only accessible through SECURITY DEFINER functions

### Fallback Chain

The `get_tenant_square_credentials_internal()` function checks Vault first, then falls back to plain columns:

```sql
IF v_tenant.square_access_token_vault_id IS NOT NULL THEN
  SELECT ds.decrypted_secret INTO v_access_token
  FROM vault.decrypted_secrets ds
  WHERE ds.id = v_tenant.square_access_token_vault_id;
ELSE
  v_access_token := v_tenant.plain_access_token;
END IF;
```

This allows the default tenant to continue using env vars while new tenants use Vault exclusively.

### Idempotency

All schema changes use `IF NOT EXISTS` or `CREATE OR REPLACE` for safe re-runs:
- `ADD COLUMN IF NOT EXISTS` for vault_id columns
- `CREATE OR REPLACE FUNCTION` for all 3 functions
- `CREATE TABLE IF NOT EXISTS` for audit log
- `CREATE INDEX IF NOT EXISTS` for merchant_id index

### Performance

The `merchant_id` index is conditional (`WHERE square_merchant_id IS NOT NULL`) to save space and improve performance by excluding rows without Square integration.
