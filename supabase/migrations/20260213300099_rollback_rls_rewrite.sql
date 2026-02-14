-- ROLLBACK ONLY: Do not apply unless reverting Phase 30 RLS migration
--
-- This rollback script:
--   1. Drops ALL new tenant-scoped policies (tenant_* prefix)
--   2. Drops the is_tenant_member() function
--   3. Restores the old is_admin() function (checks profiles.role)
--   4. Restores the old get_admin_user_id() function
--
-- NOTE: This does NOT restore old policies. After running this rollback,
-- all 48 tenant-scoped tables will have RLS enabled but NO policies,
-- meaning all non-service-role access will be denied. To restore old
-- policies, re-apply the original migration files manually.

BEGIN;

-- ============================================================================
-- SECTION 1: Drop ALL new tenant-scoped policies
-- ============================================================================

-- Category A: site_settings
DROP POLICY IF EXISTS "tenant_select_site_settings" ON public.site_settings;
DROP POLICY IF EXISTS "tenant_admin_insert_site_settings" ON public.site_settings;
DROP POLICY IF EXISTS "tenant_admin_update_site_settings" ON public.site_settings;
DROP POLICY IF EXISTS "tenant_admin_delete_site_settings" ON public.site_settings;

-- Category B: orders
DROP POLICY IF EXISTS "tenant_user_select_orders" ON public.orders;
DROP POLICY IF EXISTS "tenant_user_insert_orders" ON public.orders;
DROP POLICY IF EXISTS "tenant_user_update_orders" ON public.orders;
DROP POLICY IF EXISTS "tenant_anon_insert_orders" ON public.orders;
DROP POLICY IF EXISTS "tenant_admin_select_orders" ON public.orders;
DROP POLICY IF EXISTS "tenant_admin_update_orders" ON public.orders;

-- Category B: order_items
DROP POLICY IF EXISTS "tenant_user_select_order_items" ON public.order_items;
DROP POLICY IF EXISTS "tenant_user_insert_order_items" ON public.order_items;
DROP POLICY IF EXISTS "tenant_admin_select_order_items" ON public.order_items;
DROP POLICY IF EXISTS "tenant_admin_insert_order_items" ON public.order_items;

-- Category B: user_favorites
DROP POLICY IF EXISTS "tenant_user_select_user_favorites" ON public.user_favorites;
DROP POLICY IF EXISTS "tenant_user_insert_user_favorites" ON public.user_favorites;
DROP POLICY IF EXISTS "tenant_user_update_user_favorites" ON public.user_favorites;
DROP POLICY IF EXISTS "tenant_user_delete_user_favorites" ON public.user_favorites;

-- Category B: user_addresses
DROP POLICY IF EXISTS "tenant_user_select_user_addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "tenant_user_insert_user_addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "tenant_user_update_user_addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "tenant_user_delete_user_addresses" ON public.user_addresses;

-- Category B: notifications
DROP POLICY IF EXISTS "tenant_user_select_notifications" ON public.notifications;
DROP POLICY IF EXISTS "tenant_user_update_notifications" ON public.notifications;
DROP POLICY IF EXISTS "tenant_system_insert_notifications" ON public.notifications;
DROP POLICY IF EXISTS "tenant_admin_select_notifications" ON public.notifications;

-- Category C: kds_categories
DROP POLICY IF EXISTS "tenant_staff_select_kds_categories" ON public.kds_categories;
DROP POLICY IF EXISTS "tenant_admin_insert_kds_categories" ON public.kds_categories;
DROP POLICY IF EXISTS "tenant_admin_update_kds_categories" ON public.kds_categories;
DROP POLICY IF EXISTS "tenant_admin_delete_kds_categories" ON public.kds_categories;

