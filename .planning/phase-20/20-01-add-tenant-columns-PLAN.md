---
phase: 20-schema-migration
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20260213200000_add_tenant_id_columns.sql
  - supabase/migrations/20260213200099_rollback_tenant_id.sql
autonomous: false

must_haves:
  truths:
    - "All 48 tenant-scoped tables have a tenant_id column"
    - "All existing rows have tenant_id = '00000000-0000-0000-0000-000000000001'"
    - "Zero rows have NULL tenant_id across all 48 tables"
    - "Row counts are identical before and after migration"
    - "New INSERTs without tenant_id get the default value automatically"
  artifacts:
    - path: "supabase/migrations/20260213200000_add_tenant_id_columns.sql"
      provides: "Stage 1 migration: add tenant_id column to all 48 tables"
      contains: "ALTER TABLE"
    - path: "supabase/migrations/20260213200099_rollback_tenant_id.sql"
      provides: "Rollback script to remove tenant_id from all tables"
      contains: "DROP COLUMN"
  key_links:
    - from: "tenant_id DEFAULT"
      to: "tenants.id = '00000000-0000-0000-0000-000000000001'"
      via: "PostgreSQL DEFAULT value matches seeded default tenant"
      pattern: "00000000-0000-0000-0000-000000000001"
---

<objective>
Add `tenant_id uuid` column with DEFAULT to all 48 tenant-scoped tables.

Purpose: This is Stage 1 of the three-stage schema migration. PostgreSQL 11+ handles `ALTER TABLE ADD COLUMN ... DEFAULT <constant>` as a metadata-only operation -- no table rewrite, no row locking, instant regardless of row count. All existing rows will read the default value on access. This also creates the rollback script for the entire Phase 20 migration.

Output: Two SQL migration files -- the Stage 1 forward migration and the full rollback script.
</objective>

<execution_context>
@~/.gsd/workflows/execute-plan.md
@~/.gsd/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phase-20/20-CONTEXT.md
@.planning/phase-20/20-RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create Stage 1 migration and rollback SQL files</name>
  <files>
    supabase/migrations/20260213200000_add_tenant_id_columns.sql
    supabase/migrations/20260213200099_rollback_tenant_id.sql
  </files>
  <action>
Create two SQL files.

**File 1: `supabase/migrations/20260213200000_add_tenant_id_columns.sql`**

This file adds `tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'` to all 48 tenant-scoped tables. Use `ADD COLUMN IF NOT EXISTS` for idempotency. No BEGIN/COMMIT needed -- each ALTER TABLE is atomic. No FK ordering required for Stage 1.

Add a header comment explaining:
- This is Stage 1 of 3 for Phase 20 (Schema Migration -- Add tenant_id)
- PostgreSQL 11+ metadata-only operation, instant regardless of row count
- DEFAULT is kept intentionally so existing app code continues to work
- FK constraints and NOT NULL added in Stage 2
- Indexes added in Stage 3

The complete SQL (all 48 tables, copy-paste ready):

```sql
-- Phase 20, Stage 1: Add tenant_id columns to all tenant-scoped tables
-- PostgreSQL 11+ metadata-only operation: instant, no table rewrite, no locking
-- DEFAULT kept so existing app code continues inserting without specifying tenant_id
-- FK constraints + NOT NULL: Stage 2 | Indexes: Stage 3

-- Tier 0: Standalone tables
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.inventory_locations ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.inventory_unit_types ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.inventory_settings ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.webhook_events ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.user_favorites ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.user_addresses ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_periods ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_products ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_modifier_sets ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';

-- Tier 1: Reference Tier 0 tables
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.supplier_email_templates ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_reports ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_sellables ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_modifier_options ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.inventory_sales_sync_runs ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.kds_categories ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';

-- Tier 2: Reference Tier 1 tables
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.low_stock_alerts ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.recipe_ingredients ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.order_invoice_matches ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.supplier_invoice_templates ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.invoice_import_sessions ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.inventory_valuations ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.inventory_item_cost_history ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_sellable_aliases ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_product_recipes ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_sellable_recipe_overrides ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_modifier_option_recipes ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.kds_menu_items ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.kds_settings ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.kds_images ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.sales_transaction_items ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';

-- Tier 3: Reference Tier 2 tables
ALTER TABLE public.purchase_order_status_history ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.purchase_order_attachments ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.purchase_order_receipts ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_product_recipe_lines ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_sellable_recipe_override_ops ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE public.cogs_modifier_option_recipe_lines ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
```

