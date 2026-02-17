# Phase 85: Multi-Tenant Schema Constraint Migration - Research

**Researched:** 2026-02-16
**Domain:** PostgreSQL schema DDL, Supabase upsert patterns, multi-tenant constraint naming
**Confidence:** HIGH — all findings derived from reading actual migration files and source code

---

## Summary

Phase 85 replaces single-column UNIQUE constraints with composite `(tenant_id, field)` constraints across 12 tables. Research revealed several important discrepancies between the CONTEXT.md (which uses conceptual names from the audit) and the actual database schema. These must be corrected before planning begins.

The CONTEXT.md uses four incorrect table/column names. Application code has no constraint-name string references in admin UI error handling. All `ON CONFLICT` upsert patterns were found and catalogued. Scripts (not just API routes) also need updates and are out of scope for plan 85-04 unless explicitly added.

**Primary recommendation:** Correct the CONTEXT.md table name errors before writing DDL. Use the actual table names found in migrations. Plan 85-04 must include both `src/` API routes and `scripts/` files.

---

## Critical Corrections to CONTEXT.md

The CONTEXT.md contains four naming errors that came from the v1.0 milestone audit, which used conceptual names rather than actual schema names.

| CONTEXT.md Name | Actual Table Name | Evidence |
|-----------------|-------------------|---------|
| `cogs_product_variations` | `cogs_sellables` | `20251213170000_create_cogs_theoretical_phase2.sql:21` |
| `cogs_modifier_lists` | `cogs_modifier_sets` | `20251213190000_create_cogs_modifiers_phase3.sql:7` |
| `measurement_units` | `inventory_unit_types` | `20250810163053_create_inventory_settings_tables.sql:32` |
| `inventory_items — name` | `inventory_items — square_item_id, pack_size` | See section below |

**The `inventory_items` situation deserves special explanation:**

The CONTEXT.md states: `inventory_items — name → UNIQUE(tenant_id, name)`. This is wrong in two ways:

1. The `inventory_items` table has no column named `name` — the column is `item_name`.
2. `item_name` has no UNIQUE constraint.

The actual unique constraint on `inventory_items` is a partial composite index created in `20251123134500_update_inventory_unique_pack_size.sql`:

```sql
create unique index if not exists inventory_items_square_pack_unique
  on inventory_items (square_item_id, pack_size)
  where square_item_id is not null;
```

This index is NOT tenant-scoped and IS a blocker for multi-tenant use. It needs to become `(tenant_id, square_item_id, pack_size) WHERE square_item_id IS NOT NULL`.

---

## Current Constraint Names

Actual PostgreSQL constraint names (from migration files), in order by domain:

### KDS Domain

| Table | Column | How Defined | Current Constraint Name |
|-------|--------|-------------|------------------------|
| `kds_settings` | `key` | `key text UNIQUE NOT NULL` (inline) | `kds_settings_key_key` |
| `kds_images` | `filename` | `ADD CONSTRAINT kds_images_filename_unique UNIQUE (filename)` | `kds_images_filename_unique` |
| `kds_menu_items` | `square_variation_id` | `CREATE UNIQUE INDEX idx_kds_menu_items_square_variation_id_unique ON kds_menu_items (square_variation_id) WHERE square_variation_id IS NOT NULL` | `idx_kds_menu_items_square_variation_id_unique` (partial index, NOT a CONSTRAINT) |

Source files:
- `supabase/migrations/20260125100000_create_kds_tables.sql` — kds_settings
- `supabase/migrations/20260125100001_add_kds_unique_constraints.sql` — kds_images, kds_menu_items

### COGS/Square Domain

| Table | Column | How Defined | Current Constraint Name |
|-------|--------|-------------|------------------------|
| `cogs_products` | `square_item_id` | `square_item_id text not null unique` (inline) | `cogs_products_square_item_id_key` |
| `cogs_products` | `product_code` | `CREATE UNIQUE INDEX idx_cogs_products_product_code_unique ON cogs_products (lower(product_code)) WHERE product_code IS NOT NULL` | `idx_cogs_products_product_code_unique` (partial expression index) |
| `cogs_sellables` | `square_variation_id` | `square_variation_id text not null unique` (inline) | `cogs_sellables_square_variation_id_key` |
| `cogs_sellable_aliases` | `square_variation_id` | `square_variation_id text not null unique` (inline) | `cogs_sellable_aliases_square_variation_id_key` |
| `cogs_modifier_sets` | `square_modifier_list_id` | `square_modifier_list_id text not null unique` (inline) | `cogs_modifier_sets_square_modifier_list_id_key` |
| `cogs_modifier_options` | `square_modifier_id` | `square_modifier_id text not null unique` (inline) | `cogs_modifier_options_square_modifier_id_key` |