-- Category C: kds_menu_items
DROP POLICY IF EXISTS "tenant_staff_select_kds_menu_items" ON public.kds_menu_items;
DROP POLICY IF EXISTS "tenant_admin_insert_kds_menu_items" ON public.kds_menu_items;
DROP POLICY IF EXISTS "tenant_admin_update_kds_menu_items" ON public.kds_menu_items;
DROP POLICY IF EXISTS "tenant_admin_delete_kds_menu_items" ON public.kds_menu_items;

-- Category C: kds_settings
DROP POLICY IF EXISTS "tenant_staff_select_kds_settings" ON public.kds_settings;
DROP POLICY IF EXISTS "tenant_admin_insert_kds_settings" ON public.kds_settings;
DROP POLICY IF EXISTS "tenant_admin_update_kds_settings" ON public.kds_settings;
DROP POLICY IF EXISTS "tenant_admin_delete_kds_settings" ON public.kds_settings;

-- Category C: kds_images
DROP POLICY IF EXISTS "tenant_staff_select_kds_images" ON public.kds_images;
DROP POLICY IF EXISTS "tenant_admin_insert_kds_images" ON public.kds_images;
DROP POLICY IF EXISTS "tenant_admin_update_kds_images" ON public.kds_images;
DROP POLICY IF EXISTS "tenant_admin_delete_kds_images" ON public.kds_images;

-- Category D: suppliers
DROP POLICY IF EXISTS "tenant_staff_select_suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "tenant_admin_insert_suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "tenant_admin_update_suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "tenant_admin_delete_suppliers" ON public.suppliers;

-- Category D: inventory_items
DROP POLICY IF EXISTS "tenant_staff_select_inventory_items" ON public.inventory_items;
DROP POLICY IF EXISTS "tenant_admin_insert_inventory_items" ON public.inventory_items;
DROP POLICY IF EXISTS "tenant_admin_update_inventory_items" ON public.inventory_items;
DROP POLICY IF EXISTS "tenant_admin_delete_inventory_items" ON public.inventory_items;

-- Category D: stock_movements
DROP POLICY IF EXISTS "tenant_staff_select_stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "tenant_admin_insert_stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "tenant_admin_update_stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "tenant_admin_delete_stock_movements" ON public.stock_movements;

-- Category D: purchase_orders
DROP POLICY IF EXISTS "tenant_staff_select_purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "tenant_admin_insert_purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "tenant_admin_update_purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "tenant_admin_delete_purchase_orders" ON public.purchase_orders;

-- Category D: purchase_order_items
DROP POLICY IF EXISTS "tenant_staff_select_purchase_order_items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "tenant_admin_insert_purchase_order_items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "tenant_admin_update_purchase_order_items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "tenant_admin_delete_purchase_order_items" ON public.purchase_order_items;

-- Category D: purchase_order_status_history
DROP POLICY IF EXISTS "tenant_staff_select_purchase_order_status_history" ON public.purchase_order_status_history;
DROP POLICY IF EXISTS "tenant_admin_insert_purchase_order_status_history" ON public.purchase_order_status_history;
DROP POLICY IF EXISTS "tenant_admin_update_purchase_order_status_history" ON public.purchase_order_status_history;
DROP POLICY IF EXISTS "tenant_admin_delete_purchase_order_status_history" ON public.purchase_order_status_history;

-- Category D: purchase_order_attachments
DROP POLICY IF EXISTS "tenant_staff_select_purchase_order_attachments" ON public.purchase_order_attachments;
DROP POLICY IF EXISTS "tenant_admin_insert_purchase_order_attachments" ON public.purchase_order_attachments;
DROP POLICY IF EXISTS "tenant_admin_update_purchase_order_attachments" ON public.purchase_order_attachments;
DROP POLICY IF EXISTS "tenant_admin_delete_purchase_order_attachments" ON public.purchase_order_attachments;

-- Category D: purchase_order_receipts
DROP POLICY IF EXISTS "tenant_staff_select_purchase_order_receipts" ON public.purchase_order_receipts;
DROP POLICY IF EXISTS "tenant_admin_insert_purchase_order_receipts" ON public.purchase_order_receipts;
DROP POLICY IF EXISTS "tenant_admin_update_purchase_order_receipts" ON public.purchase_order_receipts;
DROP POLICY IF EXISTS "tenant_admin_delete_purchase_order_receipts" ON public.purchase_order_receipts;

