---
phase: 20-schema-migration
plan: 02
type: execute
wave: 2
depends_on: ["20-01"]
files_modified:
  - supabase/migrations/20260213200001_add_tenant_id_constraints.sql
autonomous: false

must_haves:
  truths:
    - "All 48 tenant-scoped tables have NOT NULL constraint on tenant_id"
    - "All 48 tenant-scoped tables have FK constraint referencing tenants(id)"
    - "FK constraint uses ON DELETE RESTRICT to prevent accidental tenant deletion"
    - "Attempting to INSERT a NULL tenant_id is rejected by the database"
    - "Attempting to INSERT a non-existent tenant_id is rejected by the database"
  artifacts:
    - path: "supabase/migrations/20260213200001_add_tenant_id_constraints.sql"
      provides: "Stage 2 migration: NOT NULL + FK constraints on all 48 tables"
      contains: "SET NOT NULL"
  key_links:
    - from: "tenant_id FK"
      to: "tenants(id)"
      via: "FOREIGN KEY REFERENCES with ON DELETE RESTRICT"
      pattern: "REFERENCES public.tenants\\(id\\)"
---

<objective>
Add NOT NULL and FOREIGN KEY constraints to the tenant_id column on all 48 tenant-scoped tables.

Purpose: This is Stage 2 of the three-stage schema migration. After Stage 1 backfilled all rows with the default tenant UUID via DEFAULT, this stage adds data integrity constraints: NOT NULL prevents future rows from having empty tenant_id, and FK REFERENCES tenants(id) ensures every tenant_id points to a valid tenant. FK ordering matters here -- parent tables must have their FK constraint before child tables that reference them (though in practice, all 48 FKs point to the same `tenants` table, so within-tier ordering is irrelevant; tier ordering is respected for correctness).

Output: One SQL migration file with NOT NULL + FK constraints for all 48 tables.
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
  <name>Task 1: Create Stage 2 constraints migration SQL file</name>
  <files>
    supabase/migrations/20260213200001_add_tenant_id_constraints.sql
  </files>
  <action>
Create the Stage 2 migration file. This file is wrapped in a single transaction (BEGIN/COMMIT) since no CONCURRENTLY operations are involved. The transaction ensures all-or-nothing application.

Structure: First set NOT NULL on all 48 tables, then add FK constraints on all 48 tables. FK constraints are ordered by tier (Tier 0 first, then 1, 2, 3) for correctness, though since all FKs reference the same `tenants` table, the ordering is purely organizational.

FK constraint naming convention: `fk_{table_name}_tenant` (e.g., `fk_orders_tenant`).

The complete SQL (all 48 tables, copy-paste ready):

