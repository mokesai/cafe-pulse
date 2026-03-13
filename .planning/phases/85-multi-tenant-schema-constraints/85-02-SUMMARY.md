---
phase: 85-multi-tenant-schema-constraints
plan: 02
subsystem: data
tags: [postgresql, migrations, unique-constraints, cogs, multi-tenant, supabase]

requires:
  - 85-01-KDS-DDL-migration

provides:
  - composite UNIQUE constraints on all six COGS/Square tables
  - cogs_products_tenant_square_item_id_unique (tenant_id, square_item_id)
  - idx_cogs_products_tenant_product_code_unique (tenant_id, lower(product_code)) WHERE product_code IS NOT NULL
  - cogs_sellables_tenant_square_variation_id_unique (tenant_id, square_variation_id)
  - cogs_sellable_aliases_tenant_square_variation_id_unique (tenant_id, square_variation_id)
  - cogs_modifier_sets_tenant_square_modifier_list_id_unique (tenant_id, square_modifier_list_id)
  - cogs_modifier_options_tenant_square_modifier_id_unique (tenant_id, square_modifier_id)

affects:
  - 85-04 app code — onConflict clauses in sync-square/route.ts and scripts must be updated to tenant_id,field

tech-stack:
  added: []
  patterns:
    - composite (tenant_id, field) UNIQUE constraints replacing single-column UNIQUE constraints
    - expression index preserved for case-insensitive product_code with tenant scoping added

key-files:
  created:
    - supabase/migrations/20260217100000_composite_cogs_unique_constraints.sql
  modified: []

decisions:
  - id: DEC-01
    choice: Include cogs_sellable_aliases in 85-02 scope (not in CONTEXT.md but has same pattern)
    rationale: cogs_sellable_aliases has square_variation_id text not null unique — same multi-tenant blocker as other COGS tables; including prevents constraint violation for historical alias lookups with two tenants sharing Square catalog IDs
  - id: DEC-02
    choice: Wrap all 6 operations in a single BEGIN/COMMIT transaction
    rationale: Atomic application — either all constraints migrate or none do; consistent with Phase 20 and 80 migration patterns

metrics:
  duration: 2 minutes
  completed: 2026-02-17
---

# Phase 85 Plan 02: COGS/Square Composite Unique Constraints Summary

**One-liner:** Replaced six single-column UNIQUE constraints across five COGS/Square tables with composite `(tenant_id, field)` constraints so two tenants can sync their Square catalogs without constraint violations.

## What Shipped

- Migration `20260217100000_composite_cogs_unique_constraints.sql` written and applied to dev Supabase (`ofppjltowsdvojixeflr`)
- `cogs_products`: `cogs_products_square_item_id_key` dropped, `cogs_products_tenant_square_item_id_unique(tenant_id, square_item_id)` added
- `cogs_products`: `idx_cogs_products_product_code_unique` dropped, `idx_cogs_products_tenant_product_code_unique(tenant_id, lower(product_code)) WHERE product_code IS NOT NULL` created (preserves expression and partial index behavior, adds tenant scoping)
- `cogs_sellables`: `cogs_sellables_square_variation_id_key` dropped, `cogs_sellables_tenant_square_variation_id_unique(tenant_id, square_variation_id)` added
- `cogs_sellable_aliases`: `cogs_sellable_aliases_square_variation_id_key` dropped, `cogs_sellable_aliases_tenant_square_variation_id_unique(tenant_id, square_variation_id)` added
- `cogs_modifier_sets`: `cogs_modifier_sets_square_modifier_list_id_key` dropped, `cogs_modifier_sets_tenant_square_modifier_list_id_unique(tenant_id, square_modifier_list_id)` added
- `cogs_modifier_options`: `cogs_modifier_options_square_modifier_id_key` dropped, `cogs_modifier_options_tenant_square_modifier_id_unique(tenant_id, square_modifier_id)` added
- All 7 must-haves verified: 5 new composite constraints confirmed in information_schema, 0 old single-column constraints remain, new product_code expression index confirmed in pg_indexes

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Include cogs_sellable_aliases (not in CONTEXT.md) | Has same `square_variation_id text not null unique` pattern as other COGS tables — same multi-tenant blocker; RESEARCH.md explicitly notes this as implicit scope | Constraint added; six total operations (not five) in migration |
| Single transaction for all 6 operations | Atomic — either all succeed or all roll back; consistent with Phase 20 and Phase 80 migration patterns | All operations committed atomically |

## Deviations from Plan

None — plan executed exactly as written. The `cogs_sellable_aliases` inclusion was explicitly noted in the plan (`Note: cogs_sellable_aliases is included`) so it was not a deviation.

## Follow-ups

- **85-04 (app code)**: `src/app/api/admin/cogs/catalog/sync-square/route.ts` has two `.upsert()` calls with `onConflict: 'square_item_id'` and `onConflict: 'square_variation_id'` that must be updated to `onConflict: 'tenant_id,square_item_id'` and `onConflict: 'tenant_id,square_variation_id'` respectively
- **85-04 (scripts)**: `scripts/seed-cogs-recipes.ts` (modifier_sets, modifier_options upserts) and `scripts/simulate-cogs-sales.ts` (cogs_products, cogs_sellables upserts) need onConflict and payload updates
