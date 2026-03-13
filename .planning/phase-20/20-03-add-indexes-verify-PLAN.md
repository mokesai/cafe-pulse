---
phase: 20-schema-migration
plan: 03
type: execute
wave: 3
depends_on: ["20-02"]
files_modified:
  - supabase/migrations/20260213200002_add_tenant_id_indexes.sql
autonomous: false

must_haves:
  truths:
    - "All 48 tenant-scoped tables have a btree index on tenant_id"
    - "All indexes are valid (no failed concurrent builds)"
    - "npm run build passes with no TypeScript errors"
    - "Dev app boots and key pages load correctly"
    - "Existing app functionality is preserved on the default tenant"
  artifacts:
    - path: "supabase/migrations/20260213200002_add_tenant_id_indexes.sql"
      provides: "Stage 3 migration: btree indexes on tenant_id for all 48 tables"
      contains: "CREATE INDEX"
  key_links:
    - from: "idx_{table}_tenant_id"
      to: "public.{table}(tenant_id)"
      via: "btree index for future RLS policy performance"
      pattern: "CREATE INDEX.*tenant_id"
---

<objective>
Add btree indexes on tenant_id to all 48 tenant-scoped tables, regenerate TypeScript types, and verify the complete Phase 20 migration.

Purpose: This is Stage 3 (final stage) of the three-stage schema migration. Indexes on tenant_id are essential for RLS policy performance in Phase 30 -- every query will filter by tenant_id, and without indexes these would be sequential scans. This plan also performs the final verification: build check, type generation, and manual smoke test to confirm the app still works.

Output: One SQL migration file with indexes, updated TypeScript types, and verified working application.

**Important tradeoff (from research):** The CONTEXT specifies `CREATE INDEX CONCURRENTLY`, but research found that CONCURRENTLY cannot run inside a transaction block, and Supabase SQL Editor may wrap statements in transactions. For the dev database (minimal traffic, no production reads to block), this plan uses regular `CREATE INDEX` instead. This is simpler, avoids the transaction limitation, and has no practical downside on a dev database. The CONCURRENTLY approach should be used for the eventual production migration.
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
  <name>Task 1: Create Stage 3 indexes migration SQL file</name>
  <files>
    supabase/migrations/20260213200002_add_tenant_id_indexes.sql
  </files>
  <action>
Create the Stage 3 migration file. Uses regular `CREATE INDEX` (not CONCURRENTLY) for dev database simplicity. Uses `IF NOT EXISTS` for idempotency.

Index naming convention: `idx_{table_name}_tenant_id` (e.g., `idx_orders_tenant_id`).

The complete SQL (all 48 tables, copy-paste ready):

```sql
-- Phase 20, Stage 3: Add btree indexes on tenant_id for all tenant-scoped tables
-- These indexes are critical for Phase 30 RLS policy performance
-- Using regular CREATE INDEX (not CONCURRENTLY) for dev database simplicity
-- For production migration, use CREATE INDEX CONCURRENTLY outside a transaction
-- No ordering required for index creation

-- Tier 0
CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON public.orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_id ON public.suppliers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_tenant_id ON public.inventory_locations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_types_tenant_id ON public.inventory_unit_types (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_settings_tenant_id ON public.inventory_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id ON public.notifications (tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant_id ON public.webhook_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_site_settings_tenant_id ON public.site_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_tenant_id ON public.user_favorites (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_addresses_tenant_id ON public.user_addresses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_periods_tenant_id ON public.cogs_periods (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_products_tenant_id ON public.cogs_products (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_modifier_sets_tenant_id ON public.cogs_modifier_sets (tenant_id);

-- Tier 1
CREATE INDEX IF NOT EXISTS idx_order_items_tenant_id ON public.order_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_id ON public.inventory_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_id ON public.purchase_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON public.invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_email_templates_tenant_id ON public.supplier_email_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_reports_tenant_id ON public.cogs_reports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_sellables_tenant_id ON public.cogs_sellables (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_modifier_options_tenant_id ON public.cogs_modifier_options (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sales_sync_runs_tenant_id ON public.inventory_sales_sync_runs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kds_categories_tenant_id ON public.kds_categories (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_transactions_tenant_id ON public.sales_transactions (tenant_id);

-- Tier 2
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_id ON public.stock_movements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_tenant_id ON public.purchase_order_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_low_stock_alerts_tenant_id ON public.low_stock_alerts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_tenant_id ON public.recipe_ingredients (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_id ON public.invoice_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_invoice_matches_tenant_id ON public.order_invoice_matches (tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_templates_tenant_id ON public.supplier_invoice_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_import_sessions_tenant_id ON public.invoice_import_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_valuations_tenant_id ON public.inventory_valuations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item_cost_history_tenant_id ON public.inventory_item_cost_history (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_sellable_aliases_tenant_id ON public.cogs_sellable_aliases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_product_recipes_tenant_id ON public.cogs_product_recipes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_sellable_recipe_overrides_tenant_id ON public.cogs_sellable_recipe_overrides (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_modifier_option_recipes_tenant_id ON public.cogs_modifier_option_recipes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kds_menu_items_tenant_id ON public.kds_menu_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kds_settings_tenant_id ON public.kds_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kds_images_tenant_id ON public.kds_images (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_transaction_items_tenant_id ON public.sales_transaction_items (tenant_id);

-- Tier 3
CREATE INDEX IF NOT EXISTS idx_purchase_order_status_history_tenant_id ON public.purchase_order_status_history (tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_attachments_tenant_id ON public.purchase_order_attachments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_receipts_tenant_id ON public.purchase_order_receipts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_product_recipe_lines_tenant_id ON public.cogs_product_recipe_lines (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_sellable_recipe_override_ops_tenant_id ON public.cogs_sellable_recipe_override_ops (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cogs_modifier_option_recipe_lines_tenant_id ON public.cogs_modifier_option_recipe_lines (tenant_id);
```
  </action>
  <verify>
