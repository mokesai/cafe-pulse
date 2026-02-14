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
