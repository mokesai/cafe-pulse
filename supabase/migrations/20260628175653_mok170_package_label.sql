-- A2 / MOK-170: allow one square_item_id to map to multiple packaged products per supplier.
--
-- Problem: the unique index inventory_items_tenant_supplier_square_pack_unique on
-- (tenant_id, supplier_id, square_item_id, pack_size) means a single supplier can have at
-- most ONE inventory row per (square_item_id, pack_size). That blocks a real case: ordering
-- the same Square item (e.g. Coke Zero 12oz) from one supplier as two distinct products that
-- share a pack size — e.g. a standalone case and the same drink derived from a variety pack.
-- MOK-63 already allowed multiple *suppliers* per square_item_id; this is the same-supplier gap.
--
-- Fix: add a free-form package_label discriminator and widen uniqueness to include it.
-- NULL package_label = the default/unlabeled packaging. The index keys NULL as '' via COALESCE
-- so two unlabeled rows for the same (supplier, square_item_id, pack_size) still collide — i.e.
-- it is exactly as strict as the old index for existing rows, and a non-null label is required
-- to add a second packaging. supplier_id NULL semantics are unchanged (COALESCE normalizes only
-- package_label, so supplier_id keeps its default NULLS DISTINCT behavior).

BEGIN;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS package_label text;

COMMENT ON COLUMN public.inventory_items.package_label IS
  'MOK-170: free-form discriminator distinguishing multiple supplier products that share the same square_item_id and pack_size (e.g. a standalone case vs a variety-pack-derived row). NULL = the default/unlabeled packaging.';

-- Pre-flight: the new index keys NULL labels as '' (COALESCE), so for existing all-NULL-label
-- rows it is identical to the old index. This guard should never fire; it protects against drift.
DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM (
    SELECT 1
    FROM public.inventory_items
    WHERE square_item_id IS NOT NULL
    GROUP BY tenant_id, supplier_id, square_item_id, pack_size, COALESCE(package_label, '')
    HAVING COUNT(*) > 1
  ) conflicts;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION
      'MOK-170 migration aborted: % row group(s) would violate the new (tenant_id, supplier_id, square_item_id, pack_size, package_label) unique constraint. Resolve duplicates before running.',
      conflict_count;
  END IF;
END;
$$;

-- Replace the per-supplier index with one that includes the package_label discriminator.
DROP INDEX IF EXISTS public.inventory_items_tenant_supplier_square_pack_unique;

CREATE UNIQUE INDEX inventory_items_tenant_supplier_square_pack_label_unique
  ON public.inventory_items
     (tenant_id, supplier_id, square_item_id, pack_size, COALESCE(package_label, ''))
  WHERE square_item_id IS NOT NULL;

COMMIT;
