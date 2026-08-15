-- B1 / MOK-173: per-tenant target COGS % drives the dashboard's good/bad signal.
-- COGS% (weekly COGS ÷ weekly sales) at or below this target = "good".

BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS target_cogs_percentage_pct integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.tenants.target_cogs_percentage_pct IS
  'MOK-173: target food-cost (COGS) as a percentage of sales. Drives the dashboard good/bad signal (COGS% at or below target = good). Default 30.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_target_cogs_pct_range') THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_target_cogs_pct_range
      CHECK (target_cogs_percentage_pct BETWEEN 1 AND 100);
  END IF;
END $$;

COMMIT;