Source files:
- `supabase/migrations/20251213170000_create_cogs_theoretical_phase2.sql` — cogs_products, cogs_sellables, cogs_sellable_aliases
- `supabase/migrations/20251213190000_create_cogs_modifiers_phase3.sql` — cogs_modifier_sets, cogs_modifier_options
- `supabase/migrations/20251217190000_add_product_code_to_cogs_products.sql` — cogs_products product_code

**Note on `cogs_sellable_aliases`:** The CONTEXT.md does not list this table but it has `square_variation_id text not null unique`. It is a historical alias table — consider whether it needs the composite constraint. Since it references `cogs_sellables.id` rather than being a primary write path, the planner should decide.

### Operational Domain

| Table | Column | How Defined | Current Constraint Name |
|-------|--------|-------------|------------------------|
| `inventory_items` | `(square_item_id, pack_size)` | `CREATE UNIQUE INDEX inventory_items_square_pack_unique ON inventory_items (square_item_id, pack_size) WHERE square_item_id IS NOT NULL` | `inventory_items_square_pack_unique` (partial composite index) |
| `suppliers` | `name` | `name text not null unique` (inline) | `suppliers_name_key` |
| `inventory_unit_types` | `name` | `name text not null unique` (inline) | `inventory_unit_types_name_key` |
| `inventory_unit_types` | `symbol` | `symbol text not null unique` (inline) | `inventory_unit_types_symbol_key` |
| `purchase_orders` | `order_number` | `order_number text unique` (inline, nullable) | `purchase_orders_order_number_key` |

Source files:
- `supabase/migrations/20250810001942_create_inventory_system.sql` — suppliers, inventory_items (original), purchase_orders
- `supabase/migrations/20250810163053_create_inventory_settings_tables.sql` — inventory_unit_types
- `supabase/migrations/20251123134500_update_inventory_unique_pack_size.sql` — inventory_items current state

---

## New Constraint Names

Proposed names after migration (following PostgreSQL naming convention for ADD CONSTRAINT):

### KDS Domain

| Table | New Constraint Name | Columns |
|-------|--------------------|---------|
| `kds_settings` | `kds_settings_tenant_key_unique` | `(tenant_id, key)` |
| `kds_images` | `kds_images_tenant_filename_unique` | `(tenant_id, filename)` |
| `kds_menu_items` | `idx_kds_menu_items_tenant_variation_unique` | `(tenant_id, square_variation_id) WHERE square_variation_id IS NOT NULL` (index, not constraint) |

### COGS/Square Domain

| Table | New Constraint Name | Columns |
|-------|--------------------|---------|
| `cogs_products` | `cogs_products_tenant_square_item_id_unique` | `(tenant_id, square_item_id)` |
| `cogs_products` | `idx_cogs_products_tenant_product_code_unique` | `(tenant_id, lower(product_code)) WHERE product_code IS NOT NULL` (index) |
| `cogs_sellables` | `cogs_sellables_tenant_square_variation_id_unique` | `(tenant_id, square_variation_id)` |
| `cogs_modifier_sets` | `cogs_modifier_sets_tenant_square_modifier_list_id_unique` | `(tenant_id, square_modifier_list_id)` |
| `cogs_modifier_options` | `cogs_modifier_options_tenant_square_modifier_id_unique` | `(tenant_id, square_modifier_id)` |

### Operational Domain

| Table | New Constraint Name | Columns |
|-------|--------------------|---------|
| `inventory_items` | `inventory_items_tenant_square_pack_unique` | `(tenant_id, square_item_id, pack_size) WHERE square_item_id IS NOT NULL` (index) |
| `suppliers` | `suppliers_tenant_name_unique` | `(tenant_id, name)` |
| `inventory_unit_types` | `inventory_unit_types_tenant_name_unique` | `(tenant_id, name)` |
| `inventory_unit_types` | `inventory_unit_types_tenant_symbol_unique` | `(tenant_id, symbol)` |
| `purchase_orders` | `purchase_orders_tenant_order_number_unique` | `(tenant_id, order_number)` |

---

## ON CONFLICT Clauses to Update