File exists and contains exactly 48 CREATE INDEX statements. Verify with:
- `grep -c "CREATE INDEX" supabase/migrations/20260213200002_add_tenant_id_indexes.sql` should output 48
  </verify>
  <done>Stage 3 migration SQL file exists with btree indexes for all 48 tables.</done>
</task>

<task type="auto">
  <name>Task 2: Verify build and regenerate types</name>
  <files>(no files modified -- verification only)</files>
  <action>
Run the following verification steps in order:

1. Run `npm run build` from the project root. This confirms no TypeScript errors were introduced by the schema changes. The build should pass because the project uses hand-crafted types (not auto-generated from the schema), so adding columns does not affect existing type definitions.

2. Note: `npm run db:generate` outputs types to stdout (the project's script does not write to a file). The research confirmed TypeScript types are hand-crafted in `src/types/` and are NOT auto-generated. Running `db:generate` is informational only -- it shows what the new schema looks like but does not affect the build. Run it and note that `tenant_id` appears in the output, but do NOT overwrite the existing hand-crafted types.

If the build fails, investigate the error. The most likely cause is a pre-existing issue (the Phase 10 summary noted a `pages-manifest.json` ENOENT error that is unrelated to our changes). As long as TypeScript compilation succeeds, the build is considered passing.
  </action>
  <verify>
- `npm run build` completes with "Compiled successfully" (or exits with the pre-existing pages-manifest warning which is unrelated)
- `npm run lint` passes on the project
  </verify>
  <done>Build passes, confirming schema changes did not break TypeScript compilation.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Apply Stage 3 indexes and final verification</name>
  <what-built>Stage 3 SQL migration file with btree indexes on tenant_id for all 48 tables. Build verified clean.</what-built>
  <how-to-verify>
**IMPORTANT: Verify you are on the DEV database (ofppjltowsdvojixeflr) before proceeding.**

1. **Apply Stage 3**: Copy the contents of `supabase/migrations/20260213200002_add_tenant_id_indexes.sql` and run in Supabase SQL Editor.

2. **Verify all 48 indexes exist and are valid**:
```sql
SELECT
  c.relname AS index_name,
  t.relname AS table_name,
  i.indisvalid AS is_valid
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE c.relname LIKE 'idx_%_tenant_id'
  AND n.nspname = 'public'
ORDER BY t.relname;
```
Expected: 48 rows, all with `is_valid = true`.

3. **Check for any invalid indexes** (should return zero rows):
```sql
SELECT indexrelid::regclass, indrelid::regclass
FROM pg_index
WHERE NOT indisvalid;
```

4. **Final comprehensive verification -- all 48 tables have column + NOT NULL + FK + index**:
```sql
WITH tenant_tables AS (
  SELECT c.table_name,
    c.is_nullable,
    EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      WHERE tc.table_name = c.table_name
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name LIKE 'fk_%_tenant'
        AND tc.table_schema = 'public'
    ) AS has_fk,
    EXISTS (
      SELECT 1 FROM pg_indexes pi
      WHERE pi.tablename = c.table_name
        AND pi.indexname LIKE 'idx_%_tenant_id'
        AND pi.schemaname = 'public'
    ) AS has_index
  FROM information_schema.columns c
  WHERE c.column_name = 'tenant_id'
    AND c.table_schema = 'public'
    AND c.table_name NOT IN ('tenants', 'tenant_memberships')
)
SELECT
  table_name,
  CASE WHEN is_nullable = 'NO' THEN 'OK' ELSE 'MISSING' END AS not_null,
  CASE WHEN has_fk THEN 'OK' ELSE 'MISSING' END AS fk_constraint,
  CASE WHEN has_index THEN 'OK' ELSE 'MISSING' END AS index_exists
FROM tenant_tables
ORDER BY table_name;
```
Expected: 48 rows, all showing OK/OK/OK.

5. **Manual smoke test**: Start the dev server (`npm run dev:webpack`) and verify:
   - Home page loads
   - Menu page loads with items
   - Admin dashboard loads (if logged in)
   - No console errors related to tenant_id

6. **Document known limitations for future phases**:
   - 15+ UNIQUE constraints need conversion to composite `(tenant_id, col)` -- Phase 30+
   - `site_settings` singleton PK pattern -- Phase 30+
   - Database views `po_supplier_metrics_v` and `view_pending_manual_inventory_deductions` need tenant_id filtering -- Phase 30
   - DEFAULT on tenant_id removed in Phase 40

Expected: All migration stages complete, all verifications pass, app works normally.
  </how-to-verify>
  <resume-signal>Type "phase20-verified" to confirm all checks passed, or describe any issues.</resume-signal>
</task>

</tasks>

<verification>
- 48 btree indexes created and valid
- No invalid indexes in pg_index
- All 48 tables have: tenant_id column + NOT NULL + FK + index
- npm run build passes
- Dev app boots and key pages load
</verification>

<success_criteria>
- Stage 3 migration SQL file exists with all 48 tables
- All 48 indexes applied and valid on dev database
- Comprehensive verification query shows OK/OK/OK for all 48 tables
- Build passes with no TypeScript errors
- App functions normally on the default tenant
- Phase 20 complete: all existing data has tenant_id, all constraints in place, all indexes created
</success_criteria>

<output>
After completion, create `.planning/phase-20/20-03-SUMMARY.md`
</output>
