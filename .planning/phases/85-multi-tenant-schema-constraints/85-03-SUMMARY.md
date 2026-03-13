---
phase: 85-multi-tenant-schema-constraints
plan: 03
subsystem: database
tags: [postgresql, migrations, unique-constraints, multi-tenant, inventory, suppliers]

requires:
  - 20-multi-tenant-tenant-id-columns
  - 20-multi-tenant-not-null-constraints

provides:
  - composite_operational_unique_constraints
  - inventory_items_tenant_square_pack_unique
  - suppliers_tenant_name_unique
  - inventory_unit_types_tenant_symbol_unique
  - purchase_orders_tenant_order_number_unique

affects:
  - 85-04-app-code-onconflict-updates

tech-stack:
  added: []
  patterns:
    - composite-unique-constraint-tenant-scoping

key-files:
  created:
    - supabase/migrations/20260217200000_composite_operational_unique_constraints.sql
  modified: []

decisions:
  - id: DEC-85-03-01
    choice: Skipped inventory_unit_types name constraint (no existing single-column UNIQUE on name)
    rationale: Research doc listed inventory_unit_types_name_key as existing, but original CREATE TABLE defined `name text not null` without UNIQUE. Adding a new constraint for name was not the plan intent (plan said "replace" not "add"). Consistent with plan's explicit rule to not add inventory_items item_name constraint either.
  - id: DEC-85-03-02
    choice: inventory_items uses DROP INDEX / CREATE UNIQUE INDEX pattern (not ALTER TABLE constraint)
    rationale: The existing inventory_items_square_pack_unique was created as a partial composite index via CREATE UNIQUE INDEX, not an inline table constraint. PostgreSQL requires DROP INDEX to remove it and CREATE UNIQUE INDEX to add the new one.

metrics:
  duration: 25 minutes
  completed: 2026-02-17
---

# Phase 85 Plan 03: Operational Domain Composite Unique Constraints Summary

**One-liner:** Replaced four single-column UNIQUE constraints in the operational domain (suppliers.name, inventory_unit_types.symbol, purchase_orders.order_number, inventory_items partial index) with composite (tenant_id, field) constraints so two tenants can independently manage inventory, suppliers, unit types, and purchase orders without naming conflicts.

## What Shipped

- `inventory_items_tenant_square_pack_unique`: Partial composite index on `(tenant_id, square_item_id, pack_size) WHERE square_item_id IS NOT NULL`, replacing the global `inventory_items_square_pack_unique` index
- `suppliers_tenant_name_unique`: UNIQUE constraint on `(tenant_id, name)`, replacing the global `suppliers_name_key`
- `inventory_unit_types_tenant_symbol_unique`: UNIQUE constraint on `(tenant_id, symbol)`, replacing the global `inventory_unit_types_symbol_key`
- `purchase_orders_tenant_order_number_unique`: UNIQUE constraint on `(tenant_id, order_number)`, replacing the global `purchase_orders_order_number_key`
- All four new constraints verified functional via live insert tests (duplicate same-tenant inserts produce expected unique constraint violations with new constraint names)

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Skipped inventory_unit_types name constraint | Research doc listed `inventory_unit_types_name_key` as existing but original CREATE TABLE defined `name text not null` without UNIQUE; no constraint existed to replace | Migration skipped the name step; only symbol constraint migrated |
| Used DROP INDEX / CREATE UNIQUE INDEX for inventory_items | Existing `inventory_items_square_pack_unique` was a CREATE UNIQUE INDEX partial index, not an ALTER TABLE constraint; must use DROP INDEX to remove it | Correct DDL pattern applied, partial condition (WHERE square_item_id IS NOT NULL) preserved |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed non-existent `inventory_unit_types_name_key` DROP CONSTRAINT**

- Found during: Task 1 (migration apply)
- Issue: Research document incorrectly stated that `inventory_unit_types.name` had an inline UNIQUE constraint (`inventory_unit_types_name_key`). The original `20250810163053_create_inventory_settings_tables.sql` defined `name text not null` without UNIQUE — only `symbol text not null unique` had the constraint. The migration failed on first apply with `constraint "inventory_unit_types_name_key" of relation "inventory_unit_types" does not exist`.
- Fix: Removed the `DROP CONSTRAINT inventory_unit_types_name_key` and the corresponding `ADD CONSTRAINT inventory_unit_types_tenant_name_unique` steps from the migration. The `name` column was never globally unique, so there is nothing to replace. Only the `symbol` constraint (which does exist) was migrated.
- Files modified: `supabase/migrations/20260217200000_composite_operational_unique_constraints.sql`
- Commit: 490adbe

## Follow-ups

- Plan 85-04: App code `onConflict` clause updates — no operational domain tables have `onConflict` references in `src/` or `scripts/` (confirmed by 85-RESEARCH.md; operational domain upserts in scripts are not listed), but verify before completing 85-04
- The `inventory_unit_types.name` column remains globally non-unique — if uniqueness per tenant is desired in the future, a `ADD CONSTRAINT inventory_unit_types_tenant_name_unique UNIQUE (tenant_id, name)` migration can be added as a separate step

## Next Phase Readiness

- [x] Operational domain constraints migrated and verified
- [x] Migration file committed and applied to remote Supabase
- [x] TypeScript build unaffected (no type changes needed; affected tables are not modeled in src/types/)
- [ ] Plan 85-04: Update `onConflict` clauses in app code and scripts for all three domains (KDS, COGS/Square, operational)
