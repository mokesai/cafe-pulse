-- KDS Display Types Migration
-- Adds support for multiple display types: featured, price-grid, simple-list, single-price, flavor-options

-- Add display type fields to categories
ALTER TABLE public.kds_categories
  ADD COLUMN IF NOT EXISTS display_type text,
  ADD COLUMN IF NOT EXISTS show_size_header boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS header_text text,
  ADD COLUMN IF NOT EXISTS size_labels text;

-- Add display type fields to menu items
ALTER TABLE public.kds_menu_items
  ADD COLUMN IF NOT EXISTS display_type text,
  ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bullet_color text,
  ADD COLUMN IF NOT EXISTS parent_item text;

-- Add new settings for screen headers
INSERT INTO public.kds_settings (key, value) VALUES
  ('food_header', '"LOTUS ENERGY DRINKS"'),
  ('drinks_show_starbucks_logo', 'true')
ON CONFLICT (key) DO NOTHING;

-- Add comments for documentation
COMMENT ON COLUMN public.kds_categories.display_type IS 'Display style: featured, price-grid, simple-list, single-price, flavor-options';
COMMENT ON COLUMN public.kds_categories.show_size_header IS 'Whether to show size column headers (Tall/Grande/Venti)';
COMMENT ON COLUMN public.kds_categories.header_text IS 'Custom header text for single-price categories';
COMMENT ON COLUMN public.kds_categories.size_labels IS 'Pipe-separated size labels (e.g., "Tall|Grande|Venti")';

COMMENT ON COLUMN public.kds_menu_items.display_type IS 'Override display type for individual items';
COMMENT ON COLUMN public.kds_menu_items.featured IS 'Whether this item appears in featured section';
COMMENT ON COLUMN public.kds_menu_items.bullet_color IS 'Bullet color for featured/flavor items: green, yellow, orange, brown, pink, blue, red, teal';
COMMENT ON COLUMN public.kds_menu_items.parent_item IS 'Parent item name for flavor grouping';
