-- Migration: Rewrite storage bucket policies with tenant_memberships
-- Phase 30 Plan 02 Task 2
-- Date: 2026-02-14
--
-- Purpose: Storage bucket policies currently use `profiles.role = 'admin'` which
-- must switch to `tenant_memberships` checks, consistent with the table policy
-- rewrite in Plan 01.
--
-- Since `storage.objects` has no `tenant_id` column, we check
-- `tenant_memberships` for the appropriate role in the current tenant context.
-- File paths are already keyed by invoice/PO data which is tenant-scoped via
-- RLS on the underlying tables. The storage policy confirms the user has the
-- correct tenant membership role.
--
-- Buckets updated:
--   1. invoices (4 policies: INSERT, SELECT, UPDATE, DELETE) - admin/owner only
--   2. purchase-order-attachments (4 policies: SELECT, INSERT, UPDATE, DELETE)
--      - SELECT: any tenant member (staff need to view PO attachments)
--      - INSERT/UPDATE/DELETE: admin/owner only
--
-- Total: 8 old policies dropped, 8 new policies created

BEGIN;

-- ============================================================================
-- INVOICES BUCKET
-- ============================================================================

-- Drop old policies (profiles.role = 'admin' pattern)
DROP POLICY IF EXISTS "Admins can upload invoice files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can access invoice files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update invoice files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete invoice files" ON storage.objects;

-- Create new tenant-aware policies for invoices bucket
-- All operations restricted to tenant admin/owner

CREATE POLICY "tenant_admin_insert_invoices" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_select_invoices" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_update_invoices" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_delete_invoices" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- PURCHASE-ORDER-ATTACHMENTS BUCKET
-- ============================================================================

-- Drop old policies (authenticated-only / public read pattern)
DROP POLICY IF EXISTS "Authenticated users can upload purchase order attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update purchase order attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete purchase order attachments" ON storage.objects;
DROP POLICY IF EXISTS "Purchase order attachments public read" ON storage.objects;

-- Create new tenant-aware policies for purchase-order-attachments bucket
-- SELECT: any tenant member (staff need to view PO attachments)
-- INSERT/UPDATE/DELETE: admin/owner only

CREATE POLICY "tenant_member_select_po_attachments" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'purchase-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin', 'staff')
    )
  );

CREATE POLICY "tenant_admin_insert_po_attachments" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'purchase-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_update_po_attachments" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'purchase-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_delete_po_attachments" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'purchase-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

COMMIT;
