-- MOK-20: Create kds-assets Supabase storage bucket for tenant image uploads

-- Create the bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kds-assets',
  'kds-assets',
  true, -- public so images can be served directly
  5242880, -- 5MB max file size
  ARRAY['image/png', 'image/jpg', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for storage.objects in the kds-assets bucket

-- Anyone can read (public bucket for serving images)
CREATE POLICY "kds_assets_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'kds-assets');

-- Tenant owner/admin can upload to their own folder ({tenant_id}/*)
CREATE POLICY "kds_assets_tenant_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'kds-assets'
    AND (
      -- Folder must start with a tenant_id the user is owner/admin of
      EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
        AND (storage.foldername(name))[1] = tm.tenant_id::text
      )
    )
  );

-- Tenant owner/admin can update their own files
CREATE POLICY "kds_assets_tenant_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'kds-assets'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
      AND tm.role IN ('owner', 'admin')
      AND (storage.foldername(name))[1] = tm.tenant_id::text
    )
  );

-- Tenant owner/admin can delete their own files
CREATE POLICY "kds_assets_tenant_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'kds-assets'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
      AND tm.role IN ('owner', 'admin')
      AND (storage.foldername(name))[1] = tm.tenant_id::text
    )
  );
