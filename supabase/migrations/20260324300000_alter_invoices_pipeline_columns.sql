BEGIN;

-- ============================================================
-- Add pipeline tracking columns to the invoices table.
-- Also extends the status CHECK constraint to include new
-- pipeline-stage values.
-- ============================================================

-- Drop any existing status CHECK constraints on invoices table
-- (handles varying constraint names across environments)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.invoices'::regclass
             AND conname LIKE '%status%'
  LOOP
    EXECUTE 'ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END;
$$;

-- Add new pipeline columns (idempotent)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pipeline_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pipeline_error TEXT,
  ADD COLUMN IF NOT EXISTS vision_confidence NUMERIC(4,3)
    CHECK (vision_confidence IS NULL OR (vision_confidence >= 0.0 AND vision_confidence <= 1.0)),
  ADD COLUMN IF NOT EXISTS open_exception_count INTEGER NOT NULL DEFAULT 0;

-- Re-add the CHECK constraint with expanded status values.
-- New values: 'pipeline_running', 'pending_exceptions', 'duplicate'
-- Existing values preserved.
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
    CHECK (status IN (
      'uploaded',
      'parsing',            -- legacy: manual parse in progress
      'parsed',             -- legacy: manual parse done
      'reviewing',          -- legacy: manual review
      'matched',            -- legacy: manual match done
      'pipeline_running',   -- NEW: agentic pipeline executing
      'pending_exceptions', -- NEW: pipeline paused, open exceptions exist
      'confirmed',          -- auto or manual confirmation complete
      'error',              -- unrecoverable pipeline or parse failure
      'duplicate'           -- NEW: identified as duplicate, blocked
    ));

-- Add pipeline_stage CHECK (idempotent: drop first if exists)
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_pipeline_stage_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_pipeline_stage_check
    CHECK (pipeline_stage IS NULL OR pipeline_stage IN (
      'extracting',
      'resolving_supplier',
      'matching_po',
      'matching_items',
      'confirming',
      'completed',
      'failed'
    ));

-- Add vision_item_confidence to invoice_items for per-line confidence tracking
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS vision_item_confidence NUMERIC(4,3)
    CHECK (vision_item_confidence IS NULL OR (vision_item_confidence >= 0.0 AND vision_item_confidence <= 1.0));

-- Index for finding in-progress invoices (for resume-on-restart)
CREATE INDEX IF NOT EXISTS idx_invoices_pipeline_stage
  ON public.invoices (tenant_id, pipeline_stage)
  WHERE pipeline_stage IS NOT NULL AND pipeline_stage NOT IN ('completed', 'failed');

-- Index for open exception count (sidebar badge query)
CREATE INDEX IF NOT EXISTS idx_invoices_open_exceptions
  ON public.invoices (tenant_id, open_exception_count)
  WHERE open_exception_count > 0;

COMMENT ON COLUMN public.invoices.pipeline_stage IS
  'Current stage of the agentic pipeline: extracting | resolving_supplier | matching_po | matching_items | confirming | completed | failed';
COMMENT ON COLUMN public.invoices.pipeline_started_at IS
  'Timestamp when the orchestrator first started processing this invoice.';
COMMENT ON COLUMN public.invoices.pipeline_completed_at IS
  'Timestamp when the pipeline reached completed or failed state.';
COMMENT ON COLUMN public.invoices.pipeline_error IS
  'Last error message from the pipeline, if status=error. Sanitized (no stack traces).';
COMMENT ON COLUMN public.invoices.vision_confidence IS
  'Overall GPT-4o Vision extraction confidence score (0.0–1.0). Null if text extraction was used.';
COMMENT ON COLUMN public.invoices.open_exception_count IS
  'Denormalized count of open invoice_exceptions for this invoice. Maintained by triggers.';

-- ============================================================
-- Trigger: keep open_exception_count in sync with invoice_exceptions
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_invoice_open_exception_count()
RETURNS TRIGGER AS $$
DECLARE
  target_invoice_id UUID;
BEGIN
  -- Determine which invoice_id changed
  IF TG_OP = 'DELETE' THEN
    target_invoice_id := OLD.invoice_id;
  ELSE
    target_invoice_id := NEW.invoice_id;
  END IF;

  UPDATE public.invoices
  SET open_exception_count = (
    SELECT COUNT(*) FROM public.invoice_exceptions
    WHERE invoice_id = target_invoice_id AND status = 'open'
  )
  WHERE id = target_invoice_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  CREATE TRIGGER sync_open_exception_count_on_exception_change
    AFTER INSERT OR UPDATE OF status OR DELETE
    ON public.invoice_exceptions
    FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_open_exception_count();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