All Supabase `.upsert()` calls with `onConflict` that reference affected tables. Supabase JS client uses comma-separated column names for composite conflicts.

### Application Code (`src/`)

**File:** `src/lib/kds/queries.ts`

| Line | Current | Must Become |
|------|---------|-------------|
| 296 | `onConflict: 'slug'` | `onConflict: 'slug'` — **NOT in scope** (`kds_categories` not listed) |
| 341 | `onConflict: 'square_variation_id'` | `onConflict: 'tenant_id,square_variation_id'` |
| 368 | `onConflict: 'filename'` | `onConflict: 'tenant_id,filename'` |
| 396 | `onConflict: 'key'` | `onConflict: 'tenant_id,key'` |

**File:** `src/app/api/admin/cogs/catalog/sync-square/route.ts`

| Line | Current | Must Become |
|------|---------|-------------|
| 205 | `.upsert(..., { onConflict: 'square_item_id' })` on `cogs_products` | `onConflict: 'tenant_id,square_item_id'` |
| 246 | `.upsert(..., { onConflict: 'square_variation_id' })` on `cogs_sellables` | `onConflict: 'tenant_id,square_variation_id'` |

**Not a conflict issue:**
- `src/app/api/square/customers/cards/route.ts:51` — `onConflict: 'id'` (PK, not affected)
- `src/app/api/square/customers/save-card/route.ts:87` — `onConflict: 'id'` (PK, not affected)
- `src/app/api/admin/suppliers/[supplierId]/email-templates/route.ts:146` — `onConflict: 'supplier_id,template_type'` (already composite, not affected)

### Scripts (`scripts/`)

**File:** `scripts/seed-cogs-recipes.ts`

| Line | Current | Must Become | Also Needs |
|------|---------|-------------|------------|
| 565 | `onConflict: 'square_modifier_list_id'` on `cogs_modifier_sets` | `onConflict: 'tenant_id,square_modifier_list_id'` | Add `tenant_id` to upsert payload |
| 578 | `onConflict: 'square_modifier_id'` on `cogs_modifier_options` | `onConflict: 'tenant_id,square_modifier_id'` | Add `tenant_id` to upsert payload |

**File:** `scripts/simulate-cogs-sales.ts`

| Line | Current | Must Become | Also Needs |
|------|---------|-------------|------------|
| 424 | `onConflict: 'square_item_id'` on `cogs_products` | `onConflict: 'tenant_id,square_item_id'` | Add `tenant_id` to upsert payload |
| 450 | `onConflict: 'square_variation_id'` on `cogs_sellables` | `onConflict: 'tenant_id,square_variation_id'` | Add `tenant_id` to upsert payload |

**File:** `scripts/import-kds-menu-from-sheets.js`

| Line | Current | Must Become | Also Needs |
|------|---------|-------------|------------|
| 337 | `onConflict: 'slug'` on `kds_categories` | Not in scope for this phase | — |
| 483 | `onConflict: 'filename'` on `kds_images` | `onConflict: 'tenant_id,filename'` | Add `tenant_id` to transformImage return |
| 507 | `onConflict: 'key'` on `kds_settings` | `onConflict: 'tenant_id,key'` | Add `tenant_id` to transformSetting return |

**Key finding:** Scripts do not include `tenant_id` in their upsert payloads. After the migration, `ON CONFLICT(tenant_id, field)` will fail if `tenant_id` is absent from the row. Both the `onConflict` string AND the payload must be updated.

**Migration seeds in migrations themselves:**

These are seed INSERT statements inside migration files that use `ON CONFLICT (key) DO NOTHING`:
- `supabase/migrations/20260125100000_create_kds_tables.sql:67` — `ON CONFLICT (key) DO NOTHING` (initial seed)
- `supabase/migrations/20260126100000_kds_warm_theme_schema.sql:43` — `ON CONFLICT (key) DO NOTHING`
- `supabase/migrations/20260131100000_kds_display_types.sql:22` — `ON CONFLICT (key) DO NOTHING`
- `supabase/migrations/20250810001942_create_inventory_system.sql:174` — `ON CONFLICT (name) DO NOTHING` on suppliers
- `supabase/migrations/20250810163053_create_inventory_settings_tables.sql:70,82` — `ON CONFLICT (name)` and `ON CONFLICT (symbol)` on inventory_unit_types

