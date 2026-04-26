-- MOK-121: add severity column to invoice_exceptions to distinguish
-- informational variance signals (notify, non-blocking) from blocking
-- exceptions that prevent invoice auto-confirmation.
--
-- Default 'block' so any pre-existing exceptions retain their current
-- behavior (the existence of a blocking exception flips the invoice to
-- pending_exceptions in stage 5).

ALTER TABLE public.invoice_exceptions
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'block';

ALTER TABLE public.invoice_exceptions
  DROP CONSTRAINT IF EXISTS invoice_exceptions_severity_check;

ALTER TABLE public.invoice_exceptions
  ADD CONSTRAINT invoice_exceptions_severity_check
    CHECK (severity IN ('info', 'block'));

-- Index supports the stage-5 "any block-severity exception?" gate.
CREATE INDEX IF NOT EXISTS invoice_exceptions_invoice_id_severity_status_idx
  ON public.invoice_exceptions (invoice_id, severity, status);

COMMENT ON COLUMN public.invoice_exceptions.severity IS
  'MOK-121: ''block'' (default) prevents auto-confirmation; ''info'' is informational only and does not block.';
