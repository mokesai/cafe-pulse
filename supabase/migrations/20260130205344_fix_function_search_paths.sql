-- Migration: Fix Function Search Path Vulnerabilities
-- Issue: Functions without fixed search_path can be exploited via schema injection
-- Solution: Add SET search_path = '' and use fully qualified table names

-- 1. is_admin - SECURITY DEFINER function
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

-- 2. get_admin_user_id - SECURITY DEFINER function
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

-- 3. handle_new_user - SECURITY DEFINER trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name');
  RETURN new;
END;
$function$;

-- 4. handle_updated_at - trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  new.updated_at = timezone('utc'::text, now());
  RETURN new;
END;
$function$;

-- 5. update_updated_at_column - trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$function$;

-- 6. increment_inventory_stock
CREATE OR REPLACE FUNCTION public.increment_inventory_stock(item_id uuid, quantity integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.inventory_items
  SET
    current_stock = current_stock + quantity,
    last_restocked_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = item_id;
END;
$function$;

-- 7. decrement_inventory_stock
CREATE OR REPLACE FUNCTION public.decrement_inventory_stock(item_id uuid, quantity integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.inventory_items
  SET
    current_stock = GREATEST(0, current_stock - quantity),
    updated_at = timezone('utc'::text, now())
  WHERE id = item_id;
END;
$function$;

-- 8. update_inventory_stock - SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.update_inventory_stock(item_id uuid, quantity_change integer, operation_type text DEFAULT 'manual'::text, notes text DEFAULT ''::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Update the inventory item stock
  UPDATE public.inventory_items
  SET
    current_stock = current_stock + quantity_change,
    last_restocked_at = CASE
      WHEN quantity_change > 0 THEN NOW()
      ELSE last_restocked_at
    END,
    updated_at = NOW()
  WHERE id = item_id;

  -- Insert inventory movement record if the table exists
  INSERT INTO public.inventory_movements (
    inventory_item_id,
    movement_type,
    quantity,
    notes,
    created_at
  ) VALUES (
    item_id,
    CASE
      WHEN quantity_change > 0 THEN 'stock_in'
      ELSE 'stock_out'
    END,
    ABS(quantity_change),
    COALESCE(notes, operation_type),
    NOW()
  );

EXCEPTION
  -- If inventory_movements table doesn't exist, just update the stock
  WHEN undefined_table THEN
    UPDATE public.inventory_items
    SET
      current_stock = current_stock + quantity_change,
      last_restocked_at = CASE
        WHEN quantity_change > 0 THEN NOW()
        ELSE last_restocked_at
      END,
      updated_at = NOW()
    WHERE id = item_id;
END;
$function$;

-- 9. update_stock_simple - SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.update_stock_simple(item_id uuid, new_stock integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.inventory_items
  SET
    current_stock = new_stock,
    updated_at = NOW()
  WHERE id = item_id;
END;
$function$;

-- 10. shift_inventory_between_items
CREATE OR REPLACE FUNCTION public.shift_inventory_between_items(p_from_item_id uuid, p_to_item_id uuid, p_quantity numeric)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;

  -- Decrement source
  UPDATE public.inventory_items
  SET current_stock = current_stock - p_quantity
  WHERE id = p_from_item_id;

  -- Increment target
  UPDATE public.inventory_items
  SET current_stock = current_stock + p_quantity
  WHERE id = p_to_item_id;
END;
$function$;

-- 11. calculate_invoice_total
CREATE OR REPLACE FUNCTION public.calculate_invoice_total(invoice_uuid uuid)
RETURNS numeric
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  total DECIMAL(10,2);
BEGIN
  SELECT COALESCE(SUM(total_price), 0)
  INTO total
  FROM public.invoice_items
  WHERE invoice_id = invoice_uuid;

  RETURN total;
END;
$function$;

-- 12. update_invoice_status - trigger function
CREATE OR REPLACE FUNCTION public.update_invoice_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  -- Auto-transition to 'parsed' when parsing completes successfully
  IF NEW.parsed_data IS NOT NULL AND NEW.parsing_confidence > 0 AND OLD.status = 'parsing' THEN
    NEW.status = 'parsed';
    NEW.processed_at = NOW();
  END IF;

  -- Auto-calculate total from line items if not set
  IF NEW.total_amount = 0 THEN
    NEW.total_amount = public.calculate_invoice_total(NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

-- 13. get_unread_notification_count - SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM public.notifications
        WHERE user_id = p_user_id AND read = FALSE
    );
END;
$function$;

-- 14. mark_all_notifications_read - SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE public.notifications
    SET read = TRUE
    WHERE user_id = p_user_id AND read = FALSE;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$function$;

-- 15. create_order_notification - SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.create_order_notification(p_user_id uuid, p_order_id uuid, p_status character varying, p_order_number character varying)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    notification_id UUID;
    notification_title VARCHAR(255);
    notification_message TEXT;
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

    -- Insert notification with proper action URL pointing to individual order details
    INSERT INTO public.notifications (
        user_id,
        title,
        message,
        type,
        action_url,
        data
    ) VALUES (
        p_user_id,
        notification_title,
        notification_message,
        'order_status',
        '/orders/' || p_order_id::TEXT,
        jsonb_build_object('order_id', p_order_id, 'order_number', p_order_number, 'status', p_status)
    ) RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$function$;

-- 16. log_purchase_order_receipt
CREATE OR REPLACE FUNCTION public.log_purchase_order_receipt(
    p_purchase_order_id uuid,
    p_purchase_order_item_id uuid,
    p_quantity integer,
    p_received_by uuid,
    p_notes text DEFAULT NULL::text,
    p_weight numeric DEFAULT NULL::numeric,
    p_weight_unit text DEFAULT NULL::text,
    p_photo_path text DEFAULT NULL::text,
    p_photo_url text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  item_record RECORD;
  new_receipt public.purchase_order_receipts%ROWTYPE;
  remaining integer;
  previous_status text;
  canonical_previous text;
  canonical_new text;
  order_completed boolean := false;
  remaining_count integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT
    poi.*,
    po.status AS order_status,
    po.order_number
  INTO item_record
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE poi.id = p_purchase_order_item_id
    AND poi.purchase_order_id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order item % not found for order %', p_purchase_order_item_id, p_purchase_order_id;
  END IF;

  remaining := item_record.quantity_ordered - item_record.quantity_received;

  IF remaining <= 0 THEN
    RAISE EXCEPTION 'Purchase order item already fully received';
  END IF;

  IF p_quantity > remaining THEN
    RAISE EXCEPTION 'Receipt quantity (%) exceeds remaining quantity (%)', p_quantity, remaining;
  END IF;

  INSERT INTO public.purchase_order_receipts (
    purchase_order_id,
    purchase_order_item_id,
    quantity_received,
    weight,
    weight_unit,
    notes,
    photo_path,
    photo_url,
    received_by
  )
  VALUES (
    p_purchase_order_id,
    p_purchase_order_item_id,
    p_quantity,
    p_weight,
    p_weight_unit,
    p_notes,
    p_photo_path,
    p_photo_url,
    p_received_by
  )
  RETURNING * INTO new_receipt;

  -- Keep PO item receipt bookkeeping but do NOT mutate inventory stock here.
  UPDATE public.purchase_order_items
    SET quantity_received = quantity_received + p_quantity,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_purchase_order_item_id;

  SELECT COUNT(*)
  INTO remaining_count
  FROM public.purchase_order_items poi
  WHERE poi.purchase_order_id = p_purchase_order_id
    AND poi.quantity_received < poi.quantity_ordered;

  order_completed := remaining_count = 0;

  previous_status := item_record.order_status;
  IF previous_status = 'confirmed' THEN
    canonical_previous := 'approved';
  ELSE
    canonical_previous := previous_status;
  END IF;

  IF order_completed THEN
    UPDATE public.purchase_orders
      SET status = 'received',
          actual_delivery_date = COALESCE(actual_delivery_date, timezone('utc'::text, now())),
          updated_at = timezone('utc'::text, now())
      WHERE id = p_purchase_order_id;

    canonical_new := 'received';

    IF canonical_previous IS DISTINCT FROM canonical_new THEN
      INSERT INTO public.purchase_order_status_history (
        purchase_order_id,
        previous_status,
        new_status,
        changed_by,
        note
      ) VALUES (
        p_purchase_order_id,
        canonical_previous,
        canonical_new,
        p_received_by,
        'Automatically marked as received after completing item receipts'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'receipt', to_jsonb(new_receipt),
    'order_completed', order_completed
  );
END;
$function$;

-- 17. rpc_po_supplier_metrics - SQL function
CREATE OR REPLACE FUNCTION public.rpc_po_supplier_metrics(
    p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_supplier_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
    supplier_id uuid,
    supplier_name text,
    period_month date,
    total_pos bigint,
    total_spend numeric,
    open_balance numeric,
    avg_approval_days numeric,
    avg_issue_days numeric,
    avg_receipt_days numeric,
    on_time_ratio numeric,
    fulfillment_ratio numeric,
    invoice_exception_rate numeric,
    variance_rate numeric,
    avg_invoice_throughput_days numeric,
    invoice_match_count bigint,
    invoice_exception_count bigint,
    variance_match_count bigint
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT
    v.supplier_id,
    v.supplier_name,
    v.period_month,
    v.total_pos,
    v.total_spend,
    v.open_balance,
    v.avg_approval_days,
    v.avg_issue_days,
    v.avg_receipt_days,
    CASE
      WHEN v.total_receipts > 0 THEN v.on_time_receipts::numeric / v.total_receipts::numeric
      ELSE NULL
    END AS on_time_ratio,
    CASE
      WHEN v.quantity_ordered > 0 THEN v.quantity_received::numeric / v.quantity_ordered::numeric
      ELSE NULL
    END AS fulfillment_ratio,
    CASE
      WHEN v.invoice_match_count > 0 THEN v.invoice_exception_count::numeric / v.invoice_match_count::numeric
      ELSE NULL
    END AS invoice_exception_rate,
    CASE
      WHEN v.invoice_match_count > 0 THEN v.variance_match_count::numeric / v.invoice_match_count::numeric
      ELSE NULL
    END AS variance_rate,
    v.avg_invoice_throughput_days,
    v.invoice_match_count,
    v.invoice_exception_count,
    v.variance_match_count
  FROM public.po_supplier_metrics_v v
  WHERE (p_start_date IS NULL OR v.period_month >= date_trunc('month', p_start_date)::date)
    AND (p_end_date IS NULL OR v.period_month <= date_trunc('month', p_end_date)::date)
    AND (
      p_supplier_ids IS NULL
      OR v.supplier_id = ANY(p_supplier_ids)
    );
$function$;
