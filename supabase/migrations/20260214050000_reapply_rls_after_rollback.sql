-- Migration: Re-apply Phase 30 RLS policies after accidental rollback
-- This migration re-creates all helper functions, policies, SECURITY DEFINER
-- functions, and storage policies that were dropped by the rollback migration
-- (20260213300099) which was accidentally applied as a forward migration.
--
-- All operations are idempotent (CREATE OR REPLACE, DROP IF EXISTS + CREATE,
-- ALTER TABLE ENABLE RLS is no-op if already enabled).

BEGIN;

-- ============================================================================
-- SECTION 1: Helper Functions
-- ============================================================================

-- 1. is_tenant_member: Check if current user is a member of the current tenant
--    with one of the specified roles. SECURITY DEFINER to read tenant_memberships
--    regardless of caller's RLS context.
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_roles text[] DEFAULT ARRAY['owner','admin','staff','customer'])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
    AND user_id = auth.uid()
    AND role = ANY(p_roles)
  );
END;
$$;

-- 2. is_admin: Check if current user is an owner or admin of the current tenant.
--    Replaces the old profiles.role = 'admin' check.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
    AND user_id = auth.uid()
    AND role IN ('owner', 'admin')
  );
END;
$$;

-- 3. get_admin_user_id: Return auth.uid() if the caller is an admin, otherwise raise.
CREATE OR REPLACE FUNCTION public.get_admin_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN auth.uid();
  ELSE
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
END;
$$;

-- ============================================================================
-- SECTION 3: Ensure RLS is Enabled on ALL 48 Tenant-Scoped Tables
-- ============================================================================

-- Category A (1 table)
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- Category B (5 tables)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Category C (4 tables)
ALTER TABLE public.kds_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kds_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kds_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kds_images ENABLE ROW LEVEL SECURITY;

-- Category D (38 tables)
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.low_stock_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_unit_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_invoice_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_import_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sales_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_item_cost_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_sellables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_sellable_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_product_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_product_recipe_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_sellable_recipe_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_sellable_recipe_override_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_modifier_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_modifier_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_modifier_option_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_modifier_option_recipe_lines ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SECTION 4: Create New Policies by Category
-- ============================================================================


-- ----------------------------------------------------------------------------
-- CATEGORY A: Public Read (1 table: site_settings)
-- Anonymous SELECT with tenant context; admin write.
-- ----------------------------------------------------------------------------

-- site_settings: Public read (anyone with tenant context)
DROP POLICY IF EXISTS "tenant_select_site_settings" ON public.site_settings;
CREATE POLICY "tenant_select_site_settings" ON public.site_settings
  FOR SELECT USING (tenant_id = (select current_setting('app.tenant_id', true))::uuid);

-- site_settings: Admin write (owner/admin only)
DROP POLICY IF EXISTS "tenant_admin_insert_site_settings" ON public.site_settings;
CREATE POLICY "tenant_admin_insert_site_settings" ON public.site_settings
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_site_settings" ON public.site_settings;
CREATE POLICY "tenant_admin_update_site_settings" ON public.site_settings
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_site_settings" ON public.site_settings;
CREATE POLICY "tenant_admin_delete_site_settings" ON public.site_settings
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- ----------------------------------------------------------------------------
-- CATEGORY B: Customer-Scoped (5 tables)
-- auth.uid() + tenant_id for user's own data; admin can see all tenant data.
-- ----------------------------------------------------------------------------

-- === orders ===

-- Users can view their own orders
DROP POLICY IF EXISTS "tenant_user_select_orders" ON public.orders;
CREATE POLICY "tenant_user_select_orders" ON public.orders
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Users can create their own orders
DROP POLICY IF EXISTS "tenant_user_insert_orders" ON public.orders;
CREATE POLICY "tenant_user_insert_orders" ON public.orders
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Users can update their own pending orders
DROP POLICY IF EXISTS "tenant_user_update_orders" ON public.orders;
CREATE POLICY "tenant_user_update_orders" ON public.orders
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
    AND status = 'pending'
  );

-- Anonymous users can create orders (guest checkout)
DROP POLICY IF EXISTS "tenant_anon_insert_orders" ON public.orders;
CREATE POLICY "tenant_anon_insert_orders" ON public.orders
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id IS NULL
  );

-- Admin can view all orders for the tenant
DROP POLICY IF EXISTS "tenant_admin_select_orders" ON public.orders;
CREATE POLICY "tenant_admin_select_orders" ON public.orders
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

-- Admin can update all orders for the tenant
DROP POLICY IF EXISTS "tenant_admin_update_orders" ON public.orders;
CREATE POLICY "tenant_admin_update_orders" ON public.orders
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === order_items ===

-- Users can view order items for their own orders (including anonymous/guest orders)
DROP POLICY IF EXISTS "tenant_user_select_order_items" ON public.order_items;
CREATE POLICY "tenant_user_select_order_items" ON public.order_items
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE public.orders.id = order_items.order_id
      AND (public.orders.user_id = (select auth.uid()) OR public.orders.user_id IS NULL)
    )
  );

