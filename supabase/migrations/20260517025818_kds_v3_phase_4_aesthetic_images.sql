-- KDS v3 phase 4 — aesthetic image library
--
-- Spec: https://linear.app/mokesai/issue/MOK-156
-- Plan: .planning/kds-v3/PHASE-4-PLAN.md (T1)
--
-- Creates `kds_aesthetic_images`: a tenant-scoped library of images that
-- operators can bind to image_only-typed slots on KDS screens. Two source
-- modes (uploaded → Supabase Storage; external → hot-linked URL) live in
-- the same table, distinguished by `source_kind` + the cross-column CHECK
-- invariant that exactly one of storage_path / external_url is populated.
--
-- Also adds FKs from the existing kds_grid_boxes.aesthetic_image_id and
-- aesthetic_image_id_b columns (added in phase 2 + 2.5) → this new table,
-- with ON DELETE SET NULL so hard-deleting an image leaves the box in
-- place (operator just needs to re-bind). Soft-delete (is_deleted=true) is
-- the default path; hard-delete is operator-initiated for storage cleanup.
--
-- Storage bucket creation lives in a separate migration (T3) so rollback
-- can drop the table without touching the bucket — per the MOK-156
-- "leave the bucket" decision (bucket is free until populated, and we
-- want to preserve uploaded content if rollback is for a transient issue).
--
-- Rollback: see .planning/kds-v3/PHASE-4-ROLLBACK.sql.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kds_aesthetic_images (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  name            text        NOT NULL CHECK (length(name) > 0 AND length(name) <= 80),
  source_kind     text        NOT NULL CHECK (source_kind IN ('uploaded', 'external')),
  storage_path    text,
  external_url    text,
  alt_text        text        CHECK (alt_text IS NULL OR length(alt_text) <= 200),
  mime_type       text,
  width_px        int,
  height_px       int,
  bytes           int,
  is_deleted      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Cross-column invariant: exactly one of storage_path / external_url is set,
-- and that choice matches source_kind. NULL-safe because source_kind is
-- NOT NULL — both disjuncts evaluate deterministically.
ALTER TABLE public.kds_aesthetic_images
  DROP CONSTRAINT IF EXISTS kds_aesthetic_images_source_invariant;

ALTER TABLE public.kds_aesthetic_images
  ADD CONSTRAINT kds_aesthetic_images_source_invariant CHECK (
    (source_kind = 'uploaded'
     AND storage_path IS NOT NULL
     AND external_url IS NULL)
    OR
    (source_kind = 'external'
     AND external_url IS NOT NULL
     AND storage_path IS NULL)
  );

-- Index for the library list query (most common access pattern).
CREATE INDEX IF NOT EXISTS kds_aesthetic_images_tenant_visibility_idx
  ON public.kds_aesthetic_images (tenant_id, is_deleted, updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- FKs from kds_grid_boxes. Columns already exist (phase 2 + 2.5).
-- ON DELETE SET NULL: hard-deleting an image leaves the bound box intact;
-- operator re-binds via the editor. Soft-delete (is_deleted=true) is the
-- preferred path and doesn't fire this trigger.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_aesthetic_image_fk,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_aesthetic_image_b_fk;

ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_aesthetic_image_fk
    FOREIGN KEY (aesthetic_image_id) REFERENCES public.kds_aesthetic_images(id) ON DELETE SET NULL,
  ADD CONSTRAINT kds_grid_boxes_aesthetic_image_b_fk
    FOREIGN KEY (aesthetic_image_id_b) REFERENCES public.kds_aesthetic_images(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_aesthetic_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_staff_select_kds_aesthetic_images" ON public.kds_aesthetic_images;
CREATE POLICY "tenant_staff_select_kds_aesthetic_images" ON public.kds_aesthetic_images
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_aesthetic_images" ON public.kds_aesthetic_images;
CREATE POLICY "tenant_admin_insert_kds_aesthetic_images" ON public.kds_aesthetic_images
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_aesthetic_images" ON public.kds_aesthetic_images;
CREATE POLICY "tenant_admin_update_kds_aesthetic_images" ON public.kds_aesthetic_images
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_aesthetic_images" ON public.kds_aesthetic_images;
CREATE POLICY "tenant_admin_delete_kds_aesthetic_images" ON public.kds_aesthetic_images
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

COMMIT;
