---
phase: 60-platform-control-plane
plan: 01
subsystem: platform-control-plane
tags: [postgresql, enum, state-machine, rls, pg_cron, soft-delete, platform-admin]

# Dependency graph
requires: [50-01, 50-06]  # Tenant identity infrastructure and branding columns
provides: [tenant-lifecycle-status, platform-admin-authorization, soft-delete-retention]
affects: [60-02, 60-03, 60-04]  # Future plans for platform UI and tenant management

# Tech tracking
tech-stack:
  added: [pg_cron]
  patterns: [postgresql-enum-state-machine, soft-delete-with-retention, platform-admin-authorization]

# File tracking
key-files:
  created:
    - supabase/migrations/20260216000000_create_tenant_status_enum.sql
    - supabase/migrations/20260216000001_create_platform_admins_table.sql
    - supabase/migrations/20260216000002_add_tenant_soft_delete.sql
  modified:
    - src/lib/tenant/types.ts

# Decisions
decisions:
  - id: DEC-60-01
    choice: PostgreSQL ENUM for tenant_status with trigger-based state machine validation
    rationale: Database-level enforcement prevents invalid transitions across all clients (admin UI, API routes, direct SQL). ENUMs are 4 bytes vs VARCHAR variable size, and state set is stable (trial/active/paused/suspended/deleted).
  - id: DEC-60-02
    choice: Separate platform_admins table instead of global admin role in profiles
    rationale: Platform admins can also be tenant members with different roles. Separation enables clear authorization checks (platform_admins for /platform routes, tenant_memberships for tenant routes) and audit trail (created_by tracking).
  - id: DEC-60-03
    choice: pg_cron for automated cleanup instead of application-level cron or Edge Functions
    rationale: Native Postgres extension eliminates external infrastructure, runs directly in database with automatic retries, SQL-based job definition is simpler than deploying separate workers.
  - id: DEC-60-04
    choice: 30-day retention period for soft-deleted tenants
    rationale: Industry standard for SaaS (matches Google Workspace, Microsoft 365). Long enough to recover from accidental deletion or change of mind, short enough to avoid excessive data retention costs.
  - id: DEC-60-05
    choice: RLS policy INSERT check is false (postgres-only inserts) for platform_admins
    rationale: Bootstrap platform admins require SECURITY DEFINER function or manual SQL. Prevents non-admin users from self-promoting to platform admin role via RLS bypass attempts.

# Metrics
metrics:
  duration: 3m 23s
  completed: 2026-02-16
---

# Phase 60 Plan 01: Platform Control Plane Database Foundation Summary

**One-liner:** Database-enforced tenant lifecycle state machine (trial → active → paused → suspended → deleted), platform super-admin authorization table with bootstrap function, and soft delete with 30-day automated retention cleanup via pg_cron.

## What Shipped

- **tenant_status PostgreSQL ENUM** with 5 lifecycle states (trial, active, paused, suspended, deleted)
- **State machine validation triggers** enforcing valid status transitions at database level (e.g., active → trial is rejected)
- **Automatic status timestamp tracking** via BEFORE UPDATE trigger (status_changed_at updates on every status change)
- **Trial management columns** (trial_expires_at, trial_days) with automatic expiration calculation on tenant creation
- **platform_admins table** with user_id foreign key to auth.users, unique constraint, and btree index for fast lookups
- **Platform admin RLS policies** (platform-admins-only read access, postgres-only inserts)
- **bootstrap_platform_admin function** for creating first platform admin when table is empty (SECURITY DEFINER)
- **Soft delete infrastructure** via deleted_at timestamp column on tenants table
- **Partial index on active tenants** (WHERE deleted_at IS NULL) for query performance
- **Updated RLS policy** to hide soft-deleted tenants from normal queries
- **restore_tenant function** (platform-admin-only, SECURITY DEFINER) to recover soft-deleted tenants
- **pg_cron extension** enabled with scheduled daily cleanup job (3 AM) to purge tenants after 30 days
- **TypeScript types updated** with TenantStatus type, PlatformAdmin interface, and new Tenant fields (status, trial, deleted_at)

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| PostgreSQL ENUM for tenant_status | Database-level enforcement, type safety, 4-byte storage vs VARCHAR | State machine prevents invalid transitions; errors at database level |
| Separate platform_admins table | Platform admins can also be tenant members; clear separation of concerns | Clean authorization checks for /platform routes vs tenant routes |
| pg_cron for automated cleanup | Native Postgres, no external infrastructure, SQL-based | Daily cleanup job scheduled (ID: 1), purges tenants after 30 days |
| 30-day retention period | Industry standard (Google/Microsoft), balance recovery vs cost | Tenants recoverable for 30 days via restore_tenant function |
| postgres-only inserts for platform_admins | Prevent self-promotion via RLS bypass | Bootstrap function required to create first platform admin |
| Trial expiration auto-set on creation | Automate trial lifecycle without manual intervention | trial_expires_at = NOW() + trial_days when status = 'trial' |

## Deviations from Plan

None — plan executed as written. All three tasks completed without blocking issues, unexpected bugs, or architectural changes.

## Authentication Gates

None — all tasks were database migrations and TypeScript type updates. No external service authentication required.

## Follow-ups

- **Platform admin UI** (Plan 60-02): Build /platform route group with tenant list, onboarding wizard, and status management
- **MFA enforcement for platform routes** (Plan 60-03): Add middleware to require 2FA for all /platform access
- **Trial expiration automation** (Plan 60-04): Schedule pg_cron job to auto-transition expired trials to 'paused' status
- **Bootstrap first platform admin**: Run `SELECT bootstrap_platform_admin('admin@example.com');` to create initial platform admin before building /platform UI

## Next Phase Readiness

- [x] Tenant lifecycle status infrastructure in place
- [x] Platform admin authorization table ready for middleware checks
- [x] Soft delete enables tenant deletion with recovery window
- [x] TypeScript types updated for new tenant fields
- [ ] First platform admin must be bootstrapped before /platform UI can be accessed
- [ ] Trial expiration automation needs cron job (similar to cleanup job pattern)
- [ ] MFA enrollment flow needs to be built for platform admin onboarding