-- Users can create order items for their own orders (including anonymous/guest orders)
DROP POLICY IF EXISTS "tenant_user_insert_order_items" ON public.order_items;
CREATE POLICY "tenant_user_insert_order_items" ON public.order_items
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE public.orders.id = order_items.order_id
      AND (public.orders.user_id = (select auth.uid()) OR public.orders.user_id IS NULL)
    )
  );

-- Admin can view all order items for the tenant
DROP POLICY IF EXISTS "tenant_admin_select_order_items" ON public.order_items;
CREATE POLICY "tenant_admin_select_order_items" ON public.order_items
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

-- Admin can insert order items for the tenant
DROP POLICY IF EXISTS "tenant_admin_insert_order_items" ON public.order_items;
CREATE POLICY "tenant_admin_insert_order_items" ON public.order_items
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === user_favorites ===

-- Users can view their own favorites
DROP POLICY IF EXISTS "tenant_user_select_user_favorites" ON public.user_favorites;
CREATE POLICY "tenant_user_select_user_favorites" ON public.user_favorites
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Users can create their own favorites
DROP POLICY IF EXISTS "tenant_user_insert_user_favorites" ON public.user_favorites;
CREATE POLICY "tenant_user_insert_user_favorites" ON public.user_favorites
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Users can update their own favorites
DROP POLICY IF EXISTS "tenant_user_update_user_favorites" ON public.user_favorites;
CREATE POLICY "tenant_user_update_user_favorites" ON public.user_favorites
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Users can delete their own favorites
DROP POLICY IF EXISTS "tenant_user_delete_user_favorites" ON public.user_favorites;
CREATE POLICY "tenant_user_delete_user_favorites" ON public.user_favorites
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );


-- === user_addresses ===

-- Users can view their own addresses
DROP POLICY IF EXISTS "tenant_user_select_user_addresses" ON public.user_addresses;
CREATE POLICY "tenant_user_select_user_addresses" ON public.user_addresses
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Users can create their own addresses
DROP POLICY IF EXISTS "tenant_user_insert_user_addresses" ON public.user_addresses;
CREATE POLICY "tenant_user_insert_user_addresses" ON public.user_addresses
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Users can update their own addresses
DROP POLICY IF EXISTS "tenant_user_update_user_addresses" ON public.user_addresses;
CREATE POLICY "tenant_user_update_user_addresses" ON public.user_addresses
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Users can delete their own addresses
DROP POLICY IF EXISTS "tenant_user_delete_user_addresses" ON public.user_addresses;
CREATE POLICY "tenant_user_delete_user_addresses" ON public.user_addresses
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );


-- === notifications ===

-- Users can view their own notifications
DROP POLICY IF EXISTS "tenant_user_select_notifications" ON public.notifications;
CREATE POLICY "tenant_user_select_notifications" ON public.notifications
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Users can update their own notifications (mark as read)
DROP POLICY IF EXISTS "tenant_user_update_notifications" ON public.notifications;
CREATE POLICY "tenant_user_update_notifications" ON public.notifications
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND user_id = (select auth.uid())
  );

-- Any authenticated user can insert notifications (system notifications)
DROP POLICY IF EXISTS "tenant_system_insert_notifications" ON public.notifications;
CREATE POLICY "tenant_system_insert_notifications" ON public.notifications
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select auth.uid()) IS NOT NULL
  );

-- Admin can view all notifications for the tenant
DROP POLICY IF EXISTS "tenant_admin_select_notifications" ON public.notifications;
CREATE POLICY "tenant_admin_select_notifications" ON public.notifications
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- ----------------------------------------------------------------------------
-- CATEGORY C: KDS Tables (4 tables)
-- Any tenant member (owner/admin/staff) can read; admin/owner can write.
-- Requires authentication -- no anonymous access.
-- ----------------------------------------------------------------------------

-- === kds_categories ===

DROP POLICY IF EXISTS "tenant_staff_select_kds_categories" ON public.kds_categories;
CREATE POLICY "tenant_staff_select_kds_categories" ON public.kds_categories
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_categories" ON public.kds_categories;
CREATE POLICY "tenant_admin_insert_kds_categories" ON public.kds_categories
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_categories" ON public.kds_categories;
CREATE POLICY "tenant_admin_update_kds_categories" ON public.kds_categories
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_categories" ON public.kds_categories;
CREATE POLICY "tenant_admin_delete_kds_categories" ON public.kds_categories
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === kds_menu_items ===

DROP POLICY IF EXISTS "tenant_staff_select_kds_menu_items" ON public.kds_menu_items;
CREATE POLICY "tenant_staff_select_kds_menu_items" ON public.kds_menu_items
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_menu_items" ON public.kds_menu_items;
CREATE POLICY "tenant_admin_insert_kds_menu_items" ON public.kds_menu_items
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_menu_items" ON public.kds_menu_items;
CREATE POLICY "tenant_admin_update_kds_menu_items" ON public.kds_menu_items
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_menu_items" ON public.kds_menu_items;
CREATE POLICY "tenant_admin_delete_kds_menu_items" ON public.kds_menu_items
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === kds_settings ===

