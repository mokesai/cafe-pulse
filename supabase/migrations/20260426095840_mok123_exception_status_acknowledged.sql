-- MOK-123: add 'acknowledged' as a third terminal state for invoice_exceptions.
--
-- Distinct from 'resolved' (admin took corrective action) and 'dismissed'
-- (admin chose to ignore). Acknowledged means: "I see this variance, I'm
-- accepting it, no corrective action needed but the signal is logged for
-- supplier-performance reporting via invoice_variance_history."
--
-- Like 'resolved' and 'dismissed', 'acknowledged' is not counted as 'open'
-- by the auto-confirm logic in /api/admin/invoice-exceptions/[id]/resolve,
-- so an invoice with all exceptions in any non-open state can auto-confirm.

ALTER TYPE public.invoice_exception_status ADD VALUE IF NOT EXISTS 'acknowledged';

COMMENT ON TYPE public.invoice_exception_status IS
  'Lifecycle states for invoice_exceptions. open → resolved | dismissed | acknowledged (MOK-123).';