**File 2: `supabase/migrations/20260213200099_rollback_tenant_id.sql`**

This file is NOT applied as a migration. It is a rollback script stored alongside the migrations for reference. Add a header comment: "ROLLBACK SCRIPT -- DO NOT APPLY AS MIGRATION. Run manually to reverse Phase 20."

Drop order does not matter since DROP COLUMN cascades FK constraints automatically.

```sql
-- ROLLBACK SCRIPT for Phase 20 (Schema Migration -- Add tenant_id)
-- DO NOT APPLY AS MIGRATION -- run manually only if Phase 20 must be reversed
-- Drops tenant_id column from all 48 tenant-scoped tables
-- FK constraints and indexes are automatically dropped with the column

ALTER TABLE public.orders DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.inventory_locations DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.inventory_unit_types DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.inventory_settings DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.notifications DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.webhook_events DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.site_settings DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.user_favorites DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.user_addresses DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_periods DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_products DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_modifier_sets DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.order_items DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.purchase_orders DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.invoices DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.supplier_email_templates DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_reports DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_sellables DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_modifier_options DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.inventory_sales_sync_runs DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.kds_categories DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.sales_transactions DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.stock_movements DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.purchase_order_items DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.low_stock_alerts DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.recipe_ingredients DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.invoice_items DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.order_invoice_matches DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.supplier_invoice_templates DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.invoice_import_sessions DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.inventory_valuations DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.inventory_item_cost_history DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_sellable_aliases DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_product_recipes DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_sellable_recipe_overrides DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_modifier_option_recipes DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.kds_menu_items DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.kds_settings DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.kds_images DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.sales_transaction_items DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.purchase_order_status_history DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.purchase_order_attachments DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.purchase_order_receipts DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_product_recipe_lines DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_sellable_recipe_override_ops DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.cogs_modifier_option_recipe_lines DROP COLUMN IF EXISTS tenant_id;
```
  </action>
  <verify>
Both files exist and contain exactly 48 ALTER TABLE statements each. Verify with:
- `grep -c "ALTER TABLE" supabase/migrations/20260213200000_add_tenant_id_columns.sql` should output 48
- `grep -c "ALTER TABLE" supabase/migrations/20260213200099_rollback_tenant_id.sql` should output 48
  </verify>
  <done>Both SQL files exist with all 48 tables listed explicitly. Stage 1 migration uses ADD COLUMN IF NOT EXISTS with DEFAULT. Rollback uses DROP COLUMN IF EXISTS.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Apply Stage 1 migration and verify</name>
  <what-built>Stage 1 SQL migration file that adds tenant_id to all 48 tables, plus a rollback script.</what-built>
  <how-to-verify>
**IMPORTANT: Verify you are on the DEV database (ofppjltowsdvojixeflr) before proceeding.**