DROP POLICY IF EXISTS "tenant_staff_select_kds_settings" ON public.kds_settings;
CREATE POLICY "tenant_staff_select_kds_settings" ON public.kds_settings
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_settings" ON public.kds_settings;
CREATE POLICY "tenant_admin_insert_kds_settings" ON public.kds_settings
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_settings" ON public.kds_settings;
CREATE POLICY "tenant_admin_update_kds_settings" ON public.kds_settings
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_settings" ON public.kds_settings;
CREATE POLICY "tenant_admin_delete_kds_settings" ON public.kds_settings
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === kds_images ===

DROP POLICY IF EXISTS "tenant_staff_select_kds_images" ON public.kds_images;
CREATE POLICY "tenant_staff_select_kds_images" ON public.kds_images
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_images" ON public.kds_images;
CREATE POLICY "tenant_admin_insert_kds_images" ON public.kds_images
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_images" ON public.kds_images;
CREATE POLICY "tenant_admin_update_kds_images" ON public.kds_images
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_images" ON public.kds_images;
CREATE POLICY "tenant_admin_delete_kds_images" ON public.kds_images
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- ----------------------------------------------------------------------------
-- CATEGORY D: Admin Tables (38 tables)
-- Owner/admin full CRUD; staff SELECT only; all tenant-scoped.
-- Each table gets exactly 4 policies: staff_select, admin_insert, admin_update, admin_delete.
-- ----------------------------------------------------------------------------

-- === suppliers ===

DROP POLICY IF EXISTS "tenant_staff_select_suppliers" ON public.suppliers;
CREATE POLICY "tenant_staff_select_suppliers" ON public.suppliers
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_suppliers" ON public.suppliers;
CREATE POLICY "tenant_admin_insert_suppliers" ON public.suppliers
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_suppliers" ON public.suppliers;
CREATE POLICY "tenant_admin_update_suppliers" ON public.suppliers
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_suppliers" ON public.suppliers;
CREATE POLICY "tenant_admin_delete_suppliers" ON public.suppliers
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === inventory_items ===

DROP POLICY IF EXISTS "tenant_staff_select_inventory_items" ON public.inventory_items;
CREATE POLICY "tenant_staff_select_inventory_items" ON public.inventory_items
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_inventory_items" ON public.inventory_items;
CREATE POLICY "tenant_admin_insert_inventory_items" ON public.inventory_items
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_inventory_items" ON public.inventory_items;
CREATE POLICY "tenant_admin_update_inventory_items" ON public.inventory_items
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_inventory_items" ON public.inventory_items;
CREATE POLICY "tenant_admin_delete_inventory_items" ON public.inventory_items
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === stock_movements ===

DROP POLICY IF EXISTS "tenant_staff_select_stock_movements" ON public.stock_movements;
CREATE POLICY "tenant_staff_select_stock_movements" ON public.stock_movements
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_stock_movements" ON public.stock_movements;
CREATE POLICY "tenant_admin_insert_stock_movements" ON public.stock_movements
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_stock_movements" ON public.stock_movements;
CREATE POLICY "tenant_admin_update_stock_movements" ON public.stock_movements
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_stock_movements" ON public.stock_movements;
CREATE POLICY "tenant_admin_delete_stock_movements" ON public.stock_movements
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === purchase_orders ===

DROP POLICY IF EXISTS "tenant_staff_select_purchase_orders" ON public.purchase_orders;
CREATE POLICY "tenant_staff_select_purchase_orders" ON public.purchase_orders
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_purchase_orders" ON public.purchase_orders;
CREATE POLICY "tenant_admin_insert_purchase_orders" ON public.purchase_orders
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_purchase_orders" ON public.purchase_orders;
CREATE POLICY "tenant_admin_update_purchase_orders" ON public.purchase_orders
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_purchase_orders" ON public.purchase_orders;
CREATE POLICY "tenant_admin_delete_purchase_orders" ON public.purchase_orders
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === purchase_order_items ===

DROP POLICY IF EXISTS "tenant_staff_select_purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "tenant_staff_select_purchase_order_items" ON public.purchase_order_items
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "tenant_admin_insert_purchase_order_items" ON public.purchase_order_items
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "tenant_admin_update_purchase_order_items" ON public.purchase_order_items
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "tenant_admin_delete_purchase_order_items" ON public.purchase_order_items
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === purchase_order_status_history ===

DROP POLICY IF EXISTS "tenant_staff_select_purchase_order_status_history" ON public.purchase_order_status_history;
CREATE POLICY "tenant_staff_select_purchase_order_status_history" ON public.purchase_order_status_history
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_purchase_order_status_history" ON public.purchase_order_status_history;
CREATE POLICY "tenant_admin_insert_purchase_order_status_history" ON public.purchase_order_status_history
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_purchase_order_status_history" ON public.purchase_order_status_history;
CREATE POLICY "tenant_admin_update_purchase_order_status_history" ON public.purchase_order_status_history
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_purchase_order_status_history" ON public.purchase_order_status_history;
CREATE POLICY "tenant_admin_delete_purchase_order_status_history" ON public.purchase_order_status_history
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === purchase_order_attachments ===

