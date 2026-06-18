-- KDS v3 phase 6.5 — draft / published workflow + variation-emphasis polish
--
-- Spec: https://linear.app/mokesai/issue/MOK-159
-- Plan: .planning/kds-v3/PHASE-6.5-PLAN.md (T0)
--
-- Adds:
--   1. `draft_updated_at` tick column on `kds_screens` (route updates it on
--      every save so the screens-list page can compute "unpublished
--      changes" via a cheap timestamp compare).
--   2. `kds_published_screens` + `kds_published_grid_boxes` snapshot tables
--      that mirror the draft tables 1:1 in shape — created via CREATE TABLE
--      LIKE (INCLUDING ALL) so defaults / CHECKs / indexes carry over. RLS
--      policies and foreign keys are added explicitly afterward (LIKE does
--      not include either).
--   3. `published_at` tick column on `kds_published_screens` (set by the
--      publish RPC when the snapshot is refreshed).
--   4. Per-slot emphasized-variation columns on `kds_grid_boxes` — replaces
--      the regex heuristic from phase 6's variation_column_header renderer
--      with an operator-pickable column. Two-column design avoids
--      magic-string sentinels:
--        - `emphasized_variation_name text NULL`     — null = "Auto"
--          (renderer falls back to regex); otherwise the variation
--          display_name to emphasize.
--        - `emphasized_variation_explicit_none boolean NOT NULL DEFAULT false`
--          — explicit opt-out; overrides Auto.
--      Slot-B mirrors gated by `kds_grid_boxes_emphasized_variation_b_gated`
--      (same pattern as the phase 6 addendum's subtitle_override_b gate).
--   5. Defensive first-run copy — populates the snapshot tables from
--      current draft state for every existing screen so v3 Pi devices keep
--      rendering the same content through the deploy. Wrapped in an empty-
--      table guard so re-running the migration doesn't overwrite a
--      legitimate publish.
--
-- Rollback: see .planning/kds-v3/PHASE-6.5-ROLLBACK.sql.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New tick column on the draft screens table
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_screens
  ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz NOT NULL DEFAULT now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Per-slot emphasized-variation columns on kds_grid_boxes
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  ADD COLUMN IF NOT EXISTS emphasized_variation_name        text,
  ADD COLUMN IF NOT EXISTS emphasized_variation_explicit_none boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emphasized_variation_name_b      text,
  ADD COLUMN IF NOT EXISTS emphasized_variation_explicit_none_b boolean NOT NULL DEFAULT false;

-- subtitle-override-b-style gate: emphasized_variation_name_b is meaningful
-- only when slot B is set. Boolean explicit_none_b doesn't need gating
-- because false (default) is always semantically valid.
ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_emphasized_variation_b_gated;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_emphasized_variation_b_gated
    CHECK (emphasized_variation_name_b IS NULL OR box_type_b IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Snapshot tables (LIKE the draft tables; FKs + RLS added explicitly)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kds_published_screens
  (LIKE public.kds_screens INCLUDING ALL);

-- Published table doesn't need the draft tick (it has its own).
ALTER TABLE public.kds_published_screens
  DROP COLUMN IF EXISTS draft_updated_at;
ALTER TABLE public.kds_published_screens
  ADD COLUMN IF NOT EXISTS published_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.kds_published_grid_boxes
  (LIKE public.kds_grid_boxes INCLUDING ALL);

-- ── FKs on published_grid_boxes ─────────────────────────────────────────────
-- screen_id → published_screens (NOT draft_screens) so deleting a published
-- screen cascades its published boxes.
ALTER TABLE public.kds_published_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_published_grid_boxes_screen_id_fkey;
ALTER TABLE public.kds_published_grid_boxes
  ADD CONSTRAINT kds_published_grid_boxes_screen_id_fkey
    FOREIGN KEY (screen_id) REFERENCES public.kds_published_screens(id) ON DELETE CASCADE;

-- aesthetic_image FKs point at the live library — images aren't snapshotted
-- (they're tenant-scoped resources, not per-screen state).
ALTER TABLE public.kds_published_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_published_grid_boxes_aesthetic_image_fk;
ALTER TABLE public.kds_published_grid_boxes
  ADD CONSTRAINT kds_published_grid_boxes_aesthetic_image_fk
    FOREIGN KEY (aesthetic_image_id) REFERENCES public.kds_aesthetic_images(id) ON DELETE SET NULL;

ALTER TABLE public.kds_published_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_published_grid_boxes_aesthetic_image_b_fk;
ALTER TABLE public.kds_published_grid_boxes
  ADD CONSTRAINT kds_published_grid_boxes_aesthetic_image_b_fk
    FOREIGN KEY (aesthetic_image_id_b) REFERENCES public.kds_aesthetic_images(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS on the snapshot tables — same shape as the draft tables
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_published_screens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_staff_select_kds_published_screens" ON public.kds_published_screens;
CREATE POLICY "tenant_staff_select_kds_published_screens" ON public.kds_published_screens
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_published_screens" ON public.kds_published_screens;
CREATE POLICY "tenant_admin_insert_kds_published_screens" ON public.kds_published_screens
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_published_screens" ON public.kds_published_screens;
CREATE POLICY "tenant_admin_update_kds_published_screens" ON public.kds_published_screens
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_published_screens" ON public.kds_published_screens;
CREATE POLICY "tenant_admin_delete_kds_published_screens" ON public.kds_published_screens
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

ALTER TABLE public.kds_published_grid_boxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_staff_select_kds_published_grid_boxes" ON public.kds_published_grid_boxes;
CREATE POLICY "tenant_staff_select_kds_published_grid_boxes" ON public.kds_published_grid_boxes
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_published_grid_boxes" ON public.kds_published_grid_boxes;
CREATE POLICY "tenant_admin_insert_kds_published_grid_boxes" ON public.kds_published_grid_boxes
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_published_grid_boxes" ON public.kds_published_grid_boxes;
CREATE POLICY "tenant_admin_update_kds_published_grid_boxes" ON public.kds_published_grid_boxes
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_published_grid_boxes" ON public.kds_published_grid_boxes;
CREATE POLICY "tenant_admin_delete_kds_published_grid_boxes" ON public.kds_published_grid_boxes
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Defensive first-run copy — populates the snapshot from current draft
-- state for every existing screen so v3 Pi devices keep rendering whatever
-- they render today through the deploy. Guarded by an empty-table check so
-- re-running the migration doesn't overwrite a legitimate publish.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.kds_published_screens LIMIT 1) THEN
    INSERT INTO public.kds_published_screens
      (id, tenant_id, name, grid_rows, grid_cols, theme, square_menu_id, created_at, updated_at, published_at)
    SELECT id, tenant_id, name, grid_rows, grid_cols, theme, square_menu_id, created_at, updated_at, now()
    FROM public.kds_screens;

    -- Boxes table has identical schema (LIKE INCLUDING ALL), so SELECT *
    -- column order matches and INSERT is positional.
    INSERT INTO public.kds_published_grid_boxes
    SELECT * FROM public.kds_grid_boxes;
  END IF;
END $$;

COMMIT;