1. **Capture baseline row counts** (run in Supabase SQL Editor BEFORE applying Stage 1):
```sql
DO $$
DECLARE
  tbl text;
  row_count bigint;
  tables text[] := ARRAY[
    'orders', 'order_items', 'user_favorites', 'user_addresses', 'notifications',
    'inventory_items', 'stock_movements', 'inventory_settings', 'inventory_locations',
    'inventory_unit_types', 'low_stock_alerts', 'inventory_sales_sync_runs',
    'inventory_item_cost_history', 'inventory_valuations',
    'purchase_orders', 'purchase_order_items', 'purchase_order_status_history',
    'purchase_order_attachments', 'purchase_order_receipts',
    'invoices', 'invoice_items', 'order_invoice_matches',
    'supplier_invoice_templates', 'invoice_import_sessions',
    'suppliers', 'supplier_email_templates',
    'cogs_periods', 'cogs_reports', 'cogs_products', 'cogs_sellables',
    'cogs_sellable_aliases', 'cogs_product_recipes', 'cogs_product_recipe_lines',
    'cogs_sellable_recipe_overrides', 'cogs_sellable_recipe_override_ops',
    'cogs_modifier_sets', 'cogs_modifier_options',
    'cogs_modifier_option_recipes', 'cogs_modifier_option_recipe_lines',
    'kds_categories', 'kds_menu_items', 'kds_settings', 'kds_images',
    'sales_transactions', 'sales_transaction_items',
    'recipe_ingredients', 'webhook_events', 'site_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM public.%I', tbl) INTO row_count;
    RAISE NOTICE 'Table %: % rows', tbl, row_count;
  END LOOP;
END $$;
```

2. **Apply Stage 1**: Copy the contents of `supabase/migrations/20260213200000_add_tenant_id_columns.sql` and run in Supabase SQL Editor.

3. **Verify no NULLs** (run after applying):
```sql
DO $$
DECLARE
  tbl text;
  null_count bigint;
  tables text[] := ARRAY[
    'orders', 'order_items', 'user_favorites', 'user_addresses', 'notifications',
    'inventory_items', 'stock_movements', 'inventory_settings', 'inventory_locations',
    'inventory_unit_types', 'low_stock_alerts', 'inventory_sales_sync_runs',
    'inventory_item_cost_history', 'inventory_valuations',
    'purchase_orders', 'purchase_order_items', 'purchase_order_status_history',
    'purchase_order_attachments', 'purchase_order_receipts',
    'invoices', 'invoice_items', 'order_invoice_matches',
    'supplier_invoice_templates', 'invoice_import_sessions',
    'suppliers', 'supplier_email_templates',
    'cogs_periods', 'cogs_reports', 'cogs_products', 'cogs_sellables',
    'cogs_sellable_aliases', 'cogs_product_recipes', 'cogs_product_recipe_lines',
    'cogs_sellable_recipe_overrides', 'cogs_sellable_recipe_override_ops',
    'cogs_modifier_sets', 'cogs_modifier_options',
    'cogs_modifier_option_recipes', 'cogs_modifier_option_recipe_lines',
    'kds_categories', 'kds_menu_items', 'kds_settings', 'kds_images',
    'sales_transactions', 'sales_transaction_items',
    'recipe_ingredients', 'webhook_events', 'site_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE tenant_id IS NULL', tbl)
      INTO null_count;
    IF null_count > 0 THEN
      RAISE WARNING 'FAIL: Table % has % rows with NULL tenant_id', tbl, null_count;
    ELSE
      RAISE NOTICE 'OK: Table % (0 NULL tenant_id)', tbl;
    END IF;
  END LOOP;
END $$;
```

4. **Verify row counts match baseline**: Re-run the row count query from step 1 and compare.

5. **Quick spot-check**: `SELECT tenant_id, count(*) FROM public.orders GROUP BY tenant_id;` -- should show one group with the default UUID.

Expected: All 48 tables have tenant_id column, zero NULLs, row counts unchanged.
  </how-to-verify>
  <resume-signal>Type "stage1-verified" to confirm all checks passed, or describe any issues.</resume-signal>
</task>

</tasks>

<verification>
- 48 ALTER TABLE ADD COLUMN statements in Stage 1 file
- 48 ALTER TABLE DROP COLUMN statements in rollback file
- Zero NULL tenant_id values across all tables after applying
- Row counts unchanged after applying
</verification>

<success_criteria>
- Stage 1 migration SQL file exists with all 48 tables
- Rollback SQL file exists with all 48 tables
- Migration applied to dev database successfully
- All existing rows have tenant_id = '00000000-0000-0000-0000-000000000001'
- Zero NULL tenant_id across all 48 tables
</success_criteria>

<output>
After completion, create `.planning/phase-20/20-01-SUMMARY.md`
</output>