-- Category D: low_stock_alerts
DROP POLICY IF EXISTS "tenant_staff_select_low_stock_alerts" ON public.low_stock_alerts;
DROP POLICY IF EXISTS "tenant_admin_insert_low_stock_alerts" ON public.low_stock_alerts;
DROP POLICY IF EXISTS "tenant_admin_update_low_stock_alerts" ON public.low_stock_alerts;
DROP POLICY IF EXISTS "tenant_admin_delete_low_stock_alerts" ON public.low_stock_alerts;

-- Category D: recipe_ingredients
DROP POLICY IF EXISTS "tenant_staff_select_recipe_ingredients" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "tenant_admin_insert_recipe_ingredients" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "tenant_admin_update_recipe_ingredients" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "tenant_admin_delete_recipe_ingredients" ON public.recipe_ingredients;

-- Category D: inventory_settings
DROP POLICY IF EXISTS "tenant_staff_select_inventory_settings" ON public.inventory_settings;
DROP POLICY IF EXISTS "tenant_admin_insert_inventory_settings" ON public.inventory_settings;
DROP POLICY IF EXISTS "tenant_admin_update_inventory_settings" ON public.inventory_settings;
DROP POLICY IF EXISTS "tenant_admin_delete_inventory_settings" ON public.inventory_settings;

-- Category D: inventory_locations
DROP POLICY IF EXISTS "tenant_staff_select_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "tenant_admin_insert_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "tenant_admin_update_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "tenant_admin_delete_inventory_locations" ON public.inventory_locations;

-- Category D: inventory_unit_types
DROP POLICY IF EXISTS "tenant_staff_select_inventory_unit_types" ON public.inventory_unit_types;
DROP POLICY IF EXISTS "tenant_admin_insert_inventory_unit_types" ON public.inventory_unit_types;
DROP POLICY IF EXISTS "tenant_admin_update_inventory_unit_types" ON public.inventory_unit_types;
DROP POLICY IF EXISTS "tenant_admin_delete_inventory_unit_types" ON public.inventory_unit_types;

-- Category D: invoices
DROP POLICY IF EXISTS "tenant_staff_select_invoices" ON public.invoices;
DROP POLICY IF EXISTS "tenant_admin_insert_invoices" ON public.invoices;
DROP POLICY IF EXISTS "tenant_admin_update_invoices" ON public.invoices;
DROP POLICY IF EXISTS "tenant_admin_delete_invoices" ON public.invoices;

-- Category D: invoice_items
DROP POLICY IF EXISTS "tenant_staff_select_invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "tenant_admin_insert_invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "tenant_admin_update_invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "tenant_admin_delete_invoice_items" ON public.invoice_items;

-- Category D: order_invoice_matches
DROP POLICY IF EXISTS "tenant_staff_select_order_invoice_matches" ON public.order_invoice_matches;
DROP POLICY IF EXISTS "tenant_admin_insert_order_invoice_matches" ON public.order_invoice_matches;
DROP POLICY IF EXISTS "tenant_admin_update_order_invoice_matches" ON public.order_invoice_matches;
DROP POLICY IF EXISTS "tenant_admin_delete_order_invoice_matches" ON public.order_invoice_matches;

-- Category D: supplier_invoice_templates
DROP POLICY IF EXISTS "tenant_staff_select_supplier_invoice_templates" ON public.supplier_invoice_templates;
DROP POLICY IF EXISTS "tenant_admin_insert_supplier_invoice_templates" ON public.supplier_invoice_templates;
DROP POLICY IF EXISTS "tenant_admin_update_supplier_invoice_templates" ON public.supplier_invoice_templates;
DROP POLICY IF EXISTS "tenant_admin_delete_supplier_invoice_templates" ON public.supplier_invoice_templates;

