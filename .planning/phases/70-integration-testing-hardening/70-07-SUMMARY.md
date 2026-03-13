---
phase: 70-integration-testing-hardening
plan: 07
subsystem: security
tags: [tenant-isolation, multi-tenant, api-security, service-role, row-level-security]

# Dependency graph
requires:
  - 70-02  # service-role audit that identified the 64 unfiltered queries
  - 70-06  # COGS and inventory tenant filtering (same pattern)
provides:
  - tenant_id filtering on all 25 remaining admin API routes
  - complete tenant isolation across invoice, purchase order, supplier, and customer domains
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - tenant_id filter on every .from() query using createServiceClient()
    - getCurrentTenantId() called once per handler, reused for all queries
    - PO tenant verification: verify parent PO belongs to tenant before operating on child resources

# File tracking
key-files:
  created: []
  modified:
    - src/app/api/admin/invoices/[id]/route.ts
    - src/app/api/admin/invoices/[id]/confirm/route.ts
    - src/app/api/admin/invoices/[id]/file/route.ts
    - src/app/api/admin/invoices/[id]/link-order/route.ts
    - src/app/api/admin/invoices/[id]/match-items/route.ts
    - src/app/api/admin/invoices/[id]/match-orders/route.ts
    - src/app/api/admin/invoices/[id]/parse/route.ts
    - src/app/api/admin/invoices/upload/route.ts
    - src/app/api/admin/invoices/items/[itemId]/create-and-match/route.ts
    - src/app/api/admin/invoices/items/[itemId]/match/route.ts
    - src/app/api/admin/invoices/items/[itemId]/skip/route.ts
    - src/app/api/admin/purchase-orders/[orderId]/route.ts
    - src/app/api/admin/purchase-orders/[orderId]/attachments/route.ts
    - src/app/api/admin/purchase-orders/[orderId]/attachments/[attachmentId]/route.ts
    - src/app/api/admin/purchase-orders/[orderId]/invoices/route.ts
    - src/app/api/admin/purchase-orders/[orderId]/invoices/[matchId]/route.ts
    - src/app/api/admin/purchase-orders/[orderId]/items/[itemId]/route.ts
    - src/app/api/admin/purchase-orders/[orderId]/receipts/route.ts
    - src/app/api/admin/purchase-orders/[orderId]/send/route.ts
    - src/app/api/admin/suppliers/[supplierId]/route.ts
    - src/app/api/admin/suppliers/[supplierId]/email-templates/route.ts
    - src/app/api/admin/suppliers/bulk-upload/route.ts
    - src/app/api/admin/customers/[customerId]/orders/route.ts
    - src/app/api/admin/customers/route.ts
    - src/app/api/admin/check-role/route.ts

# Decisions
decisions:
  - id: DEC-70-07-01
    choice: check-role profile lookup not tenant-filtered
    rationale: profiles.eq('id', user.id) is a lookup by the authenticated user's own ID — this is an auth primitive, not a cross-tenant data query. Adding tenant_id would break auth for users who switch tenants.
  - id: DEC-70-07-02
    choice: PO child resources verified via parent PO tenant lookup
    rationale: purchase_order_receipts and order_invoice_matches do not have tenant_id columns; they're scoped via their FK to purchase_orders. Added tenant check on the parent PO before operating on child resources.
  - id: DEC-70-07-03
    choice: supplier_email_templates verified via supplier tenant lookup
    rationale: supplier_email_templates table may not have tenant_id; verified tenant ownership through the supplier FK lookup before read/write operations.

# Metrics
metrics:
  duration: ~3 hours (including previous session work)
  completed: 2026-02-16
---

# Phase 70 Plan 07: Remaining Admin Route Tenant Isolation Summary

**One-liner:** Added `tenant_id` filtering to all 25 remaining admin API routes (invoice sub-routes, purchase order sub-routes, supplier routes, customer routes) to close cross-tenant data leakage identified in the 70-02 security audit.

## What Shipped

- 11 invoice routes now filter all queries by `tenant_id`: main invoice CRUD, upload, parse, confirm, file, link-order, match-items, match-orders, and all invoice item operations (match, skip, create-and-match)
- 8 purchase order sub-routes now tenant-isolated: main PO CRUD, attachments (list + upload + delete), invoice matching (list + link + unlink), item exclusion updates, receipts, and email send
- 3 supplier routes upgraded: PUT/PATCH/DELETE all filter by `tenant_id`; email templates verified via parent supplier FK; bulk-upload upgraded to `requireAdminAuth` and all inserts include `tenant_id`
- 2 customer routes upgraded: list customers filtered by tenant, customer orders filtered by tenant; both upgraded from ad-hoc auth to `requireAdminAuth`
- `check-role` route retained its existing auth pattern (profiles by user ID is not a tenant-scoped query)

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| check-role profile query not tenant-filtered | Authenticating the current user by their own user ID is an auth primitive, not a cross-tenant data query | Route unchanged except code cleanup |
| PO child resources (receipts, matches) scoped via parent PO | These tables lack a direct tenant_id column; parent PO provides the tenant boundary | Added PO tenant verification before operating on child records |
| supplier_email_templates scoped via supplier lookup | Template queries include supplier FK; verify supplier is in tenant before template read/write | Added supplier tenant check in GET and PUT handlers |
| bulk-upload upgraded to requireAdminAuth | Route used ad-hoc auth pattern instead of the standard admin middleware | Now uses requireAdminAuth + isAdminAuthSuccess pattern |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Duplicate import in invoices/items/[itemId]/match/route.ts**
- Found during: Task 1 verification
- Issue: File had `import { getCurrentTenantId }` duplicated on lines 4 and 5 (from Python-based changes in previous session)
- Fix: Removed duplicate import line
- Files: `src/app/api/admin/invoices/items/[itemId]/match/route.ts`
- Commit: b281703

**2. [Rule 2 - Missing Critical] invoices/[id]/confirm had no admin authentication**
- Found during: Task 1
- Issue: The confirm route was missing `requireAdminAuth` entirely — anyone with a session could confirm invoices
- Fix: Added `requireAdminAuth` + `isAdminAuthSuccess` check at handler entry
- Files: `src/app/api/admin/invoices/[id]/confirm/route.ts`
- Commit: b281703

**3. [Rule 2 - Missing Critical] suppliers/bulk-upload and customers routes used ad-hoc auth**
- Found during: Task 2
- Issue: These routes used `supabase.auth.getUser()` + manual profile role check instead of the standard `requireAdminAuth` middleware (missing rate limiting, CSRF protection)
- Fix: Upgraded all three routes to use `requireAdminAuth` + `isAdminAuthSuccess`
- Files: `suppliers/bulk-upload/route.ts`, `customers/route.ts`, `customers/[customerId]/orders/route.ts`
- Commit: c75f4e0

## Authentication Gates

None — all work was automated code modification.

## Follow-ups

- The `check-role` route uses `createServiceClient()` for `supabase.auth.getUser()` which may not need the service role. This is a minor cleanup opportunity but does not affect correctness.
- Some routes in the `purchase_order_receipts` domain query by `purchase_order_id` without a direct `tenant_id` column — the parent PO check provides tenant isolation but a future migration could add `tenant_id` to that table directly.

## Next Phase Readiness

- All 25 FAIL items from the 70-02 security audit are now addressed across all admin API domains
- Complete cross-tenant isolation: COGS (70-06), inventory (70-06), invoices + purchase orders + suppliers + customers (70-07)
- Zero TypeScript errors in all modified routes (`npx tsc --noEmit` shows only pre-existing test framework errors)
