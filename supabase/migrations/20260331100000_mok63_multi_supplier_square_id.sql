-- MOK-63: Allow multiple suppliers for same Square item ID
--
-- Problem: The unique index on (tenant_id, square_item_id, pack_size) prevents two different
-- suppliers from supplying the same product (same Square item ID + pack size). This is a valid
-- real-world scenario — e.g. both Sysco and US Foods can supply the same SKU.
--
-- Fix: Expand uniqueness to (tenant_id, supplier_id, square_item_id, pack_size) so that each
-- supplier/product combination is unique, but multiple suppliers can map to the same Square item.
--
-- Pre-flight conflict check: We verify no duplicate (tenant_id, supplier_id, square_item_id, pack_size)
-- rows exist before dropping the old index (they shouldn't given the old constraint, but be safe).

BEGIN;

-- Step 1: Verify no data conflicts exist under the new composite key.
-- If this raises an exception, the migration will be rolled back safely.
DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM (
    SELECT tenant_id, supplier_id, square_item_id, pack_size
    FROM public.inventory_items
    WHERE square_item_id IS NOT NULL
    GROUP BY tenant_id, supplier_id, square_item_id, pack_size
    HAVING COUNT(*) > 1
  ) conflicts;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION
      'MOK-63 migration aborted: % row(s) would violate the new (tenant_id, supplier_id, square_item_id, pack_size) unique constraint. Resolve conflicts before running this migration.',
      conflict_count;
  END IF;
END;
$$;

-- Step 2: Drop the old unique index that blocked multi-supplier linking.
DROP INDEX IF EXISTS public.inventory_items_tenant_square_pack_unique;

-- Step 3: Create the new index scoped per-supplier.
-- A supplier cannot link the same Square item + pack size twice, but
-- multiple suppliers can each independently link to the same Square item.
CREATE UNIQUE INDEX inventory_items_tenant_supplier_square_pack_unique
  ON public.inventory_items (tenant_id, supplier_id, square_item_id, pack_size)
  WHERE square_item_id IS NOT NULL;

COMMIT;
