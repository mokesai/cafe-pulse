BEGIN;

-- ============================================================
-- invoice_exceptions
-- Tracks line items or full invoices that require human review.
-- Created mid-pipeline when the orchestrator cannot proceed
-- automatically. Resolved via the exception queue UI.
-- ============================================================

-- Exception type enum (idempotent)
DO $$ BEGIN
  CREATE TYPE public.invoice_exception_type AS ENUM (
    'low_extraction_confidence',  -- overall Vision extraction confidence < threshold
    'no_supplier_match',          -- extracted supplier text not found/creatable
    'no_po_match',                -- no purchase order matches this invoice
    'no_item_match',              -- line item cannot be matched to inventory item
    'price_variance',             -- unit price change exceeds threshold
    'quantity_variance',          -- quantity vs PO exceeds threshold
    'parse_error',                -- pipeline failure (API error, malformed response)
    'duplicate_invoice'           -- invoice_number already confirmed for this supplier
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Exception status enum (idempotent)
DO $$ BEGIN
  CREATE TYPE public.invoice_exception_status AS ENUM (
    'open',       -- awaiting human review
    'resolved',   -- human resolved; may have triggered downstream pipeline action
    'dismissed'   -- human dismissed; no pipeline action taken
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.invoice_exceptions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL
                        REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- The invoice this exception belongs to (always set)
  invoice_id          UUID NOT NULL
                        REFERENCES public.invoices(id) ON DELETE CASCADE,

  -- The specific line item, if this is an item-level exception (nullable for invoice-level)
  invoice_item_id     UUID REFERENCES public.invoice_items(id) ON DELETE CASCADE,

  -- Exception classification
  exception_type      public.invoice_exception_type NOT NULL,

  -- Human-readable message explaining what happened and what to do
  exception_message   TEXT NOT NULL,

  -- Structured context for the UI to render type-specific resolution forms.
  -- Schema varies by exception_type (see architecture-invoice-cogs.md §1.3.1).
  exception_context   JSONB NOT NULL DEFAULT '{}',

  -- Current status
  status              public.invoice_exception_status NOT NULL DEFAULT 'open',

  -- Resolution fields (populated when status transitions from open)
  resolution_notes    TEXT,
  resolved_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,

  -- Pipeline stage when this exception was created (for audit/debug)
  pipeline_stage_at_creation TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoice_exceptions_tenant_status
  ON public.invoice_exceptions (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_invoice_exceptions_invoice_id
  ON public.invoice_exceptions (invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_exceptions_tenant_type
  ON public.invoice_exceptions (tenant_id, exception_type);

CREATE INDEX IF NOT EXISTS idx_invoice_exceptions_created_at
  ON public.invoice_exceptions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_exceptions_open_count
  ON public.invoice_exceptions (tenant_id, invoice_id)
  WHERE status = 'open';

-- updated_at trigger
DO $$ BEGIN
  CREATE TRIGGER handle_updated_at_invoice_exceptions
    BEFORE UPDATE ON public.invoice_exceptions
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS
ALTER TABLE public.invoice_exceptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tenant_staff_select_invoice_exceptions"
    ON public.invoice_exceptions FOR SELECT
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin', 'staff']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_insert_invoice_exceptions"
    ON public.invoice_exceptions FOR INSERT
    WITH CHECK (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tenant_admin_update_invoice_exceptions"
    ON public.invoice_exceptions FOR UPDATE
    USING (
      tenant_id = (SELECT current_setting('app.tenant_id', true))::uuid
      AND (SELECT public.is_tenant_member(ARRAY['owner', 'admin']))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.invoice_exceptions IS
  'Invoice pipeline exceptions requiring human review. Created by the orchestrator when '
  'a stage cannot proceed automatically. Resolved or dismissed via the exception queue UI.';

COMMENT ON COLUMN public.invoice_exceptions.exception_context IS
  'Structured context for type-specific UI rendering. Schema: see architecture-invoice-cogs.md §1.3.1';

COMMIT;
