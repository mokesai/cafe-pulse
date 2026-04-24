-- MOK-113: Drop DEFAULT on tenant_id columns
--
-- Every tenant-scoped table had tenant_id DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
-- (the littlecafe tenant). When admin code forgot to set tenant_id on INSERT, rows silently
-- landed on littlecafe instead of raising a NOT NULL violation. MOK-107 fixed every known
-- admin route; this migration removes the safety net so future misroutes fail loudly.
--
-- All current callers set tenant_id explicitly:
--   • Admin API routes (MOK-107, PR #55)
--   • invoice-pipeline edge function (every .insert passes tenant_id)
--   • SQL functions — `log_purchase_order_receipt` was the sole holdout; fixed below
--   • Seed migrations — they ran before this migration, so the default was still available

BEGIN;

-- 1. Fix log_purchase_order_receipt — the two INSERTs inside this RPC didn't set tenant_id.
--    Derive it from the purchase_order row the function is already fetching.
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
SET search_path TO ''
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
  v_tenant_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT
    poi.*,
    po.status AS order_status,
    po.order_number,
    po.tenant_id AS po_tenant_id
  INTO item_record
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE poi.id = p_purchase_order_item_id
    AND poi.purchase_order_id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order item % not found for order %', p_purchase_order_item_id, p_purchase_order_id;
  END IF;

  v_tenant_id := item_record.po_tenant_id;

  remaining := item_record.quantity_ordered - item_record.quantity_received;

  IF remaining <= 0 THEN
    RAISE EXCEPTION 'Purchase order item already fully received';
  END IF;

  IF p_quantity > remaining THEN
    RAISE EXCEPTION 'Receipt quantity (%) exceeds remaining quantity (%)', p_quantity, remaining;
  END IF;

  INSERT INTO public.purchase_order_receipts (
    tenant_id,
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
    v_tenant_id,
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
        tenant_id,
        purchase_order_id,
        previous_status,
        new_status,
        changed_by,
        note
      ) VALUES (
        v_tenant_id,
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

-- 2. Drop DEFAULT on tenant_id for every tenant-scoped table that has it.
DO $$
DECLARE
  tbl text;
  tenant_scoped_tables text[] := ARRAY[
    'cogs_modifier_option_recipe_lines',
    'cogs_modifier_option_recipes',
    'cogs_modifier_options',
    'cogs_modifier_sets',
    'cogs_periods',
    'cogs_product_recipe_lines',
    'cogs_product_recipes',
    'cogs_products',
    'cogs_reports',
    'cogs_sellable_aliases',
    'cogs_sellable_recipe_override_ops',
    'cogs_sellable_recipe_overrides',
    'cogs_sellables',
    'inventory_item_cost_history',
    'inventory_items',
    'inventory_locations',
    'inventory_sales_sync_runs',
    'inventory_settings',
    'inventory_unit_types',
    'inventory_valuations',
    'invoice_import_sessions',
    'invoice_items',
    'invoices',
    'kds_categories',
    'kds_images',
    'kds_menu_items',
    'kds_settings',
    'low_stock_alerts',
    'notifications',
    'order_invoice_matches',
    'order_items',
    'orders',
    'purchase_order_attachments',
    'purchase_order_items',
    'purchase_order_receipts',
    'purchase_order_status_history',
    'purchase_orders',
    'recipe_ingredients',
    'sales_transaction_items',
    'sales_transactions',
    'site_settings',
    'stock_movements',
    'supplier_email_templates',
    'supplier_invoice_templates',
    'suppliers',
    'user_addresses',
    'user_favorites',
    'webhook_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_scoped_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id DROP DEFAULT', tbl);
  END LOOP;
END $$;

COMMIT;

-- Rollback (run manually if needed):
-- BEGIN;
-- DO $$
-- DECLARE tbl text;
-- BEGIN
--   FOREACH tbl IN ARRAY ARRAY['inventory_items','suppliers',...]  -- same list
--   LOOP
--     EXECUTE format(
--       'ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT ''00000000-0000-0000-0000-000000000001''::uuid',
--       tbl
--     );
--   END LOOP;
-- END $$;
-- COMMIT;
