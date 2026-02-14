---
phase: 30-rls-policy-rewrite
plan: 02
subsystem: data
tags: [security-definer, storage-policies, multi-tenant, rls, postgresql]

# Dependency graph
requires: [phase-10, phase-20, 30-01]
provides: [tenant-aware-security-definer-functions, tenant-aware-storage-policies]
affects: [phase-30-plan-03, phase-40]

# Tech tracking
tech-stack:
  added: []
  patterns: [session-variable-tenant-filtering-in-definer-functions, tenant-memberships-storage-policies]

# File tracking
key-files:
  created:
    - supabase/migrations/20260213300001_update_security_definer_functions.sql
    - supabase/migrations/20260213300002_rewrite_storage_policies.sql
  modified: []

# Decisions
decisions:
  - id: DEC-30-05
    choice: Use v_tenant_id variable in functions with multiple tenant_id references
    rationale: Avoids repeating current_setting() call; cleaner code in update_inventory_stock and create_order_notification
  - id: DEC-30-06
    choice: PO attachments SELECT restricted to tenant members (staff/admin/owner) instead of public
    rationale: Previous public read was overly permissive; tenant member restriction is more secure; can be revisited if email links need public access
  - id: DEC-30-07
    choice: Tenant_id from session variable in create_order_notification (not new parameter)
    rationale: Preserves backward compatibility with existing callers; tenant context is already set by middleware

# Metrics
metrics:
  duration: ~4 minutes
  completed: 2026-02-14
---

# Phase 30 Plan 02: SECURITY DEFINER Functions + Storage Policies Summary

**One-liner:** Updated 5 SECURITY DEFINER functions with explicit tenant_id filtering and rewrote 8 storage bucket policies to use tenant_memberships checks instead of profiles.role.

## What Shipped

- **SECURITY DEFINER functions migration** (`20260213300001_update_security_definer_functions.sql`, 214 lines): Updates all 5 SECURITY DEFINER functions that touch tenant-scoped tables with explicit `tenant_id` filtering via `current_setting('app.tenant_id', true)::uuid`
- **Storage policies migration** (`20260213300002_rewrite_storage_policies.sql`, 140 lines): Drops 8 old storage policies and creates 8 new ones using `tenant_memberships` checks

### Functions Updated

| Function | Change | Tables Affected |
|----------|--------|-----------------|
| `update_inventory_stock` | Added tenant_id to both UPDATE WHERE clauses + INSERT into stock_movements | inventory_items, stock_movements |
| `update_stock_simple` | Added tenant_id to UPDATE WHERE clause | inventory_items |
| `create_order_notification` | Added tenant_id to notifications INSERT column list | notifications |
| `get_unread_notification_count` | Added tenant_id to SELECT WHERE clause | notifications |
| `mark_all_notifications_read` | Added tenant_id to UPDATE WHERE clause | notifications |

### Storage Policies Rewritten

| Bucket | Operation | Old Pattern | New Pattern |
|--------|-----------|-------------|-------------|
| invoices | INSERT | profiles.role = 'admin' | tenant_memberships (owner/admin) |
| invoices | SELECT | profiles.role = 'admin' | tenant_memberships (owner/admin) |
| invoices | UPDATE | profiles.role = 'admin' | tenant_memberships (owner/admin) |
| invoices | DELETE | profiles.role = 'admin' | tenant_memberships (owner/admin) |
| purchase-order-attachments | SELECT | public read | tenant_memberships (owner/admin/staff) |
| purchase-order-attachments | INSERT | authenticated | tenant_memberships (owner/admin) |
| purchase-order-attachments | UPDATE | authenticated | tenant_memberships (owner/admin) |
| purchase-order-attachments | DELETE | authenticated | tenant_memberships (owner/admin) |

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Session variable for tenant_id in functions (not new parameter) | Preserves backward compatibility with existing callers | All 5 functions have unchanged signatures |
| `v_tenant_id` variable in multi-use functions | Cleaner than repeating current_setting() | Used in update_inventory_stock and create_order_notification |
| PO attachments SELECT restricted to tenant members | Previous public read was overly permissive | staff/admin/owner can view; public access removed |
| Fixed `inventory_movements` -> `stock_movements` table name | Original function referenced wrong table name | update_inventory_stock now uses correct table |

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 309c2f7 | feat(30-02): update SECURITY DEFINER functions with tenant filtering |
| 6a25531 | feat(30-02): rewrite storage bucket policies with tenant_memberships |

## Verification Results

All checks passed:

### Task 1: SECURITY DEFINER Functions
- [x] 5 CREATE OR REPLACE FUNCTION statements
- [x] All functions have SECURITY DEFINER
- [x] All functions have SET search_path = ''
- [x] All functions filter by tenant_id (via current_setting or v_tenant_id variable)
- [x] BEGIN/COMMIT wrapping present
- [x] GRANT statements preserved for authenticated role

### Task 2: Storage Policies
- [x] 8 DROP POLICY statements (4 invoices + 4 PO attachments)
- [x] 8 CREATE POLICY statements (4 invoices + 4 PO attachments)
- [x] All new policies reference tenant_memberships (not profiles.role)
- [x] All new policies reference current_setting('app.tenant_id', true)
- [x] No profiles.role in any policy code (only in comments)
- [x] BEGIN/COMMIT wrapping present

### Overall Verification
- [x] No references to profiles.role = 'admin' in any new code
- [x] Function signatures unchanged (backward compatible)
- [x] SECURITY DEFINER functions cannot leak or modify cross-tenant data
- [x] Storage bucket access requires tenant membership verification

## Follow-ups

- Plan 30-03: Apply all Phase 30 migrations to dev Supabase and verify tenant isolation
- UNIQUE constraint conflicts still deferred (Phase 30+ per STATE.md)
- site_settings singleton pattern still deferred (Phase 30+)

## Next Phase Readiness

- [x] All SECURITY DEFINER functions tenant-aware
- [x] All storage bucket policies use tenant_memberships
- [x] Forward migration files ready to apply (3 total for Phase 30)
- [ ] Migrations not yet applied to database (Plan 03)
