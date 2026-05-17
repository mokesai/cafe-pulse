-- KDS v3 phase 4 — aesthetic image library Supabase Storage bucket
--
-- Spec: https://linear.app/mokesai/issue/MOK-156
-- Plan: .planning/kds-v3/PHASE-4-PLAN.md (T3)
--
-- Separate from the T1 table migration so rollback of the table doesn't
-- have to touch storage. Per the MOK-156 decision the bucket persists
-- across phase-4 rollback (free until populated; preserves uploaded
-- content for recovery).
--
-- Path convention: `<tenant_id>/<image_id>.<ext>`. Bucket is private —
-- the app proxies image fetches via signed URLs (see T4's GET route).
-- Public-read is deliberately NOT enabled (unlike v2's kds-assets bucket)
-- so we can revoke access on tenant offboarding without re-generating
-- bucket policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Create the bucket (idempotent on id).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kds-v3-aesthetic-images',
  'kds-v3-aesthetic-images',
  false, -- private; signed URLs only
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS policies on storage.objects. Path-prefix scoped to tenant_id —
--    the first folder segment of the object's name must match a tenant the
--    user is a member of. Same pattern as v2's kds-assets bucket (see
--    20260314300000_create_kds_assets_bucket.sql) but:
--      - SELECT is tenant-scoped (not public), since the bucket is private.
--      - INSERT/DELETE require admin/owner; UPDATE not granted (image
--        sources are immutable after create — operator soft-deletes via
--        the route and re-uploads to swap).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "kds_v3_aesthetic_images_tenant_select" ON storage.objects;
CREATE POLICY "kds_v3_aesthetic_images_tenant_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'kds-v3-aesthetic-images'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin', 'staff')
        AND (storage.foldername(name))[1] = tm.tenant_id::text
    )
  );

DROP POLICY IF EXISTS "kds_v3_aesthetic_images_tenant_insert" ON storage.objects;
CREATE POLICY "kds_v3_aesthetic_images_tenant_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'kds-v3-aesthetic-images'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
        AND (storage.foldername(name))[1] = tm.tenant_id::text
    )
  );

DROP POLICY IF EXISTS "kds_v3_aesthetic_images_tenant_delete" ON storage.objects;
CREATE POLICY "kds_v3_aesthetic_images_tenant_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'kds-v3-aesthetic-images'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
        AND (storage.foldername(name))[1] = tm.tenant_id::text
    )
  );