-- Category D: invoice_import_sessions
DROP POLICY IF EXISTS "tenant_staff_select_invoice_import_sessions" ON public.invoice_import_sessions;
DROP POLICY IF EXISTS "tenant_admin_insert_invoice_import_sessions" ON public.invoice_import_sessions;
DROP POLICY IF EXISTS "tenant_admin_update_invoice_import_sessions" ON public.invoice_import_sessions;
DROP POLICY IF EXISTS "tenant_admin_delete_invoice_import_sessions" ON public.invoice_import_sessions;

-- Category D: supplier_email_templates
DROP POLICY IF EXISTS "tenant_staff_select_supplier_email_templates" ON public.supplier_email_templates;
DROP POLICY IF EXISTS "tenant_admin_insert_supplier_email_templates" ON public.supplier_email_templates;
DROP POLICY IF EXISTS "tenant_admin_update_supplier_email_templates" ON public.supplier_email_templates;
DROP POLICY IF EXISTS "tenant_admin_delete_supplier_email_templates" ON public.supplier_email_templates;

-- Category D: webhook_events
DROP POLICY IF EXISTS "tenant_staff_select_webhook_events" ON public.webhook_events;
DROP POLICY IF EXISTS "tenant_admin_insert_webhook_events" ON public.webhook_events;
DROP POLICY IF EXISTS "tenant_admin_update_webhook_events" ON public.webhook_events;
DROP POLICY IF EXISTS "tenant_admin_delete_webhook_events" ON public.webhook_events;

-- Category D: inventory_sales_sync_runs
DROP POLICY IF EXISTS "tenant_staff_select_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs;
DROP POLICY IF EXISTS "tenant_admin_insert_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs;
DROP POLICY IF EXISTS "tenant_admin_update_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs;
DROP POLICY IF EXISTS "tenant_admin_delete_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs;

-- Category D: sales_transactions
DROP POLICY IF EXISTS "tenant_staff_select_sales_transactions" ON public.sales_transactions;
DROP POLICY IF EXISTS "tenant_admin_insert_sales_transactions" ON public.sales_transactions;
DROP POLICY IF EXISTS "tenant_admin_update_sales_transactions" ON public.sales_transactions;
DROP POLICY IF EXISTS "tenant_admin_delete_sales_transactions" ON public.sales_transactions;

-- Category D: sales_transaction_items
DROP POLICY IF EXISTS "tenant_staff_select_sales_transaction_items" ON public.sales_transaction_items;
DROP POLICY IF EXISTS "tenant_admin_insert_sales_transaction_items" ON public.sales_transaction_items;
DROP POLICY IF EXISTS "tenant_admin_update_sales_transaction_items" ON public.sales_transaction_items;
DROP POLICY IF EXISTS "tenant_admin_delete_sales_transaction_items" ON public.sales_transaction_items;

-- Category D: inventory_item_cost_history
DROP POLICY IF EXISTS "tenant_staff_select_inventory_item_cost_history" ON public.inventory_item_cost_history;
DROP POLICY IF EXISTS "tenant_admin_insert_inventory_item_cost_history" ON public.inventory_item_cost_history;
DROP POLICY IF EXISTS "tenant_admin_update_inventory_item_cost_history" ON public.inventory_item_cost_history;
DROP POLICY IF EXISTS "tenant_admin_delete_inventory_item_cost_history" ON public.inventory_item_cost_history;

-- Category D: inventory_valuations
DROP POLICY IF EXISTS "tenant_staff_select_inventory_valuations" ON public.inventory_valuations;
DROP POLICY IF EXISTS "tenant_admin_insert_inventory_valuations" ON public.inventory_valuations;
DROP POLICY IF EXISTS "tenant_admin_update_inventory_valuations" ON public.inventory_valuations;
DROP POLICY IF EXISTS "tenant_admin_delete_inventory_valuations" ON public.inventory_valuations;

