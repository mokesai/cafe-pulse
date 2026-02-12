-- Add unique constraints for KDS upsert operations

BEGIN;

-- Add unique constraint on kds_images.filename for upsert
ALTER TABLE public.kds_images
  ADD CONSTRAINT kds_images_filename_unique UNIQUE (filename);

-- Add unique constraint on kds_menu_items.square_variation_id for upsert
-- (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_kds_menu_items_square_variation_id_unique
  ON public.kds_menu_items (square_variation_id)
  WHERE square_variation_id IS NOT NULL;

COMMIT;