DROP POLICY IF EXISTS "tenant_staff_select_purchase_order_attachments" ON public.purchase_order_attachments;
CREATE POLICY "tenant_staff_select_purchase_order_attachments" ON public.purchase_order_attachments
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_purchase_order_attachments" ON public.purchase_order_attachments;
CREATE POLICY "tenant_admin_insert_purchase_order_attachments" ON public.purchase_order_attachments
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_purchase_order_attachments" ON public.purchase_order_attachments;
CREATE POLICY "tenant_admin_update_purchase_order_attachments" ON public.purchase_order_attachments
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_purchase_order_attachments" ON public.purchase_order_attachments;
CREATE POLICY "tenant_admin_delete_purchase_order_attachments" ON public.purchase_order_attachments
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === purchase_order_receipts ===

DROP POLICY IF EXISTS "tenant_staff_select_purchase_order_receipts" ON public.purchase_order_receipts;
CREATE POLICY "tenant_staff_select_purchase_order_receipts" ON public.purchase_order_receipts
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_purchase_order_receipts" ON public.purchase_order_receipts;
CREATE POLICY "tenant_admin_insert_purchase_order_receipts" ON public.purchase_order_receipts
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_purchase_order_receipts" ON public.purchase_order_receipts;
CREATE POLICY "tenant_admin_update_purchase_order_receipts" ON public.purchase_order_receipts
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_purchase_order_receipts" ON public.purchase_order_receipts;
CREATE POLICY "tenant_admin_delete_purchase_order_receipts" ON public.purchase_order_receipts
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === low_stock_alerts ===

DROP POLICY IF EXISTS "tenant_staff_select_low_stock_alerts" ON public.low_stock_alerts;
CREATE POLICY "tenant_staff_select_low_stock_alerts" ON public.low_stock_alerts
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_low_stock_alerts" ON public.low_stock_alerts;
CREATE POLICY "tenant_admin_insert_low_stock_alerts" ON public.low_stock_alerts
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_low_stock_alerts" ON public.low_stock_alerts;
CREATE POLICY "tenant_admin_update_low_stock_alerts" ON public.low_stock_alerts
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_low_stock_alerts" ON public.low_stock_alerts;
CREATE POLICY "tenant_admin_delete_low_stock_alerts" ON public.low_stock_alerts
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === recipe_ingredients ===

DROP POLICY IF EXISTS "tenant_staff_select_recipe_ingredients" ON public.recipe_ingredients;
CREATE POLICY "tenant_staff_select_recipe_ingredients" ON public.recipe_ingredients
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_recipe_ingredients" ON public.recipe_ingredients;
CREATE POLICY "tenant_admin_insert_recipe_ingredients" ON public.recipe_ingredients
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_recipe_ingredients" ON public.recipe_ingredients;
CREATE POLICY "tenant_admin_update_recipe_ingredients" ON public.recipe_ingredients
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_recipe_ingredients" ON public.recipe_ingredients;
CREATE POLICY "tenant_admin_delete_recipe_ingredients" ON public.recipe_ingredients
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === inventory_settings ===

DROP POLICY IF EXISTS "tenant_staff_select_inventory_settings" ON public.inventory_settings;
CREATE POLICY "tenant_staff_select_inventory_settings" ON public.inventory_settings
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_inventory_settings" ON public.inventory_settings;
CREATE POLICY "tenant_admin_insert_inventory_settings" ON public.inventory_settings
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_inventory_settings" ON public.inventory_settings;
CREATE POLICY "tenant_admin_update_inventory_settings" ON public.inventory_settings
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_inventory_settings" ON public.inventory_settings;
CREATE POLICY "tenant_admin_delete_inventory_settings" ON public.inventory_settings
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === inventory_locations ===

DROP POLICY IF EXISTS "tenant_staff_select_inventory_locations" ON public.inventory_locations;
CREATE POLICY "tenant_staff_select_inventory_locations" ON public.inventory_locations
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_inventory_locations" ON public.inventory_locations;
CREATE POLICY "tenant_admin_insert_inventory_locations" ON public.inventory_locations
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_inventory_locations" ON public.inventory_locations;
CREATE POLICY "tenant_admin_update_inventory_locations" ON public.inventory_locations
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_inventory_locations" ON public.inventory_locations;
CREATE POLICY "tenant_admin_delete_inventory_locations" ON public.inventory_locations
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === inventory_unit_types ===

DROP POLICY IF EXISTS "tenant_staff_select_inventory_unit_types" ON public.inventory_unit_types;
CREATE POLICY "tenant_staff_select_inventory_unit_types" ON public.inventory_unit_types
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_inventory_unit_types" ON public.inventory_unit_types;
CREATE POLICY "tenant_admin_insert_inventory_unit_types" ON public.inventory_unit_types
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_inventory_unit_types" ON public.inventory_unit_types;
CREATE POLICY "tenant_admin_update_inventory_unit_types" ON public.inventory_unit_types
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_inventory_unit_types" ON public.inventory_unit_types;
CREATE POLICY "tenant_admin_delete_inventory_unit_types" ON public.inventory_unit_types
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === invoices ===