```sql
-- Phase 20, Stage 2: Add NOT NULL and FK constraints to tenant_id
-- Prerequisite: Stage 1 must be applied (all rows already have tenant_id via DEFAULT)
-- This runs in a single transaction: all-or-nothing
-- FK constraints reference tenants(id) with ON DELETE RESTRICT

BEGIN;

-- ============================================================
-- Part A: Add NOT NULL constraint to all 48 tables
-- Safe because Stage 1 DEFAULT already populated every row
-- ============================================================

-- Tier 0
ALTER TABLE public.orders ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.suppliers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.inventory_locations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.inventory_unit_types ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.inventory_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.webhook_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.site_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.user_favorites ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.user_addresses ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_periods ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_products ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_modifier_sets ALTER COLUMN tenant_id SET NOT NULL;

-- Tier 1
ALTER TABLE public.order_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.inventory_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.invoices ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.supplier_email_templates ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_reports ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_sellables ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_modifier_options ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.inventory_sales_sync_runs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.kds_categories ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.sales_transactions ALTER COLUMN tenant_id SET NOT NULL;

-- Tier 2
ALTER TABLE public.stock_movements ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.purchase_order_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.low_stock_alerts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.recipe_ingredients ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.invoice_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.order_invoice_matches ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.supplier_invoice_templates ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.invoice_import_sessions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.inventory_valuations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.inventory_item_cost_history ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_sellable_aliases ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_product_recipes ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_sellable_recipe_overrides ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_modifier_option_recipes ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.kds_menu_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.kds_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.kds_images ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.sales_transaction_items ALTER COLUMN tenant_id SET NOT NULL;

-- Tier 3
ALTER TABLE public.purchase_order_status_history ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.purchase_order_attachments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.purchase_order_receipts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_product_recipe_lines ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_sellable_recipe_override_ops ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.cogs_modifier_option_recipe_lines ALTER COLUMN tenant_id SET NOT NULL;

-- ============================================================
-- Part B: Add FK constraints referencing tenants(id)
-- ON DELETE RESTRICT prevents accidental tenant deletion
-- Ordered by tier for organizational clarity
-- ============================================================

-- Tier 0
ALTER TABLE public.orders ADD CONSTRAINT fk_orders_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.suppliers ADD CONSTRAINT fk_suppliers_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_locations ADD CONSTRAINT fk_inventory_locations_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_unit_types ADD CONSTRAINT fk_inventory_unit_types_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_settings ADD CONSTRAINT fk_inventory_settings_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.notifications ADD CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.webhook_events ADD CONSTRAINT fk_webhook_events_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.site_settings ADD CONSTRAINT fk_site_settings_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.user_favorites ADD CONSTRAINT fk_user_favorites_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.user_addresses ADD CONSTRAINT fk_user_addresses_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_periods ADD CONSTRAINT fk_cogs_periods_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_products ADD CONSTRAINT fk_cogs_products_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_modifier_sets ADD CONSTRAINT fk_cogs_modifier_sets_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

-- Tier 1
ALTER TABLE public.order_items ADD CONSTRAINT fk_order_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_items ADD CONSTRAINT fk_inventory_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_orders ADD CONSTRAINT fk_purchase_orders_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.invoices ADD CONSTRAINT fk_invoices_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.supplier_email_templates ADD CONSTRAINT fk_supplier_email_templates_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_reports ADD CONSTRAINT fk_cogs_reports_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_sellables ADD CONSTRAINT fk_cogs_sellables_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_modifier_options ADD CONSTRAINT fk_cogs_modifier_options_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_sales_sync_runs ADD CONSTRAINT fk_inventory_sales_sync_runs_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.kds_categories ADD CONSTRAINT fk_kds_categories_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.sales_transactions ADD CONSTRAINT fk_sales_transactions_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

-- Tier 2
ALTER TABLE public.stock_movements ADD CONSTRAINT fk_stock_movements_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_order_items ADD CONSTRAINT fk_purchase_order_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.low_stock_alerts ADD CONSTRAINT fk_low_stock_alerts_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.recipe_ingredients ADD CONSTRAINT fk_recipe_ingredients_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.invoice_items ADD CONSTRAINT fk_invoice_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.order_invoice_matches ADD CONSTRAINT fk_order_invoice_matches_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.supplier_invoice_templates ADD CONSTRAINT fk_supplier_invoice_templates_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.invoice_import_sessions ADD CONSTRAINT fk_invoice_import_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_valuations ADD CONSTRAINT fk_inventory_valuations_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_item_cost_history ADD CONSTRAINT fk_inventory_item_cost_history_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_sellable_aliases ADD CONSTRAINT fk_cogs_sellable_aliases_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_product_recipes ADD CONSTRAINT fk_cogs_product_recipes_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_sellable_recipe_overrides ADD CONSTRAINT fk_cogs_sellable_recipe_overrides_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_modifier_option_recipes ADD CONSTRAINT fk_cogs_modifier_option_recipes_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.kds_menu_items ADD CONSTRAINT fk_kds_menu_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.kds_settings ADD CONSTRAINT fk_kds_settings_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.kds_images ADD CONSTRAINT fk_kds_images_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.sales_transaction_items ADD CONSTRAINT fk_sales_transaction_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

-- Tier 3
ALTER TABLE public.purchase_order_status_history ADD CONSTRAINT fk_purchase_order_status_history_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_order_attachments ADD CONSTRAINT fk_purchase_order_attachments_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_order_receipts ADD CONSTRAINT fk_purchase_order_receipts_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_product_recipe_lines ADD CONSTRAINT fk_cogs_product_recipe_lines_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_sellable_recipe_override_ops ADD CONSTRAINT fk_cogs_sellable_recipe_override_ops_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.cogs_modifier_option_recipe_lines ADD CONSTRAINT fk_cogs_modifier_option_recipe_lines_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

COMMIT;
```
  </action>
  <verify>
