CREATE OR REPLACE FUNCTION public.verify_rls_policies()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'tenant_policy_count', (
      SELECT COUNT(*) FROM pg_policies
      WHERE policyname LIKE 'tenant_%'
    ),
    'old_policy_count', (
      SELECT COUNT(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename NOT IN ('tenants', 'tenant_memberships', 'profiles')
        AND policyname NOT LIKE 'tenant_%'
    ),
    'rls_enabled_count', (
      SELECT COUNT(*) FROM pg_tables
      WHERE schemaname = 'public'
        AND rowsecurity = true
        AND tablename NOT IN ('tenants', 'tenant_memberships', 'profiles')
    ),
    'total_tables_needing_rls', (
      SELECT COUNT(*) FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN (
          'orders', 'order_items', 'user_favorites', 'user_addresses', 'notifications',
          'site_settings',
          'kds_categories', 'kds_menu_items', 'kds_settings', 'kds_images',
          'inventory_items', 'suppliers', 'stock_movements', 'purchase_orders',
          'purchase_order_items', 'purchase_order_status_history', 'purchase_order_attachments',
          'purchase_order_receipts', 'low_stock_alerts', 'recipe_ingredients',
          'inventory_settings', 'inventory_locations', 'inventory_unit_types',
          'invoices', 'invoice_items', 'order_invoice_matches', 'supplier_invoice_templates',
          'invoice_import_sessions', 'supplier_email_templates', 'webhook_events',
          'inventory_sales_sync_runs', 'sales_transactions', 'sales_transaction_items',
          'inventory_item_cost_history', 'inventory_valuations',
          'cogs_periods', 'cogs_reports', 'cogs_products', 'cogs_sellables',
          'cogs_sellable_aliases', 'cogs_product_recipes', 'cogs_product_recipe_lines',
          'cogs_sellable_recipe_overrides', 'cogs_sellable_recipe_override_ops',
          'cogs_modifier_sets', 'cogs_modifier_options', 'cogs_modifier_option_recipes',
          'cogs_modifier_option_recipe_lines'
        )
    ),
    'storage_tenant_policy_count', (
      SELECT COUNT(*) FROM pg_policies
      WHERE schemaname = 'storage'
        AND policyname LIKE 'tenant_%'
    ),
    'has_is_tenant_member', (
      SELECT COUNT(*) > 0 FROM pg_proc
      WHERE proname = 'is_tenant_member'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    ),
    'update_inventory_stock_has_tenant', (
      SELECT prosrc LIKE '%tenant_id%' FROM pg_proc
      WHERE proname = 'update_inventory_stock'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    ),
    'create_order_notification_has_tenant', (
      SELECT prosrc LIKE '%tenant_id%' FROM pg_proc
      WHERE proname = 'create_order_notification'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    )
  ) INTO result;
  
  RETURN result;
END;
$$;
