-- Replace single-column KDS UNIQUE constraints with composite (tenant_id, field) constraints
-- so two tenants can store KDS data with the same keys/filenames/variation IDs without conflict.
-- Addresses GAP-2 (KDS domain) from the v1.0 milestone audit.

BEGIN;

-- kds_settings: inline UNIQUE on key column -> composite (tenant_id, key)
ALTER TABLE public.kds_settings DROP CONSTRAINT kds_settings_key_key;
ALTER TABLE public.kds_settings
  ADD CONSTRAINT kds_settings_tenant_key_unique UNIQUE (tenant_id, key);

-- kds_images: named UNIQUE on filename column -> composite (tenant_id, filename)
ALTER TABLE public.kds_images DROP CONSTRAINT kds_images_filename_unique;
ALTER TABLE public.kds_images
  ADD CONSTRAINT kds_images_tenant_filename_unique UNIQUE (tenant_id, filename);

-- kds_menu_items: partial index on square_variation_id -> partial index on (tenant_id, square_variation_id)
DROP INDEX IF EXISTS idx_kds_menu_items_square_variation_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kds_menu_items_tenant_variation_unique
  ON public.kds_menu_items (tenant_id, square_variation_id)
  WHERE square_variation_id IS NOT NULL;

COMMIT;