File exists and contains exactly 48 SET NOT NULL statements and 48 ADD CONSTRAINT statements. Verify with:
- `grep -c "SET NOT NULL" supabase/migrations/20260213200001_add_tenant_id_constraints.sql` should output 48
- `grep -c "ADD CONSTRAINT" supabase/migrations/20260213200001_add_tenant_id_constraints.sql` should output 48
  </verify>
  <done>Stage 2 migration SQL file exists with NOT NULL + FK constraints for all 48 tables, wrapped in a transaction.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Apply Stage 2 constraints and verify</name>
  <what-built>Stage 2 SQL migration file that adds NOT NULL and FK constraints to tenant_id on all 48 tables.</what-built>
  <how-to-verify>
**IMPORTANT: Verify you are on the DEV database (ofppjltowsdvojixeflr) before proceeding.**

1. **Apply Stage 2**: Copy the contents of `supabase/migrations/20260213200001_add_tenant_id_constraints.sql` and run in Supabase SQL Editor. The BEGIN/COMMIT ensures all-or-nothing.

2. **Verify NOT NULL constraints** (run after applying):
```sql
SELECT
  table_name,
  is_nullable
FROM information_schema.columns
WHERE column_name = 'tenant_id'
  AND table_schema = 'public'
  AND table_name NOT IN ('tenants', 'tenant_memberships', 'profiles')
ORDER BY table_name;
```
Expected: All 48 rows show `is_nullable = 'NO'`.

3. **Verify FK constraints exist**:
```sql
SELECT
  tc.table_name,
  tc.constraint_name,
  ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.constraint_name LIKE 'fk_%_tenant'
ORDER BY tc.table_name;
```
Expected: 48 rows, all with `foreign_table_name = 'tenants'`.

4. **Test NOT NULL enforcement** (should fail):
```sql
INSERT INTO public.orders (id, tenant_id) VALUES (gen_random_uuid(), NULL);
-- Expected: ERROR - null value in column "tenant_id" violates not-null constraint
```

5. **Test FK enforcement** (should fail):
```sql
INSERT INTO public.orders (id, tenant_id) VALUES (gen_random_uuid(), '99999999-9999-9999-9999-999999999999');
-- Expected: ERROR - insert or update on table "orders" violates foreign key constraint
```

(Clean up any test rows if the INSERT somehow succeeds, which it should not.)

Expected: All 48 NOT NULL constraints in place, all 48 FK constraints in place, enforcement working.
  </how-to-verify>
  <resume-signal>Type "stage2-verified" to confirm all checks passed, or describe any issues.</resume-signal>
</task>

</tasks>

<verification>
- 48 NOT NULL constraints confirmed via information_schema
- 48 FK constraints confirmed via information_schema
- NULL insert rejected
- Invalid tenant_id insert rejected
</verification>

<success_criteria>
- Stage 2 migration SQL file exists with all 48 tables
- Migration applied to dev database successfully (transaction committed)
- All 48 tables have NOT NULL on tenant_id
- All 48 tables have FK to tenants(id) ON DELETE RESTRICT
- Constraint enforcement verified with test inserts
</success_criteria>

<output>
After completion, create `.planning/phase-20/20-02-SUMMARY.md`
</output>