DROP POLICY IF EXISTS "tenant_staff_select_invoices" ON public.invoices;
CREATE POLICY "tenant_staff_select_invoices" ON public.invoices
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_invoices" ON public.invoices;
CREATE POLICY "tenant_admin_insert_invoices" ON public.invoices
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_invoices" ON public.invoices;
CREATE POLICY "tenant_admin_update_invoices" ON public.invoices
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_invoices" ON public.invoices;
CREATE POLICY "tenant_admin_delete_invoices" ON public.invoices
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === invoice_items ===

DROP POLICY IF EXISTS "tenant_staff_select_invoice_items" ON public.invoice_items;
CREATE POLICY "tenant_staff_select_invoice_items" ON public.invoice_items
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_invoice_items" ON public.invoice_items;
CREATE POLICY "tenant_admin_insert_invoice_items" ON public.invoice_items
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_invoice_items" ON public.invoice_items;
CREATE POLICY "tenant_admin_update_invoice_items" ON public.invoice_items
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_invoice_items" ON public.invoice_items;
CREATE POLICY "tenant_admin_delete_invoice_items" ON public.invoice_items
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === order_invoice_matches ===

DROP POLICY IF EXISTS "tenant_staff_select_order_invoice_matches" ON public.order_invoice_matches;
CREATE POLICY "tenant_staff_select_order_invoice_matches" ON public.order_invoice_matches
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_order_invoice_matches" ON public.order_invoice_matches;
CREATE POLICY "tenant_admin_insert_order_invoice_matches" ON public.order_invoice_matches
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_order_invoice_matches" ON public.order_invoice_matches;
CREATE POLICY "tenant_admin_update_order_invoice_matches" ON public.order_invoice_matches
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_order_invoice_matches" ON public.order_invoice_matches;
CREATE POLICY "tenant_admin_delete_order_invoice_matches" ON public.order_invoice_matches
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === supplier_invoice_templates ===

DROP POLICY IF EXISTS "tenant_staff_select_supplier_invoice_templates" ON public.supplier_invoice_templates;
CREATE POLICY "tenant_staff_select_supplier_invoice_templates" ON public.supplier_invoice_templates
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_supplier_invoice_templates" ON public.supplier_invoice_templates;
CREATE POLICY "tenant_admin_insert_supplier_invoice_templates" ON public.supplier_invoice_templates
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_supplier_invoice_templates" ON public.supplier_invoice_templates;
CREATE POLICY "tenant_admin_update_supplier_invoice_templates" ON public.supplier_invoice_templates
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_supplier_invoice_templates" ON public.supplier_invoice_templates;
CREATE POLICY "tenant_admin_delete_supplier_invoice_templates" ON public.supplier_invoice_templates
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === invoice_import_sessions ===

DROP POLICY IF EXISTS "tenant_staff_select_invoice_import_sessions" ON public.invoice_import_sessions;
CREATE POLICY "tenant_staff_select_invoice_import_sessions" ON public.invoice_import_sessions
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_invoice_import_sessions" ON public.invoice_import_sessions;
CREATE POLICY "tenant_admin_insert_invoice_import_sessions" ON public.invoice_import_sessions
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_invoice_import_sessions" ON public.invoice_import_sessions;
CREATE POLICY "tenant_admin_update_invoice_import_sessions" ON public.invoice_import_sessions
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_invoice_import_sessions" ON public.invoice_import_sessions;
CREATE POLICY "tenant_admin_delete_invoice_import_sessions" ON public.invoice_import_sessions
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === supplier_email_templates ===

DROP POLICY IF EXISTS "tenant_staff_select_supplier_email_templates" ON public.supplier_email_templates;
CREATE POLICY "tenant_staff_select_supplier_email_templates" ON public.supplier_email_templates
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_supplier_email_templates" ON public.supplier_email_templates;
CREATE POLICY "tenant_admin_insert_supplier_email_templates" ON public.supplier_email_templates
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_supplier_email_templates" ON public.supplier_email_templates;
CREATE POLICY "tenant_admin_update_supplier_email_templates" ON public.supplier_email_templates
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_supplier_email_templates" ON public.supplier_email_templates;
CREATE POLICY "tenant_admin_delete_supplier_email_templates" ON public.supplier_email_templates
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === webhook_events ===

DROP POLICY IF EXISTS "tenant_staff_select_webhook_events" ON public.webhook_events;
CREATE POLICY "tenant_staff_select_webhook_events" ON public.webhook_events
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_webhook_events" ON public.webhook_events;
CREATE POLICY "tenant_admin_insert_webhook_events" ON public.webhook_events
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_webhook_events" ON public.webhook_events;
CREATE POLICY "tenant_admin_update_webhook_events" ON public.webhook_events
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_webhook_events" ON public.webhook_events;
CREATE POLICY "tenant_admin_delete_webhook_events" ON public.webhook_events
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === inventory_sales_sync_runs ===

DROP POLICY IF EXISTS "tenant_staff_select_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs;
CREATE POLICY "tenant_staff_select_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs;
CREATE POLICY "tenant_admin_insert_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs;
CREATE POLICY "tenant_admin_update_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs;
CREATE POLICY "tenant_admin_delete_inventory_sales_sync_runs" ON public.inventory_sales_sync_runs
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === sales_transactions ===

