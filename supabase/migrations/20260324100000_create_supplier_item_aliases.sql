BEGIN;

-- ============================================================
-- supplier_item_aliases
-- Stores learned mappings from supplier invoice descriptions
-- to internal inventory items. Written by the pipeline on
-- high-confidence matches; written by admin on manual matches.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.supplier_item_aliases (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL
                        REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_id         UUID NOT NULL
                        REFERENCES public.suppliers(id) ON DELETE CASCADE,

  -- The exact text string as it appeared on the invoice
  supplier_description TEXT NOT NULL,

  -- Resolved internal inventory item
  inventory_item_id   UUID NOT NULL
                        REFERENCES public.inventory_items(id) ON DELETE CASCADE,

  -- Confidence of this alias (0.0–1.0).
  -- Rolling max: updated when pipeline re-confirms the same alias.
  confidence          NUMERIC(4,3) NOT NULL DEFAULT 0.0
                        CHECK (confidence >= 0.0 AND confidence <= 1.0),

  -- 'auto'   = pipeline wrote this alias from a high-confidence match
  -- 'manual' = admin confirmed this via exception queue resolution
  source              TEXT NOT NULL DEFAULT 'auto'
                        CHECK (source IN ('auto', 'manual')),

  -- How many times this alias has been successfully used
  use_count           INTEGER NOT NULL DEFAULT 0,

  -- Last invoice on which this alias was applied (for debugging)
  last_seen_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  last_seen_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One alias per (tenant, supplier, description) triple.
  -- If description appears on same supplier, same mapping expected.
  CONSTRAINT supplier_item_aliases_unique_description
    UNIQUE (tenant_id, supplier_id, supplier_description)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_supplier_item_aliases_tenant
  ON public.supplier_item_aliases (tenant_id);

CREATE INDEX IF NOT EXISTS idx_supplier_item_aliases_supplier
  ON public.supplier_item_aliases (tenant_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_item_aliases_inventory_item
  ON public.supplier_item_aliases (inventory_item_id);

-- updated_at trigger (reuse existing handle_updated_at pattern)
DO $$ BEGIN
  CREATE TRIGGER handle_updated_at_supplier_item_aliases
    BEFORE UPDATE ON public.supplier_item_aliases
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS
ALTER TABLE public.supplier_item_aliases ENABLE ROW LEVEL SECURITY;

-- Tenant staff can read aliases (needed for item-matching agent)
DO $$ BEGIN
  CREATE POLICY "tenant_staff_select_supplier_item_aliases"
    ON public.supplier_item_aliases FOR SELECT
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin', 'staff']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only admins/owners can insert/update/delete aliases
DO $$ BEGIN
  CREATE POLICY "tenant_admin_insert_supplier_item_aliases"
    ON public.supplier_item_aliases FOR INSERT
    WITH CHECK (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_update_supplier_item_aliases"
    ON public.supplier_item_aliases FOR UPDATE
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_delete_supplier_item_aliases"
    ON public.supplier_item_aliases FOR DELETE
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.supplier_item_aliases IS
  'Learned mappings from supplier invoice line item descriptions to internal inventory items. '
  'Written automatically by the invoice pipeline (source=auto) or manually by admins (source=manual). '
  'Checked before fuzzy matching on each new invoice.';

COMMIT;
