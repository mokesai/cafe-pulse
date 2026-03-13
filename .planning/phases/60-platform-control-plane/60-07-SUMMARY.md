---
phase: 60-platform-control-plane
plan: 07
subsystem: platform-lifecycle
tags: [tenant-status, pg_cron, soft-delete, state-machine]

# Dependency graph
requires: [60-01, 60-03, 60-06]
provides: [tenant-status-transitions, tenant-soft-delete, trial-auto-expiration]
affects: [60-08]

# Tech tracking
tech-stack:
  added: []
  patterns: [state-machine-validation, soft-delete-with-retention, cron-automation]

# File tracking
key-files:
  created:
    - src/app/platform/tenants/[tenantId]/StatusManager.tsx
    - supabase/migrations/20260216200000_setup_trial_expiration_cron.sql
  modified:
    - src/app/platform/tenants/actions.ts
    - src/app/platform/tenants/[tenantId]/page.tsx

# Decisions
decisions:
  - id: DEC-60-07-01
    choice: Status changes via Server Actions with database-enforced state machine
    rationale: Database trigger validates transitions, prevents invalid states at data layer
  - id: DEC-60-07-02
    choice: Hourly pg_cron job for trial expiration
    rationale: Prevents long delays after expiration, balances system load vs responsiveness
  - id: DEC-60-07-03
    choice: Daily notification check at 9 AM
    rationale: Business-hours timing for platform admin review, prepares for future email integration

# Metrics
metrics:
  duration: 2 minutes
  completed: 2026-02-16
---

# Phase 60 Plan 07: Tenant Status Management Summary

**One-liner:** Tenant lifecycle management with status transitions (trial → active ↔ paused ↔ suspended), soft delete with 30-day recovery window, and automated trial expiration via pg_cron.

## What Shipped

- **Status change Server Actions**: changeStatus(), deleteTenant(), restoreTenant() with state machine validation
- **StatusManager UI**: Client component with conditional status change buttons and delete confirmation
- **Automated trial expiration**: pg_cron job runs hourly to transition expired trials to 'paused' status
- **Trial expiration warnings**: Daily pg_cron job logs tenants expiring within 3 days (foundation for email notifications)
- **Soft delete with restore**: Tenants marked deleted_at + status='deleted', retained for 30 days before cleanup
- **Lifecycle Management section**: Added to tenant detail page with status controls and danger zone

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Status changes via Server Actions with database validation | Database trigger enforces state machine rules, prevents invalid transitions at data layer | changeStatus() catches validation errors, displays user-friendly messages |
| Hourly pg_cron job for trial expiration | Balances system load vs responsiveness, prevents long delays after expiration | Trials auto-transition to 'paused' within 1 hour of expiration |
| Daily notification check at 9 AM | Business-hours timing for platform admin review, foundation for email alerts | notify_trial_expiring() logs upcoming expirations, ready for email integration |

## Deviations from Plan

None — plan executed as written.

## Authentication Gates

None.

## Follow-ups

- **Restore UI**: StatusManager shows placeholder message for deleted tenants, restore button not yet implemented
- **Email notifications**: notify_trial_expiring() logs to database, email integration deferred to future phase
- **OAuth state verification**: TODO in 60-04 authorize route for server-side state storage remains outstanding

## Next Phase Readiness

- [x] Tenant lifecycle management complete (status transitions, soft delete, restore function)
- [x] Trial expiration automated (no manual intervention needed)
- [x] State machine enforced at database level
- [x] Platform admin can delete and manage tenant status via UI
- [ ] Ready for Plan 60-08: Platform admin assignment

## Key Commits

| Commit | Description |
|--------|-------------|
| 9e48cc5 | Server Actions for status change, delete, and restore |
| 4edb8ac | StatusManager UI component and lifecycle section |
| d8db5bf | pg_cron jobs for trial expiration and warnings |
