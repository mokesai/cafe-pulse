-- Migration: Add variation_name column to kds_menu_items
-- This enables grouping items by size (Tall, Grande, Venti) for columnar display

ALTER TABLE public.kds_menu_items
ADD COLUMN IF NOT EXISTS variation_name text;

-- Add a comment for documentation
COMMENT ON COLUMN public.kds_menu_items.variation_name IS 'Size variation name (e.g., Tall, Grande, Venti, Regular)';