DROP POLICY IF EXISTS "tenant_staff_select_sales_transactions" ON public.sales_transactions;
CREATE POLICY "tenant_staff_select_sales_transactions" ON public.sales_transactions
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_sales_transactions" ON public.sales_transactions;
CREATE POLICY "tenant_admin_insert_sales_transactions" ON public.sales_transactions
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_sales_transactions" ON public.sales_transactions;
CREATE POLICY "tenant_admin_update_sales_transactions" ON public.sales_transactions
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_sales_transactions" ON public.sales_transactions;
CREATE POLICY "tenant_admin_delete_sales_transactions" ON public.sales_transactions
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === sales_transaction_items ===

DROP POLICY IF EXISTS "tenant_staff_select_sales_transaction_items" ON public.sales_transaction_items;
CREATE POLICY "tenant_staff_select_sales_transaction_items" ON public.sales_transaction_items
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_sales_transaction_items" ON public.sales_transaction_items;
CREATE POLICY "tenant_admin_insert_sales_transaction_items" ON public.sales_transaction_items
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_sales_transaction_items" ON public.sales_transaction_items;
CREATE POLICY "tenant_admin_update_sales_transaction_items" ON public.sales_transaction_items
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_sales_transaction_items" ON public.sales_transaction_items;
CREATE POLICY "tenant_admin_delete_sales_transaction_items" ON public.sales_transaction_items
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === inventory_item_cost_history ===

DROP POLICY IF EXISTS "tenant_staff_select_inventory_item_cost_history" ON public.inventory_item_cost_history;
CREATE POLICY "tenant_staff_select_inventory_item_cost_history" ON public.inventory_item_cost_history
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_inventory_item_cost_history" ON public.inventory_item_cost_history;
CREATE POLICY "tenant_admin_insert_inventory_item_cost_history" ON public.inventory_item_cost_history
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_inventory_item_cost_history" ON public.inventory_item_cost_history;
CREATE POLICY "tenant_admin_update_inventory_item_cost_history" ON public.inventory_item_cost_history
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_inventory_item_cost_history" ON public.inventory_item_cost_history;
CREATE POLICY "tenant_admin_delete_inventory_item_cost_history" ON public.inventory_item_cost_history
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === inventory_valuations ===