-- Category D: cogs_periods
DROP POLICY IF EXISTS "tenant_staff_select_cogs_periods" ON public.cogs_periods;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_periods" ON public.cogs_periods;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_periods" ON public.cogs_periods;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_periods" ON public.cogs_periods;

-- Category D: cogs_reports
DROP POLICY IF EXISTS "tenant_staff_select_cogs_reports" ON public.cogs_reports;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_reports" ON public.cogs_reports;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_reports" ON public.cogs_reports;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_reports" ON public.cogs_reports;

-- Category D: cogs_products
DROP POLICY IF EXISTS "tenant_staff_select_cogs_products" ON public.cogs_products;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_products" ON public.cogs_products;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_products" ON public.cogs_products;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_products" ON public.cogs_products;

-- Category D: cogs_sellables
DROP POLICY IF EXISTS "tenant_staff_select_cogs_sellables" ON public.cogs_sellables;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_sellables" ON public.cogs_sellables;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_sellables" ON public.cogs_sellables;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_sellables" ON public.cogs_sellables;

-- Category D: cogs_sellable_aliases
DROP POLICY IF EXISTS "tenant_staff_select_cogs_sellable_aliases" ON public.cogs_sellable_aliases;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_sellable_aliases" ON public.cogs_sellable_aliases;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_sellable_aliases" ON public.cogs_sellable_aliases;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_sellable_aliases" ON public.cogs_sellable_aliases;

-- Category D: cogs_product_recipes
DROP POLICY IF EXISTS "tenant_staff_select_cogs_product_recipes" ON public.cogs_product_recipes;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_product_recipes" ON public.cogs_product_recipes;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_product_recipes" ON public.cogs_product_recipes;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_product_recipes" ON public.cogs_product_recipes;

-- Category D: cogs_product_recipe_lines
DROP POLICY IF EXISTS "tenant_staff_select_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines;

-- Category D: cogs_sellable_recipe_overrides
DROP POLICY IF EXISTS "tenant_staff_select_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides;

-- Category D: cogs_sellable_recipe_override_ops
DROP POLICY IF EXISTS "tenant_staff_select_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops;

-- Category D: cogs_modifier_sets
DROP POLICY IF EXISTS "tenant_staff_select_cogs_modifier_sets" ON public.cogs_modifier_sets;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_modifier_sets" ON public.cogs_modifier_sets;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_modifier_sets" ON public.cogs_modifier_sets;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_modifier_sets" ON public.cogs_modifier_sets;

-- Category D: cogs_modifier_options
DROP POLICY IF EXISTS "tenant_staff_select_cogs_modifier_options" ON public.cogs_modifier_options;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_modifier_options" ON public.cogs_modifier_options;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_modifier_options" ON public.cogs_modifier_options;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_modifier_options" ON public.cogs_modifier_options;

-- Category D: cogs_modifier_option_recipes
DROP POLICY IF EXISTS "tenant_staff_select_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes;

-- Category D: cogs_modifier_option_recipe_lines
DROP POLICY IF EXISTS "tenant_staff_select_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines;
DROP POLICY IF EXISTS "tenant_admin_insert_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines;
DROP POLICY IF EXISTS "tenant_admin_update_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines;
DROP POLICY IF EXISTS "tenant_admin_delete_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines;


-- ============================================================================
-- SECTION 2: Drop the is_tenant_member helper function
-- ============================================================================

DROP FUNCTION IF EXISTS public.is_tenant_member(text[]);


-- ============================================================================
-- SECTION 3: Restore old is_admin() function (checks profiles.role)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE public.profiles.id = auth.uid()
    AND public.profiles.role = 'admin'
  );
END;
$function$;


-- ============================================================================
-- SECTION 4: Restore old get_admin_user_id() function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF public.is_admin() THEN
    RETURN auth.uid();
  ELSE
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
END;
$function$;


COMMIT;
