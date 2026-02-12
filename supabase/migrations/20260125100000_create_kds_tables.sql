-- Kitchen Display System (KDS) tables
-- Menu display system for TV screens showing drinks and food categories

BEGIN;

-- 1) KDS Categories (quadrants on each screen)
CREATE TABLE IF NOT EXISTS public.kds_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,                                    -- "Hot Drinks"
  slug text UNIQUE NOT NULL,                             -- "hot-drinks"
  screen text NOT NULL CHECK (screen IN ('drinks', 'food')),
  position text NOT NULL CHECK (position IN ('top-left', 'top-right', 'bottom-left', 'bottom-right')),
  sort_order integer NOT NULL DEFAULT 0,
  color text,                                            -- optional accent color
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT kds_categories_unique_position UNIQUE (screen, position)
);

CREATE INDEX IF NOT EXISTS idx_kds_categories_screen
  ON public.kds_categories (screen);

CREATE INDEX IF NOT EXISTS idx_kds_categories_sort
  ON public.kds_categories (screen, sort_order);

-- 2) KDS Menu Items
CREATE TABLE IF NOT EXISTS public.kds_menu_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  square_item_id text,                                   -- link to Square catalog
  square_variation_id text,
  name text NOT NULL,                                    -- "Caramel Macchiato"
  display_name text,                                     -- optional shorter name for display
  price_cents integer NOT NULL CHECK (price_cents >= 0), -- 595 = $5.95
  display_price text,                                    -- "$5.95" formatted
  category_id uuid REFERENCES public.kds_categories(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_kds_menu_items_category
  ON public.kds_menu_items (category_id);

CREATE INDEX IF NOT EXISTS idx_kds_menu_items_visible
  ON public.kds_menu_items (category_id, is_visible, sort_order);

CREATE INDEX IF NOT EXISTS idx_kds_menu_items_square
  ON public.kds_menu_items (square_item_id);

-- 3) KDS Settings (key-value configuration)
CREATE TABLE IF NOT EXISTS public.kds_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Insert default settings
INSERT INTO public.kds_settings (key, value) VALUES
  ('image_rotation_interval', '6000'::jsonb),
  ('refresh_interval', '300000'::jsonb),
  ('drinks_tagline', '"Freshly Brewed Every Day"'::jsonb),
  ('food_tagline', '"Baked Fresh Daily"'::jsonb),
  ('header_hours', '"8AM-6PM Mon-Fri"'::jsonb),
  ('header_location', '"Kaiser Permanente \u00b7 Denver"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4) KDS Footer Images
CREATE TABLE IF NOT EXISTS public.kds_images (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  screen text NOT NULL CHECK (screen IN ('drinks', 'food')),
  filename text NOT NULL,                                -- "espresso-pour.jpg"
  alt_text text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_kds_images_screen
  ON public.kds_images (screen, is_active, sort_order);

-- 5) Row Level Security
ALTER TABLE public.kds_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kds_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kds_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kds_images ENABLE ROW LEVEL SECURITY;

-- Service role has full access for import scripts
CREATE POLICY "Service role manages kds_categories"
  ON public.kds_categories
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role manages kds_menu_items"
  ON public.kds_menu_items
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role manages kds_settings"
  ON public.kds_settings
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role manages kds_images"
  ON public.kds_images
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Public read access for display pages (no auth required for TV screens)
CREATE POLICY "Anyone can read kds_categories"
  ON public.kds_categories
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can read kds_menu_items"
  ON public.kds_menu_items
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can read kds_settings"
  ON public.kds_settings
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can read kds_images"
  ON public.kds_images
  FOR SELECT
  USING (true);

-- 6) Updated_at triggers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'handle_updated_at_kds_categories'
  ) THEN
    CREATE TRIGGER handle_updated_at_kds_categories
      BEFORE UPDATE ON public.kds_categories
      FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'handle_updated_at_kds_menu_items'
  ) THEN
    CREATE TRIGGER handle_updated_at_kds_menu_items
      BEFORE UPDATE ON public.kds_menu_items
      FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'handle_updated_at_kds_settings'
  ) THEN
    CREATE TRIGGER handle_updated_at_kds_settings
      BEFORE UPDATE ON public.kds_settings
      FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
  END IF;
END $$;

-- 7) Comments
COMMENT ON TABLE public.kds_categories IS 'Display categories for KDS TV screens (4 quadrants per screen)';
COMMENT ON TABLE public.kds_menu_items IS 'Menu items displayed on KDS screens with prices';
COMMENT ON TABLE public.kds_settings IS 'Key-value configuration for KDS display (intervals, taglines)';
COMMENT ON TABLE public.kds_images IS 'Rotating footer images for KDS screens';

COMMIT;