DROP POLICY IF EXISTS "tenant_staff_select_inventory_valuations" ON public.inventory_valuations;
CREATE POLICY "tenant_staff_select_inventory_valuations" ON public.inventory_valuations
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_inventory_valuations" ON public.inventory_valuations;
CREATE POLICY "tenant_admin_insert_inventory_valuations" ON public.inventory_valuations
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_inventory_valuations" ON public.inventory_valuations;
CREATE POLICY "tenant_admin_update_inventory_valuations" ON public.inventory_valuations
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_inventory_valuations" ON public.inventory_valuations;
CREATE POLICY "tenant_admin_delete_inventory_valuations" ON public.inventory_valuations
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_periods ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_periods" ON public.cogs_periods;
CREATE POLICY "tenant_staff_select_cogs_periods" ON public.cogs_periods
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_periods" ON public.cogs_periods;
CREATE POLICY "tenant_admin_insert_cogs_periods" ON public.cogs_periods
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_periods" ON public.cogs_periods;
CREATE POLICY "tenant_admin_update_cogs_periods" ON public.cogs_periods
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_periods" ON public.cogs_periods;
CREATE POLICY "tenant_admin_delete_cogs_periods" ON public.cogs_periods
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_reports ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_reports" ON public.cogs_reports;
CREATE POLICY "tenant_staff_select_cogs_reports" ON public.cogs_reports
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_reports" ON public.cogs_reports;
CREATE POLICY "tenant_admin_insert_cogs_reports" ON public.cogs_reports
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_reports" ON public.cogs_reports;
CREATE POLICY "tenant_admin_update_cogs_reports" ON public.cogs_reports
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_reports" ON public.cogs_reports;
CREATE POLICY "tenant_admin_delete_cogs_reports" ON public.cogs_reports
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_products ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_products" ON public.cogs_products;
CREATE POLICY "tenant_staff_select_cogs_products" ON public.cogs_products
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_products" ON public.cogs_products;
CREATE POLICY "tenant_admin_insert_cogs_products" ON public.cogs_products
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_products" ON public.cogs_products;
CREATE POLICY "tenant_admin_update_cogs_products" ON public.cogs_products
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_products" ON public.cogs_products;
CREATE POLICY "tenant_admin_delete_cogs_products" ON public.cogs_products
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_sellables ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_sellables" ON public.cogs_sellables;
CREATE POLICY "tenant_staff_select_cogs_sellables" ON public.cogs_sellables
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_sellables" ON public.cogs_sellables;
CREATE POLICY "tenant_admin_insert_cogs_sellables" ON public.cogs_sellables
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_sellables" ON public.cogs_sellables;
CREATE POLICY "tenant_admin_update_cogs_sellables" ON public.cogs_sellables
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_sellables" ON public.cogs_sellables;
CREATE POLICY "tenant_admin_delete_cogs_sellables" ON public.cogs_sellables
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_sellable_aliases ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_sellable_aliases" ON public.cogs_sellable_aliases;
CREATE POLICY "tenant_staff_select_cogs_sellable_aliases" ON public.cogs_sellable_aliases
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_sellable_aliases" ON public.cogs_sellable_aliases;
CREATE POLICY "tenant_admin_insert_cogs_sellable_aliases" ON public.cogs_sellable_aliases
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_sellable_aliases" ON public.cogs_sellable_aliases;
CREATE POLICY "tenant_admin_update_cogs_sellable_aliases" ON public.cogs_sellable_aliases
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_sellable_aliases" ON public.cogs_sellable_aliases;
CREATE POLICY "tenant_admin_delete_cogs_sellable_aliases" ON public.cogs_sellable_aliases
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_product_recipes ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_product_recipes" ON public.cogs_product_recipes;
CREATE POLICY "tenant_staff_select_cogs_product_recipes" ON public.cogs_product_recipes
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_product_recipes" ON public.cogs_product_recipes;
CREATE POLICY "tenant_admin_insert_cogs_product_recipes" ON public.cogs_product_recipes
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_product_recipes" ON public.cogs_product_recipes;
CREATE POLICY "tenant_admin_update_cogs_product_recipes" ON public.cogs_product_recipes
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_product_recipes" ON public.cogs_product_recipes;
CREATE POLICY "tenant_admin_delete_cogs_product_recipes" ON public.cogs_product_recipes
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_product_recipe_lines ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines;
CREATE POLICY "tenant_staff_select_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines;
CREATE POLICY "tenant_admin_insert_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines;
CREATE POLICY "tenant_admin_update_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines;
CREATE POLICY "tenant_admin_delete_cogs_product_recipe_lines" ON public.cogs_product_recipe_lines
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_sellable_recipe_overrides ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides;
CREATE POLICY "tenant_staff_select_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides;
CREATE POLICY "tenant_admin_insert_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides;
CREATE POLICY "tenant_admin_update_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides;
CREATE POLICY "tenant_admin_delete_cogs_sellable_recipe_overrides" ON public.cogs_sellable_recipe_overrides
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_sellable_recipe_override_ops ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops;
CREATE POLICY "tenant_staff_select_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops;
CREATE POLICY "tenant_admin_insert_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops;
CREATE POLICY "tenant_admin_update_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops;
CREATE POLICY "tenant_admin_delete_cogs_sellable_recipe_override_ops" ON public.cogs_sellable_recipe_override_ops
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_modifier_sets ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_modifier_sets" ON public.cogs_modifier_sets;
CREATE POLICY "tenant_staff_select_cogs_modifier_sets" ON public.cogs_modifier_sets
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_modifier_sets" ON public.cogs_modifier_sets;
CREATE POLICY "tenant_admin_insert_cogs_modifier_sets" ON public.cogs_modifier_sets
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_modifier_sets" ON public.cogs_modifier_sets;
CREATE POLICY "tenant_admin_update_cogs_modifier_sets" ON public.cogs_modifier_sets
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_modifier_sets" ON public.cogs_modifier_sets;
CREATE POLICY "tenant_admin_delete_cogs_modifier_sets" ON public.cogs_modifier_sets
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_modifier_options ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_modifier_options" ON public.cogs_modifier_options;
CREATE POLICY "tenant_staff_select_cogs_modifier_options" ON public.cogs_modifier_options
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_modifier_options" ON public.cogs_modifier_options;
CREATE POLICY "tenant_admin_insert_cogs_modifier_options" ON public.cogs_modifier_options
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_modifier_options" ON public.cogs_modifier_options;
CREATE POLICY "tenant_admin_update_cogs_modifier_options" ON public.cogs_modifier_options
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_modifier_options" ON public.cogs_modifier_options;
CREATE POLICY "tenant_admin_delete_cogs_modifier_options" ON public.cogs_modifier_options
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_modifier_option_recipes ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes;
CREATE POLICY "tenant_staff_select_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes;
CREATE POLICY "tenant_admin_insert_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes;
CREATE POLICY "tenant_admin_update_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes;
CREATE POLICY "tenant_admin_delete_cogs_modifier_option_recipes" ON public.cogs_modifier_option_recipes
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );


-- === cogs_modifier_option_recipe_lines ===

DROP POLICY IF EXISTS "tenant_staff_select_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines;
CREATE POLICY "tenant_staff_select_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines;
CREATE POLICY "tenant_admin_insert_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines;
CREATE POLICY "tenant_admin_update_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines;
CREATE POLICY "tenant_admin_delete_cogs_modifier_option_recipe_lines" ON public.cogs_modifier_option_recipe_lines
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );



-- Re-apply SECURITY DEFINER functions from 300001