These historical migration seeds DO NOT need updating — they are already applied and will not re-run. Only future migration seeds (in phases 85-01 through 85-03 themselves) should use the composite constraint.

---

## Admin UI Constraint Error References

**Finding: None exist.**

A comprehensive search for PostgreSQL error code `23505` and constraint name strings (`suppliers_name_key`, `_key_key`, etc.) across all `src/` TypeScript files found NO places where admin UI code checks specific constraint names.

The only `23505` reference is in `src/app/api/favorites/route.ts:86` which handles user_favorites (not in scope).

All admin routes handle unique constraint violations by either:
1. Pre-checking for duplicates before INSERT (e.g., `inventory/units/route.ts` checks `symbol` existence before inserting)
2. Returning the raw Supabase error message via `{ error: error.message }` without parsing constraint names

**Implication:** Plan 85-04 has NO admin UI error handling to update. The only work is the `onConflict` clause updates.

---

## Migration Naming Convention

**Format:** `YYYYMMDDHHMMSS_description.sql`

**Examples from recent migrations:**
- `20260216000000_create_tenant_status_enum.sql`
- `20260216000001_create_platform_admins_table.sql`
- `20260216000002_add_tenant_soft_delete.sql`
- `20260216100000_create_square_oauth_functions.sql`
- `20260216200000_setup_trial_expiration_cron.sql`
- `20260216300000_fix_platform_admins_rls.sql`
- `20260216400000_fix_site_settings_pk.sql`

**Pattern:** `YYYYMMDD` + time suffix in hundreds (0000, 1000, 2000, etc. — allows up to 10 migrations per day without collision). Multiple same-day migrations increment the hour portion. The last migration is `20260216400000`.

**Proposed timestamps for phase 85 migrations (today is 2026-02-16):**
- 85-01 KDS DDL: `20260217000000`
- 85-02 COGS/Square DDL: `20260217100000`
- 85-03 Operational DDL: `20260217200000`
- App code fixes (85-04) require no migration file.

---

## TypeScript Type Changes

**Finding: No type changes needed.**

The project has NO generated database types file (no `database.types.ts`). Types in `src/types/` are hand-crafted and describe API response shapes, not database schema. The affected tables are not modeled as TypeScript interfaces in `src/types/`.

The Supabase client is untyped for these tables — queries use `supabase.from('table_name').select(...)` without generic type parameters for the affected tables.

---

## Index Conflicts

**Conflicts that require DROP before ADD:**

All unique constraints defined as inline `UNIQUE` in `CREATE TABLE` can be dropped with `ALTER TABLE ... DROP CONSTRAINT`. All unique constraints defined as `CREATE UNIQUE INDEX` must be dropped with `DROP INDEX`.

| Table | Current Object | Type | DROP Command |
|-------|----------------|------|-------------|
| `kds_settings` | `kds_settings_key_key` | CONSTRAINT (inline) | `ALTER TABLE kds_settings DROP CONSTRAINT kds_settings_key_key` |
| `kds_images` | `kds_images_filename_unique` | CONSTRAINT (named) | `ALTER TABLE kds_images DROP CONSTRAINT kds_images_filename_unique` |
| `kds_menu_items` | `idx_kds_menu_items_square_variation_id_unique` | INDEX | `DROP INDEX idx_kds_menu_items_square_variation_id_unique` |
| `cogs_products` | `cogs_products_square_item_id_key` | CONSTRAINT (inline) | `ALTER TABLE cogs_products DROP CONSTRAINT cogs_products_square_item_id_key` |
| `cogs_products` | `idx_cogs_products_product_code_unique` | INDEX | `DROP INDEX idx_cogs_products_product_code_unique` |
| `cogs_sellables` | `cogs_sellables_square_variation_id_key` | CONSTRAINT (inline) | `ALTER TABLE cogs_sellables DROP CONSTRAINT cogs_sellables_square_variation_id_key` |
| `cogs_modifier_sets` | `cogs_modifier_sets_square_modifier_list_id_key` | CONSTRAINT (inline) | `ALTER TABLE cogs_modifier_sets DROP CONSTRAINT cogs_modifier_sets_square_modifier_list_id_key` |
| `cogs_modifier_options` | `cogs_modifier_options_square_modifier_id_key` | CONSTRAINT (inline) | `ALTER TABLE cogs_modifier_options DROP CONSTRAINT cogs_modifier_options_square_modifier_id_key` |
| `inventory_items` | `inventory_items_square_pack_unique` | INDEX | `DROP INDEX inventory_items_square_pack_unique` |
| `suppliers` | `suppliers_name_key` | CONSTRAINT (inline) | `ALTER TABLE suppliers DROP CONSTRAINT suppliers_name_key` |
| `inventory_unit_types` | `inventory_unit_types_name_key` | CONSTRAINT (inline) | `ALTER TABLE inventory_unit_types DROP CONSTRAINT inventory_unit_types_name_key` |
| `inventory_unit_types` | `inventory_unit_types_symbol_key` | CONSTRAINT (inline) | `ALTER TABLE inventory_unit_types DROP CONSTRAINT inventory_unit_types_symbol_key` |
| `purchase_orders` | `purchase_orders_order_number_key` | CONSTRAINT (inline) | `ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_order_number_key` |

