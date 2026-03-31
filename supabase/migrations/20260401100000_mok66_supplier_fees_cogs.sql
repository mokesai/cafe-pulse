-- MOK-66: Account for supplier invoice fees in COGS
--
-- Problem: Invoice processing skips supplier fees (delivery, shipping, processing fees).
-- COGS calculations undercount as a result.
--
-- Solution:
--   1. Add `supplier_fees` JSONB column to `invoices` — stores fee breakdown
--      e.g. {"delivery": 12.50, "shipping": 0, "processing": 3.00, "other": 0}
--   2. Add `total_fees` NUMERIC column for quick summing without JSONB parsing
--   3. Add `fee_source` TEXT to track where fees came from (ai_extracted | manual | none)
--   4. Add `fee_cogs_distributed` BOOLEAN to track whether fees have been spread to cost history
--
-- On invoice confirm, fees are distributed proportionally across matched invoice items
-- by line-item value and recorded as separate `invoice_fee` entries in
-- `inventory_item_cost_history`. This keeps fee tracking in the existing cost-history
-- system (which already handles time-series cost changes).
--
-- Migration is safe for existing data: all new columns default to safe zero values.

BEGIN;

-- ── invoices table additions ─────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS supplier_fees     JSONB         NOT NULL DEFAULT '{"delivery": 0, "shipping": 0, "processing": 0, "other": 0}',
  ADD COLUMN IF NOT EXISTS total_fees        NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_source        TEXT          NOT NULL DEFAULT 'none'
    CHECK (fee_source IN ('ai_extracted', 'manual', 'none')),
  ADD COLUMN IF NOT EXISTS fee_cogs_distributed BOOLEAN   NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.invoices.supplier_fees IS
  'Breakdown of supplier fees from this invoice. Keys: delivery, shipping, processing, other. Values are currency amounts.';
COMMENT ON COLUMN public.invoices.total_fees IS
  'Sum of all supplier_fees values. Computed on write for fast querying.';
COMMENT ON COLUMN public.invoices.fee_source IS
  'How fees were captured: ai_extracted (AI parsed them), manual (admin entered), none (no fees).';
COMMENT ON COLUMN public.invoices.fee_cogs_distributed IS
  'True once fees have been proportionally distributed to inventory_item_cost_history on invoice confirm.';

-- Index to find invoices with un-distributed fees (useful for backfill if needed)
CREATE INDEX IF NOT EXISTS idx_invoices_fee_not_distributed
  ON public.invoices (tenant_id, fee_cogs_distributed)
  WHERE fee_cogs_distributed = FALSE AND total_fees > 0;

-- ── inventory_item_cost_history: add fee_amount column ───────────────────────
-- When a fee entry is recorded, new_unit_cost reflects the fee overhead per unit.
-- The `source` column already exists and is used (value: 'invoice_fee').
-- We add fee_amount to store the raw fee amount allocated to this item
-- (useful for auditing/reversals without re-deriving it from the cost delta).

ALTER TABLE public.inventory_item_cost_history
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(10,4);

COMMENT ON COLUMN public.inventory_item_cost_history.fee_amount IS
  'For source=invoice_fee rows: the raw fee amount allocated to this inventory item from the invoice.';

COMMIT;
