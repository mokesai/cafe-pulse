-- Fix kds_categories: replace single-column UNIQUE(slug) with composite (tenant_id, slug)
-- so multiple tenants can use the same category slugs (e.g., "hot-drinks", "pastries").
-- This was missed in 20260217000000_composite_kds_unique_constraints.sql which
-- handled kds_settings, kds_images, and kds_menu_items but not kds_categories.

BEGIN;

ALTER TABLE public.kds_categories DROP CONSTRAINT kds_categories_slug_key;

ALTER TABLE public.kds_categories
  ADD CONSTRAINT kds_categories_tenant_slug_unique UNIQUE (tenant_id, slug);

COMMIT;
