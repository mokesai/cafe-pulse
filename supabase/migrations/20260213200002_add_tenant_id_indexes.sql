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
