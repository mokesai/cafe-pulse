-- MOK-139: widen inventory_items.unit_cost from NUMERIC(10,2) to NUMERIC(12,4).
--
-- Rationale: per-pack invoices write back the per-individual equivalent
-- (invoice_unit_price ÷ pack_size). For a 4-pack at $6.19, the per-unit
-- value is $1.5475 — but NUMERIC(10,2) rounds to $1.55 on store. The
-- 0.4¢ rounding error is small per-line but accumulates when COGS
-- multiplies through the stock count: 1000 units × $0.0025 = $2.50 of
-- phantom cost, 10000 units = $25.
--
-- Cost-history (`inventory_item_cost_history.new_unit_cost`) is already
-- unconstrained `numeric` and preserves precise values, so the audit
-- trail is unaffected. Only the live inventory cost rounded.
--
-- Migration is non-destructive: existing 2dp values widen losslessly into
-- the new (12,4) type. No data migration needed.

ALTER TABLE public.inventory_items
  ALTER COLUMN unit_cost TYPE numeric(12, 4);

COMMENT ON COLUMN public.inventory_items.unit_cost IS
  'Per-individual-unit cost. NUMERIC(12,4) so per-pack invoice writes (invoice_unit_price ÷ pack_size) preserve 4 decimal places of precision. Display layer should still default to 2dp.';
