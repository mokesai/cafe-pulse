-- KDS Warm Theme Schema Updates
-- Adds icon support for categories and removes rigid quadrant positioning

BEGIN;

-- 1) Add icon field to kds_categories
ALTER TABLE public.kds_categories
  ADD COLUMN IF NOT EXISTS icon text;

COMMENT ON COLUMN public.kds_categories.icon IS 'Icon name for category header (e.g., coffee, tea, croissant)';

-- 2) Remove the strict position constraint to allow flexible layouts
-- First drop the unique constraint
ALTER TABLE public.kds_categories
  DROP CONSTRAINT IF EXISTS kds_categories_unique_position;

-- Drop the check constraint on position (need to find its name first)
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.kds_categories'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%position%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.kds_categories DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Make position nullable (we'll use sort_order for ordering instead)
ALTER TABLE public.kds_categories
  ALTER COLUMN position DROP NOT NULL;

-- 3) Add new settings for warm theme
INSERT INTO public.kds_settings (key, value) VALUES
  ('drinks_subtitle', '"We proudly serve Starbucks coffee"'::jsonb),
  ('food_subtitle', '"FOOD & SPECIALTY DRINKS"'::jsonb),
  ('theme', '"warm"'::jsonb),
  ('cafe_name', '"Little Café"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4) Update table comment
COMMENT ON TABLE public.kds_categories IS 'Display categories for KDS TV screens with flexible ordering';

COMMIT;