**Manual indexes that will NOT conflict** (they are regular non-unique indexes on single columns that become redundant once composite index is created, but do not conflict):
- `idx_kds_menu_items_square` on `kds_menu_items(square_item_id)` — regular index, not unique
- `idx_kds_images_screen` on `kds_images(screen, is_active, sort_order)` — no overlap
- `idx_suppliers_tenant_id` on `suppliers(tenant_id)` — regular index, not unique
- All other `idx_*_tenant_id` indexes — regular, no conflict

---

## Implementation Notes

### DDL Pattern for Each Migration

Each migration file wraps all DDL in a single transaction. For a constraint defined with inline `UNIQUE`:

```sql
BEGIN;

-- Drop old single-column constraint
ALTER TABLE public.table_name DROP CONSTRAINT table_name_column_key;

-- Add composite constraint
ALTER TABLE public.table_name
  ADD CONSTRAINT table_name_tenant_column_unique UNIQUE (tenant_id, column_name);

COMMIT;
```

For constraints defined as `CREATE UNIQUE INDEX` (partial or expression):

```sql
BEGIN;

-- Drop old index
DROP INDEX IF EXISTS idx_table_name_old_unique;

-- Create composite index (same partial condition if applicable)
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_name_tenant_new_unique
  ON public.table_name (tenant_id, column_name)
  WHERE column_name IS NOT NULL;

COMMIT;
```

### kds_menu_items Special Case

`kds_menu_items.square_variation_id` has a partial index (WHERE NOT NULL). The replacement should also be partial:

```sql
DROP INDEX IF EXISTS idx_kds_menu_items_square_variation_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kds_menu_items_tenant_variation_unique
  ON public.kds_menu_items (tenant_id, square_variation_id)
  WHERE square_variation_id IS NOT NULL;
```

### cogs_products product_code Special Case

The `product_code` partial index uses `lower(product_code)` (a function/expression index) for case-insensitive uniqueness. The composite version must preserve this:

```sql
DROP INDEX IF EXISTS idx_cogs_products_product_code_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cogs_products_tenant_product_code_unique
  ON public.cogs_products (tenant_id, lower(product_code))
  WHERE product_code IS NOT NULL;
```

### inventory_items Special Case

The current constraint is a composite partial index `(square_item_id, pack_size)`. Adding `tenant_id`:

```sql
DROP INDEX IF EXISTS inventory_items_square_pack_unique;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_tenant_square_pack_unique
  ON public.inventory_items (tenant_id, square_item_id, pack_size)
  WHERE square_item_id IS NOT NULL;
```

### Supabase onConflict Syntax

Composite conflicts in Supabase JS client use comma-separated column names as a single string:

```typescript
// Single column (current)
.upsert(rows, { onConflict: 'square_item_id' })

// Composite (after migration)
.upsert(rows, { onConflict: 'tenant_id,square_item_id' })
```

Confirmed by existing usage at `src/app/api/admin/suppliers/[supplierId]/email-templates/route.ts:146`:
```typescript
.upsert(upsertPayload, { onConflict: 'supplier_id,template_type' })
```

**Important:** Supabase generates the underlying PostgreSQL `ON CONFLICT` clause. For this to work, a unique constraint or index must exist on exactly the specified columns. The column order in the string does not matter for PostgreSQL conflict resolution, but it must match a declared constraint/index.

For expression indexes (like `lower(product_code)`), Supabase cannot express expression conflicts via `onConflict`. The `import-cogs-product-codes-from-sheets.ts` script uses `UPDATE` not upsert for product_code, so no change is needed there.

### Script Scope for 85-04

