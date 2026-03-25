BEGIN;

-- ============================================================
-- ai_recipe_estimates
-- AI-generated recipe estimates per Square catalog product.
-- NOT written to cogs_product_recipes until admin approves.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_recipe_estimates (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Square catalog product this estimate is for
  square_product_id     TEXT NOT NULL,
  product_name          TEXT NOT NULL,

  -- The AI-estimated ingredients (mirrors cogs_product_ingredients schema)
  estimated_ingredients JSONB NOT NULL DEFAULT '[]',
  -- Array of: { inventory_item_id: uuid, item_name: text, quantity: numeric, unit: text }

  -- Confidence and model metadata
  ai_model              TEXT NOT NULL DEFAULT 'gpt-4o',
  ai_confidence         NUMERIC(4,3) CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  ai_reasoning          TEXT,         -- model's brief explanation

  -- Review status
  review_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (review_status IN ('pending', 'approved', 'rejected', 'edited')),
  reviewed_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,

  -- If approved+edited, what was the final recipe (may differ from AI estimate)
  approved_ingredients  JSONB,

  -- Link to promoted recipe (set when approved and written to cogs_product_recipes)
  promoted_recipe_id    UUID REFERENCES public.cogs_product_recipes(id) ON DELETE SET NULL,

  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ai_recipe_estimates_unique_product
    UNIQUE (tenant_id, square_product_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_recipe_estimates_tenant
  ON public.ai_recipe_estimates (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_recipe_estimates_status
  ON public.ai_recipe_estimates (tenant_id, review_status);

DO $$ BEGIN
  CREATE TRIGGER handle_updated_at_ai_recipe_estimates
    BEFORE UPDATE ON public.ai_recipe_estimates
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.ai_recipe_estimates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_staff_select_ai_recipe_estimates"
    ON public.ai_recipe_estimates FOR SELECT
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin', 'staff']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_insert_ai_recipe_estimates"
    ON public.ai_recipe_estimates FOR INSERT
    WITH CHECK (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_update_ai_recipe_estimates"
    ON public.ai_recipe_estimates FOR UPDATE
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_delete_ai_recipe_estimates"
    ON public.ai_recipe_estimates FOR DELETE
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- ai_cogs_daily_summaries
-- Pre-computed daily COGS summaries per tenant.
-- Replaces on-demand report computation.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_cogs_daily_summaries (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- The calendar date this summary covers (midnight–midnight UTC)
  summary_date              DATE NOT NULL,

  -- Periodic method: Beginning Inventory + Purchases − Ending Inventory
  beginning_inventory_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchases_value           NUMERIC(12,2) NOT NULL DEFAULT 0,
  ending_inventory_value    NUMERIC(12,2) NOT NULL DEFAULT 0,
  periodic_cogs             NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Theoretical method: sales × recipes × costs (null if no recipes available)
  theoretical_cogs          NUMERIC(12,2),
  recipe_coverage_pct       NUMERIC(5,2),  -- % of sold items with recipes

  -- Variance between periodic and theoretical
  cogs_variance             NUMERIC(12,2),

  -- Source invoices that contributed to purchases_value on this date
  contributing_invoice_ids  UUID[] DEFAULT '{}',

  -- Computation metadata
  computed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  computation_method        TEXT NOT NULL DEFAULT 'periodic'
                              CHECK (computation_method IN ('periodic', 'hybrid')),

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ai_cogs_daily_unique_date
    UNIQUE (tenant_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_ai_cogs_daily_tenant_date
  ON public.ai_cogs_daily_summaries (tenant_id, summary_date DESC);

DO $$ BEGIN
  CREATE TRIGGER handle_updated_at_ai_cogs_daily_summaries
    BEFORE UPDATE ON public.ai_cogs_daily_summaries
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.ai_cogs_daily_summaries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_staff_select_ai_cogs_daily"
    ON public.ai_cogs_daily_summaries FOR SELECT
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin', 'staff']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_insert_ai_cogs_daily"
    ON public.ai_cogs_daily_summaries FOR INSERT
    WITH CHECK (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_update_ai_cogs_daily"
    ON public.ai_cogs_daily_summaries FOR UPDATE
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_delete_ai_cogs_daily"
    ON public.ai_cogs_daily_summaries FOR DELETE
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
