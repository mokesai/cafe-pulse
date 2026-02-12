-- Migration: Fix Security Definer Views
-- Issue: Views with SECURITY DEFINER bypass RLS policies of the querying user
-- Solution: Recreate views with security_invoker = true (the secure default)

-- Drop and recreate po_supplier_metrics_v with security_invoker
DROP VIEW IF EXISTS public.po_supplier_metrics_v;

CREATE VIEW public.po_supplier_metrics_v
WITH (security_invoker = true)
AS
WITH order_base AS (
    SELECT po.id,
        po.supplier_id,
        s.name AS supplier_name,
        po.status,
        po.order_date,
        po.expected_delivery_date,
        po.total_amount,
        po.approved_at,
        po.sent_at,
        po.received_at,
        po.confirmed_at,
        COALESCE(po.approved_at, (SELECT max(ch.changed_at) AS max
               FROM public.purchase_order_status_history ch
              WHERE ch.purchase_order_id = po.id AND ch.new_status = 'approved')) AS approved_ts,
        COALESCE(po.sent_at, (SELECT max(ch.changed_at) AS max
               FROM public.purchase_order_status_history ch
              WHERE ch.purchase_order_id = po.id AND ch.new_status = 'sent')) AS sent_ts,
        COALESCE(po.received_at, (SELECT max(ch.changed_at) AS max
               FROM public.purchase_order_status_history ch
              WHERE ch.purchase_order_id = po.id AND ch.new_status = 'received')) AS received_ts
       FROM public.purchase_orders po
         LEFT JOIN public.suppliers s ON s.id = po.supplier_id
    ),
    item_quantities AS (
        SELECT purchase_order_items.purchase_order_id,
            sum(purchase_order_items.quantity_ordered) AS quantity_ordered,
            sum(purchase_order_items.quantity_received) AS quantity_received
           FROM public.purchase_order_items
          GROUP BY purchase_order_items.purchase_order_id
    ),
    invoice_stats AS (
        SELECT oim.purchase_order_id,
            count(*) AS total_matches,
            count(*) FILTER (WHERE oim.status::text = ANY (ARRAY['pending', 'reviewing', 'rejected'])) AS exception_matches,
            count(*) FILTER (WHERE abs(COALESCE(oim.amount_variance, 0::numeric)) > 1::numeric OR abs(COALESCE(oim.quantity_variance, 0::numeric)) > 0.01) AS variance_matches,
            count(*) FILTER (WHERE oim.status::text = 'confirmed') AS confirmed_matches,
            avg((EXTRACT(epoch FROM (inv.confirmed_at - inv.created_at)) / 86400.0)) FILTER (WHERE inv.confirmed_at IS NOT NULL) AS avg_invoice_throughput_days
           FROM public.order_invoice_matches oim
             LEFT JOIN public.invoices inv ON inv.id = oim.invoice_id
          GROUP BY oim.purchase_order_id
    )
SELECT ob.supplier_id,
    ob.supplier_name,
    (date_trunc('month', ob.order_date::timestamp with time zone))::date AS period_month,
    count(*) AS total_pos,
    sum(ob.total_amount) AS total_spend,
    sum(ob.total_amount) FILTER (WHERE ob.status = ANY (ARRAY['draft', 'pending_approval', 'approved', 'sent'])) AS open_balance,
    avg((EXTRACT(epoch FROM (ob.approved_ts - ob.order_date::timestamp with time zone)) / 86400.0)) AS avg_approval_days,
    avg((EXTRACT(epoch FROM (ob.sent_ts - ob.approved_ts)) / 86400.0)) AS avg_issue_days,
    avg((EXTRACT(epoch FROM (ob.received_ts - ob.sent_ts)) / 86400.0)) AS avg_receipt_days,
    sum(CASE WHEN ob.expected_delivery_date IS NOT NULL AND ob.received_ts IS NOT NULL AND ob.received_ts <= ob.expected_delivery_date THEN 1 ELSE 0 END) AS on_time_receipts,
    sum(CASE WHEN ob.received_ts IS NOT NULL THEN 1 ELSE 0 END) AS total_receipts,
    sum(COALESCE(item_quantities.quantity_received, 0::bigint)) AS quantity_received,
    sum(COALESCE(item_quantities.quantity_ordered, 0::bigint)) AS quantity_ordered,
    sum(invoice_stats.total_matches) AS invoice_match_count,
    sum(invoice_stats.exception_matches) AS invoice_exception_count,
    sum(invoice_stats.variance_matches) AS variance_match_count,
    avg(invoice_stats.avg_invoice_throughput_days) AS avg_invoice_throughput_days
   FROM order_base ob
     LEFT JOIN item_quantities ON item_quantities.purchase_order_id = ob.id
     LEFT JOIN invoice_stats ON invoice_stats.purchase_order_id = ob.id
  GROUP BY ob.supplier_id, ob.supplier_name, (date_trunc('month', ob.order_date::timestamp with time zone))::date;

-- Drop and recreate view_pending_manual_inventory_deductions with security_invoker
DROP VIEW IF EXISTS public.view_pending_manual_inventory_deductions;

CREATE VIEW public.view_pending_manual_inventory_deductions
WITH (security_invoker = true)
AS
SELECT sti.inventory_item_id,
    ii.item_name,
    sum(sti.quantity) AS total_quantity,
    max(st.ordered_at) AS last_transaction_at,
    (max(st.sync_run_id::text))::uuid AS last_sync_run_id
   FROM public.sales_transaction_items sti
     JOIN public.sales_transactions st ON st.id = sti.transaction_id
     LEFT JOIN public.inventory_items ii ON ii.id = sti.inventory_item_id
  WHERE sti.impact_type = 'manual'
  GROUP BY sti.inventory_item_id, ii.item_name;

-- Grant appropriate permissions
GRANT SELECT ON public.po_supplier_metrics_v TO authenticated;
GRANT SELECT ON public.view_pending_manual_inventory_deductions TO authenticated;