Plan 85-04 was specified as "App code: ON CONFLICT clause updates + constraint error name fixes in admin UI". Research found that:
1. Admin UI has no constraint name string checks to fix.
2. Scripts in `scripts/` also need updating.

The planner must decide whether script updates go in 85-04 or are out of scope. Recommendation: include them in 85-04 since they will break immediately after the DDL migrations run if left unchanged.

### kds_categories Not in Scope

`kds_categories.slug` has a single-column UNIQUE (`kds_categories_slug_key`). The import script uses `onConflict: 'slug'`. `kds_categories` is NOT listed in the CONTEXT.md scope. Do not migrate it in this phase.

### cogs_sellable_aliases: Implicit Scope Question

`cogs_sellable_aliases` has `square_variation_id text not null unique` (`cogs_sellable_aliases_square_variation_id_key`). It is NOT listed in the CONTEXT.md. The planner should decide: is it also a blocker? It is used for historical Square variation IDs — if two tenants could have overlapping historical variation IDs, this needs migration. Given the pattern with other Square ID tables, it should be included in 85-02.

---

## Open Questions

1. **inventory_items — does `name` constraint need to be added fresh?**
   - What we know: The column `item_name` has no unique constraint. The CONTEXT.md says `name → UNIQUE(tenant_id, name)`.
   - What's unclear: Was the intent to add a NEW `UNIQUE(tenant_id, item_name)` constraint (not replacing an existing one), or was this an error in the audit?
   - Recommendation: Treat the `inventory_items` scope as migrating `inventory_items_square_pack_unique` to `(tenant_id, square_item_id, pack_size)`. Do NOT add a new `UNIQUE(tenant_id, item_name)` constraint unless explicitly confirmed, as `item_name` uniqueness was never part of the schema.

2. **cogs_sellable_aliases: in or out of scope?**
   - What we know: Has `square_variation_id text not null unique`. Not in CONTEXT.md.
   - Recommendation: Include in 85-02 alongside `cogs_sellables`. They have the same Square ID pattern and the same multi-tenant blocker.

3. **Scripts: in or out of 85-04?**
   - What we know: `scripts/seed-cogs-recipes.ts` and `scripts/simulate-cogs-sales.ts` and `scripts/import-kds-menu-from-sheets.js` all have onConflict patterns that will break.
   - Recommendation: Include in 85-04. Scripts that fail silently after migration are worse than scripts that have been updated.

---

## Sources

### Primary (HIGH confidence)

All findings are from direct code reading:

- `supabase/migrations/20260125100000_create_kds_tables.sql` — KDS table definitions, kds_settings UNIQUE
- `supabase/migrations/20260125100001_add_kds_unique_constraints.sql` — kds_images and kds_menu_items UNIQUE
- `supabase/migrations/20250810001942_create_inventory_system.sql` — suppliers, inventory_items, purchase_orders
- `supabase/migrations/20250810163053_create_inventory_settings_tables.sql` — inventory_unit_types (measurement_units)
- `supabase/migrations/20251123134500_update_inventory_unique_pack_size.sql` — inventory_items current constraint state
- `supabase/migrations/20251213170000_create_cogs_theoretical_phase2.sql` — cogs_products, cogs_sellables
- `supabase/migrations/20251213190000_create_cogs_modifiers_phase3.sql` — cogs_modifier_sets, cogs_modifier_options
- `supabase/migrations/20251217190000_add_product_code_to_cogs_products.sql` — product_code partial index
- `src/lib/kds/queries.ts` — KDS upsert patterns
- `src/app/api/admin/cogs/catalog/sync-square/route.ts` — cogs_products and cogs_sellables upserts
- `scripts/seed-cogs-recipes.ts` — modifier set/option upserts
- `scripts/simulate-cogs-sales.ts` — cogs_products and cogs_sellables upserts
- `scripts/import-kds-menu-from-sheets.js` — KDS image/setting upserts
- `.planning/v1.0-MILESTONE-AUDIT.md` — constraint inventory from audit

---

## Metadata

**Confidence breakdown:**
- Current constraint names: HIGH — derived from migration files that created them
- ON CONFLICT clauses: HIGH — exhaustive grep across src/ and scripts/
- Admin UI error references: HIGH — comprehensive search returned no results
- New constraint names: HIGH — derived from naming convention analysis
- Index conflicts: HIGH — derived from all migration files

**Research date:** 2026-02-16
**Valid until:** No expiry — all findings are code-derived, not from external sources
