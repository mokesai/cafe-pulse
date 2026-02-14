-- Migration: Drop remaining old non-tenant policies
-- These 13 policies were missed by the Phase 30 RLS rewrite because they used
-- a different naming pattern ("Admin can..." instead of "Authenticated users can..." etc.)
-- They use the old profiles.role = 'admin' check which is incompatible with
-- the new tenant_memberships-based access model.

BEGIN;

-- inventory_items
DROP POLICY IF EXISTS "Admin can manage inventory items" ON public.inventory_items;

-- inventory_locations
DROP POLICY IF EXISTS "Allow admin access to inventory_locations" ON public.inventory_locations;

-- inventory_settings
DROP POLICY IF EXISTS "Allow admin access to inventory_settings" ON public.inventory_settings;

-- inventory_unit_types
DROP POLICY IF EXISTS "Allow admin access to inventory_unit_types" ON public.inventory_unit_types;

-- low_stock_alerts
DROP POLICY IF EXISTS "Admin can manage low stock alerts" ON public.low_stock_alerts;

-- orders
DROP POLICY IF EXISTS "Admins can update all orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;

-- purchase_order_items
DROP POLICY IF EXISTS "Admin can manage purchase order items" ON public.purchase_order_items;

-- purchase_orders
DROP POLICY IF EXISTS "Admin can manage purchase orders" ON public.purchase_orders;

-- recipe_ingredients
DROP POLICY IF EXISTS "Admin can manage recipe ingredients" ON public.recipe_ingredients;

-- stock_movements
DROP POLICY IF EXISTS "Admin can insert stock movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Admin can view stock movements" ON public.stock_movements;

-- suppliers
DROP POLICY IF EXISTS "Admin can manage suppliers" ON public.suppliers;

COMMIT;
