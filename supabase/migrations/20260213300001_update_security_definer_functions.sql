-- Migration: Update SECURITY DEFINER functions with tenant_id filtering
-- Phase 30 Plan 02 Task 1
-- Date: 2026-02-14
--
-- Purpose: SECURITY DEFINER functions bypass RLS (they run as the function owner).
-- Without explicit tenant_id filtering in the function body, they could leak or
-- modify data across tenants. This migration updates all 5 SECURITY DEFINER
-- functions that touch tenant-scoped tables.
--
-- Functions updated:
--   1. update_inventory_stock(item_id, quantity_change, operation_type, notes)
--   2. update_stock_simple(item_id, new_stock)
--   3. create_order_notification(p_user_id, p_order_id, p_status, p_order_number)
--   4. get_unread_notification_count(p_user_id)
--   5. mark_all_notifications_read(p_user_id)
--
-- Pattern: Each function reads tenant_id from session variable
--   current_setting('app.tenant_id', true)::uuid
-- and adds it to WHERE clauses (for reads/updates) or INSERT column lists.
--
-- Function signatures are UNCHANGED to maintain backward compatibility.
-- Tenant context comes from the session variable, not from parameters.

BEGIN;

-- ============================================================================
-- 1. update_inventory_stock
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
