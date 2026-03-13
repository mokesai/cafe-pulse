---
phase: 40-tenant-square-integration
plan: 10
subsystem: infrastructure
tags: [square, scripts, vault, multi-tenant, cli]

# Dependency graph
requires: [40-02]
provides: [tenant-aware-setup-scripts]
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Script tenant flag pattern (--tenant-id and --tenant-slug)"
    - "Service-role RPC credential loading for automation"

# File tracking
key-files:
  created: []
  modified:
    - scripts/sync-square-catalog.js
    - scripts/seed-inventory.js
    - scripts/setup-square-webhooks.js

# Decisions
decisions:
  - id: DEC-40-10-01
    choice: "Accept both --tenant-id and --tenant-slug for script tenant selection"
    rationale: "Slugs are easier to remember and type; IDs are deterministic and can't collide"
  - id: DEC-40-10-02
    choice: "Fall back to env vars when no tenant flag provided"
    rationale: "Backward compatibility for existing workflows and default tenant operations"
  - id: DEC-40-10-03
    choice: "seed-inventory.js uses tenant context but doesn't load Square credentials"
    rationale: "Script interacts with Supabase only; needs tenant ID for scoping inventory operations to correct tenant"

# Metrics
metrics:
  duration: "4m 20s"
  completed: 2026-02-14
---

# Phase 40 Plan 10: Tenant-Aware Setup Scripts Summary

**One-liner:** Setup scripts accept --tenant-id and --tenant-slug flags to load Square credentials from Vault via service_role RPC, enabling per-tenant KDS sync, inventory seeding, and webhook registration.

## What Shipped

- `sync-square-catalog.js` loads tenant Square credentials from Vault when --tenant-id or --tenant-slug provided
- `seed-inventory.js` scopes inventory operations to specified tenant
- `setup-square-webhooks.js` creates webhook subscriptions using tenant's Square account credentials
- All three scripts fall back to env vars when no tenant flag specified (backward compatible)
- Slug-to-ID resolution via `resolveTenantBySlug()` queries tenants table
- Vault credential loading via `get_tenant_square_credentials_internal` RPC with service_role client
- Usage docs updated with tenant flag examples

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Accept both --tenant-id and --tenant-slug | Slugs are human-friendly; IDs are deterministic | Scripts support both forms; slug resolution happens first |
| Fall back to env vars when no tenant flag | Backward compatibility and default tenant operations | Existing workflows unchanged; new tenants use Vault |
| seed-inventory.js doesn't load Square credentials | Script only interacts with Supabase, not Square API | Lighter implementation; tenant ID just scopes DB operations |

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None — all operations use service_role client which bypasses authentication requirements.

## Follow-ups

- Document script usage in SaaS operations runbook
- Consider adding --dry-run flag to setup-square-webhooks.js for safer testing
- Add validation to ensure tenant has Square credentials before attempting sync/webhook operations

## Next Phase Readiness

- [x] SaaS ops can run scripts per-tenant with --tenant-id or --tenant-slug
- [x] Default behavior unchanged when no flags provided
- [x] Credentials loaded from Vault via service_role RPC
- [x] Scripts work for both default tenant (env vars) and new tenants (Vault)

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Add tenant-flag support to sync-square-catalog.js | dcffc5d |
| 2 | Add tenant-flag support to seed-inventory.js and setup-square-webhooks.js | fb0a4d6 |
