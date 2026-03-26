BEGIN;

-- ============================================================
-- Add 'alias' to the match_method allowed values on invoice_items.
-- 
-- The invoice pipeline stage 04-match-items.ts uses 'alias' when a
-- supplier_item_aliases cache hit is used for matching, but the original
-- migration only documented 'exact', 'fuzzy', 'manual', 'sku', 'ai'.
-- ============================================================

-- The original invoice_items.match_method column uses VARCHAR(50) with no
-- CHECK constraint, so 'alias' already works at the DB level.
-- This migration adds a CHECK constraint to make the allowed values explicit
-- and consistent with the architecture spec.

-- First drop any existing unnamed check constraints on match_method
-- (there are none in the original migration, but defensive cleanup)
DO $$
BEGIN
  -- Add a named CHECK constraint for match_method
  -- Only add if not already present
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_items_match_method_check'
      AND conrelid = 'public.invoice_items'::regclass
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_match_method_check
        CHECK (match_method IS NULL OR match_method IN (
          'exact',
          'fuzzy',
          'manual',
          'sku',
          'ai',
          'alias'
        ));
  END IF;
END;
$$;

COMMENT ON COLUMN public.invoice_items.match_method IS
  'How this item was matched to an inventory item: exact | fuzzy | manual | sku | ai | alias. '
  '''alias'' = matched via supplier_item_aliases cache (fastest path). '
  '''manual'' = admin-confirmed match via exception queue.';

COMMIT;
