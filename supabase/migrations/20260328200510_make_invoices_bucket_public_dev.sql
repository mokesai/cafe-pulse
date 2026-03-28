-- DEVELOPMENT ONLY: Make invoices bucket public for testing
-- 
-- This migration makes the invoices storage bucket public for the dev environment.
-- This allows the Vision API and other external services to download invoice files
-- without authentication, which simplifies testing of the invoice pipeline.
--
-- IMPORTANT: This should NOT be applied to production. In production, we use signed URLs
-- (see src/app/api/admin/invoices/upload/route.ts) which provide secure, time-limited access.
--
-- To disable public access later, run:
--   UPDATE storage.buckets SET public = false WHERE id = 'invoices';

UPDATE storage.buckets 
SET public = true 
WHERE id = 'invoices' AND public = false;

-- Allow public SELECT on invoices bucket
CREATE POLICY "Public invoices read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'invoices')
ON CONFLICT DO NOTHING;

INSERT INTO audit.audit_log (entity, action, details, created_by)
VALUES ('storage.buckets', 'UPDATE', 'Made invoices bucket public for dev testing', 'system')
ON CONFLICT DO NOTHING;
