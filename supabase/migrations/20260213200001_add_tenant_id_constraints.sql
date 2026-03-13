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
