BEGIN;

-- ============================================================
-- Add invoice pipeline tenant-configurable settings columns.
-- All columns use NOT NULL with sensible defaults so existing
-- tenants get correct behavior without manual migration.
-- ============================================================

ALTER TABLE public.tenants
  -- no_po_match exception behavior
  -- 'always_create'   = always create exception (require review)
  -- 'auto_dismiss'    = never create exception; skip PO stage silently
  -- 'notify_continue' = create exception but auto-resolve after 24h (stretch goal)
  ADD COLUMN IF NOT EXISTS invoice_no_po_match_behavior TEXT NOT NULL
    DEFAULT 'always_create'
    CHECK (invoice_no_po_match_behavior IN ('always_create', 'auto_dismiss', 'notify_continue')),

  -- Unit price variance threshold (percentage, integer 1–100)
  ADD COLUMN IF NOT EXISTS invoice_price_variance_threshold_pct INTEGER NOT NULL
    DEFAULT 10
    CHECK (invoice_price_variance_threshold_pct BETWEEN 1 AND 100),

  -- Invoice total vs PO total variance threshold (percentage, integer 1–100)
  ADD COLUMN IF NOT EXISTS invoice_total_variance_threshold_pct INTEGER NOT NULL
    DEFAULT 5
    CHECK (invoice_total_variance_threshold_pct BETWEEN 1 AND 100),

  -- Item match confidence auto-accept threshold (percentage, integer 50–100)
  ADD COLUMN IF NOT EXISTS invoice_match_confidence_threshold_pct INTEGER NOT NULL
    DEFAULT 85
    CHECK (invoice_match_confidence_threshold_pct BETWEEN 50 AND 100),

  -- Vision extraction confidence threshold below which low_extraction_confidence exception fires
  ADD COLUMN IF NOT EXISTS invoice_vision_confidence_threshold_pct INTEGER NOT NULL
    DEFAULT 60
    CHECK (invoice_vision_confidence_threshold_pct BETWEEN 10 AND 100);

COMMENT ON COLUMN public.tenants.invoice_no_po_match_behavior IS
  'Pipeline behavior when no matching purchase order is found for an invoice.';
COMMENT ON COLUMN public.tenants.invoice_price_variance_threshold_pct IS
  'Percent unit price change that triggers a price_variance exception. Default: 10%.';
COMMENT ON COLUMN public.tenants.invoice_total_variance_threshold_pct IS
  'Percent invoice total vs PO total difference that triggers a quantity_variance exception. Default: 5%.';
COMMENT ON COLUMN public.tenants.invoice_match_confidence_threshold_pct IS
  'Minimum item match confidence (0–100) for auto-acceptance without exception. Default: 85%.';
COMMENT ON COLUMN public.tenants.invoice_vision_confidence_threshold_pct IS
  'Minimum Vision extraction confidence (0–100) below which a low_extraction_confidence exception is created. Default: 60%.';

COMMIT;
