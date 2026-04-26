-- MOK-122: shadow history table for invoice variances.
--
-- Every variance encountered by stage 4 (quantity, price, replacement)
-- writes a row here, regardless of whether it also produced an
-- invoice_exceptions row. Acknowledging or dismissing an exception does
-- NOT delete the history row — supplier-performance reporting reads from
-- this table, so the signal must persist.
--
-- Schema-wise this is wider than a single variance type would need;
-- combining quantity/price/replacement into one table simplifies queries
-- ("show me everything supplier X did wrong this month") at the cost of
-- many nullable columns per row. Acceptable tradeoff given expected
-- query patterns.

CREATE TABLE IF NOT EXISTS public.invoice_variance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,

  -- Variance classification — mirrors invoice_exceptions.exception_type for
  -- the variance subset, plus 'replacement' for item substitutions (MOK-124).
  variance_type text NOT NULL,
  CONSTRAINT invoice_variance_history_type_check
    CHECK (variance_type IN ('quantity_variance', 'price_variance', 'replacement')),

  -- Severity at the time of capture (matches invoice_exceptions.severity).
  -- 'replacement' rows always carry severity='info'.
  severity text NOT NULL DEFAULT 'info',
  CONSTRAINT invoice_variance_history_severity_check
    CHECK (severity IN ('info', 'block')),

  -- Quantity-variance fields (nullable for non-quantity rows).
  po_quantity numeric,
  invoice_quantity numeric,

  -- Price-variance fields (nullable for non-price rows).
  po_unit_cost numeric,
  invoice_unit_price numeric,

  -- Replacement-variance fields (nullable for non-replacement rows).
  po_description text,
  invoice_description text,

  -- Common variance metrics.
  variance_pct numeric,
  threshold_pct numeric,

  -- Link to the invoice_exceptions row (if one was created) so the UI can
  -- show "this exception is the latest of N occurrences".
  related_exception_id uuid REFERENCES public.invoice_exceptions(id) ON DELETE SET NULL,

  -- Acknowledgment metadata (populated by MOK-123). Leaving them on the
  -- history row rather than the exception row means the audit signal
  -- persists even if the exception is deleted.
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledgment_notes text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Supplier-performance queries: "everything supplier X did over period Y".
CREATE INDEX IF NOT EXISTS invoice_variance_history_supplier_created_idx
  ON public.invoice_variance_history (tenant_id, supplier_id, created_at DESC);

-- Per-invoice drill-down.
CREATE INDEX IF NOT EXISTS invoice_variance_history_invoice_idx
  ON public.invoice_variance_history (tenant_id, invoice_id);

-- For "show me all unacknowledged info-severity variances" filters.
CREATE INDEX IF NOT EXISTS invoice_variance_history_unacknowledged_idx
  ON public.invoice_variance_history (tenant_id, acknowledged_at)
  WHERE acknowledged_at IS NULL;

COMMENT ON TABLE public.invoice_variance_history IS
  'MOK-122: permanent record of every variance encountered by the invoice pipeline. Survives exception dismissal. Reads drive supplier-performance reporting.';
COMMENT ON COLUMN public.invoice_variance_history.related_exception_id IS
  'Set when stage 4 also created an invoice_exceptions row for this variance. NULL for sub-threshold info-only history-only rows that don''t need an exception.';

-- RLS: service-role-only access. The pipeline writes from the edge function
-- via service role; reads happen via API routes that explicitly scope by
-- tenant_id. No tenant-side direct reads are expected.
ALTER TABLE public.invoice_variance_history ENABLE ROW LEVEL SECURITY;