-- ============================================================================
-- Updates inventory stock and logs a movement record.
-- SECURITY DEFINER: bypasses RLS, must filter by tenant_id explicitly.
-- NOTE: Original function referenced 'inventory_movements' but actual table
-- is 'stock_movements'. This migration uses the correct table name.
CREATE OR REPLACE FUNCTION public.update_inventory_stock(
  item_id UUID,
  quantity_change INTEGER,
  operation_type TEXT DEFAULT 'manual',
  notes TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid := (current_setting('app.tenant_id', true))::uuid;
BEGIN
  UPDATE public.inventory_items
  SET
    current_stock = current_stock + quantity_change,
    last_restocked_at = CASE WHEN quantity_change > 0 THEN NOW() ELSE last_restocked_at END,
    updated_at = NOW()
  WHERE id = item_id AND tenant_id = v_tenant_id;

  INSERT INTO public.stock_movements (
    inventory_item_id, movement_type, quantity, notes, tenant_id, created_at
  ) VALUES (
    item_id,
    CASE WHEN quantity_change > 0 THEN 'stock_in' ELSE 'stock_out' END,
    ABS(quantity_change),
    COALESCE(notes, operation_type),
    v_tenant_id,
    NOW()
  );
EXCEPTION
  WHEN undefined_table THEN
    UPDATE public.inventory_items
    SET
      current_stock = current_stock + quantity_change,
      last_restocked_at = CASE WHEN quantity_change > 0 THEN NOW() ELSE last_restocked_at END,
      updated_at = NOW()
    WHERE id = item_id AND tenant_id = v_tenant_id;
END;
$$;

-- ============================================================================
-- 2. update_stock_simple
-- ============================================================================
-- Simple stock update (set absolute value, no movement logging).
-- SECURITY DEFINER: bypasses RLS, must filter by tenant_id explicitly.
CREATE OR REPLACE FUNCTION public.update_stock_simple(
  item_id UUID,
  new_stock INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.inventory_items
  SET current_stock = new_stock, updated_at = NOW()
  WHERE id = item_id
    AND tenant_id = (current_setting('app.tenant_id', true))::uuid;
END;
$$;

-- ============================================================================
-- 3. create_order_notification
-- ============================================================================
-- Creates a notification when an order status changes.
-- SECURITY DEFINER: bypasses RLS, must include tenant_id in INSERT.
-- NOTE: tenant_id comes from session variable, NOT from a new parameter.
-- This preserves backward compatibility with existing callers.
CREATE OR REPLACE FUNCTION public.create_order_notification(
    p_user_id UUID,
    p_order_id UUID,
    p_status VARCHAR(50),
    p_order_number VARCHAR(50)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    notification_id UUID;
    notification_title VARCHAR(255);
    notification_message TEXT;
    v_tenant_id uuid := (current_setting('app.tenant_id', true))::uuid;
BEGIN
    -- Set title and message based on order status
    CASE p_status
        WHEN 'confirmed' THEN
            notification_title := 'Order Confirmed';
            notification_message := 'Your order #' || p_order_number || ' has been confirmed and is being prepared.';
        WHEN 'preparing' THEN
            notification_title := 'Order Being Prepared';
            notification_message := 'Your order #' || p_order_number || ' is currently being prepared.';
        WHEN 'ready' THEN
            notification_title := 'Order Ready';
            notification_message := 'Your order #' || p_order_number || ' is ready for pickup!';
        WHEN 'completed' THEN
            notification_title := 'Order Complete';
            notification_message := 'Thank you! Your order #' || p_order_number || ' has been completed.';
        WHEN 'cancelled' THEN
            notification_title := 'Order Cancelled';
            notification_message := 'Your order #' || p_order_number || ' has been cancelled.';
        ELSE
            notification_title := 'Order Update';
            notification_message := 'Your order #' || p_order_number || ' status has been updated to ' || p_status || '.';
    END CASE;

    INSERT INTO public.notifications (
        user_id, title, message, type, action_url, data, tenant_id
    ) VALUES (
        p_user_id,
        notification_title,
        notification_message,
        'order_status',
        '/orders',
        jsonb_build_object('order_id', p_order_id, 'order_number', p_order_number, 'status', p_status),
        v_tenant_id
    ) RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$$;

-- ============================================================================
-- 4. get_unread_notification_count
-- ============================================================================
-- Returns count of unread notifications for a user within current tenant.
-- SECURITY DEFINER: bypasses RLS, must filter by tenant_id explicitly.
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM public.notifications
        WHERE user_id = p_user_id
          AND read = FALSE
          AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    );
END;
$$;

-- ============================================================================
-- 5. mark_all_notifications_read
-- ============================================================================
-- Marks all unread notifications as read for a user within current tenant.
-- SECURITY DEFINER: bypasses RLS, must filter by tenant_id explicitly.
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE public.notifications
    SET read = TRUE
    WHERE user_id = p_user_id
      AND read = FALSE
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$;

-- ============================================================================
-- Preserve existing GRANT statements
-- ============================================================================
-- These GRANTs ensure authenticated users can call the inventory functions.
-- (They were present in the original function definitions.)
GRANT EXECUTE ON FUNCTION public.update_inventory_stock(UUID, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_stock_simple(UUID, INTEGER) TO authenticated;


COMMIT;
