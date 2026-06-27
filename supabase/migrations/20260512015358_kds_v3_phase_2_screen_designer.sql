-- KDS v3 phase 2 — screen + grid schema
--
-- Spec: https://linear.app/mokesai/issue/MOK-152
-- Plan: .planning/kds-v3/PHASE-2-PLAN.md
--
-- Adds tenant-scoped tables for the KDS v3 screen designer:
--   - kds_screens         — one row per physical KDS display (capped at 2 per
--                            tenant via route layer, not DB constraint, so
--                            the cap is liftable when hardware changes).
--   - kds_grid_boxes      — boxes within a screen's grid, with stable
--                            position numbers + a box_type discriminator.
--                            Box content fields (square_menu_group_id,
--                            aesthetic_image_id) are nullable here — they
--                            get populated in phases 3 / 4.
--
-- All tables follow the multi-tenant invariants from CLAUDE.md:
--   - tenant_id NOT NULL with no default (defends against MOK-107)
--   - RLS enabled with tenant-scoped policies
--
-- Rollback: see .planning/kds-v3/PHASE-2-ROLLBACK.sql.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kds_screens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  name            text        NOT NULL,
  grid_rows       int         NOT NULL CHECK (grid_rows BETWEEN 1 AND 12),
  grid_cols       int         NOT NULL CHECK (grid_cols BETWEEN 1 AND 12),
  theme           text        NOT NULL DEFAULT 'warm'
                              CHECK (theme IN ('warm','dark','wps')),
  square_menu_id  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS kds_screens_tenant_idx ON public.kds_screens (tenant_id);

CREATE TABLE IF NOT EXISTS public.kds_grid_boxes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  screen_id             uuid        NOT NULL,
  position              int         NOT NULL CHECK (position >= 1),
  row_start             int         NOT NULL CHECK (row_start >= 1),
  col_start             int         NOT NULL CHECK (col_start >= 1),
  row_span              int         NOT NULL CHECK (row_span >= 1),
  col_span              int         NOT NULL CHECK (col_span >= 1),
  box_type              text        NOT NULL
                                    CHECK (box_type IN ('menu_group','image_only')),
  square_menu_group_id  text,
  aesthetic_image_id    uuid,
  header_override       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (screen_id) REFERENCES public.kds_screens(id) ON DELETE CASCADE,
  UNIQUE (screen_id, position)
);

CREATE INDEX IF NOT EXISTS kds_grid_boxes_tenant_screen_position_idx
  ON public.kds_grid_boxes (tenant_id, screen_id, position);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_screens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kds_grid_boxes  ENABLE ROW LEVEL SECURITY;

-- === kds_screens ===

DROP POLICY IF EXISTS "tenant_staff_select_kds_screens" ON public.kds_screens;
CREATE POLICY "tenant_staff_select_kds_screens" ON public.kds_screens
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_screens" ON public.kds_screens;
CREATE POLICY "tenant_admin_insert_kds_screens" ON public.kds_screens
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_screens" ON public.kds_screens;
CREATE POLICY "tenant_admin_update_kds_screens" ON public.kds_screens
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_screens" ON public.kds_screens;
CREATE POLICY "tenant_admin_delete_kds_screens" ON public.kds_screens
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

-- === kds_grid_boxes ===

DROP POLICY IF EXISTS "tenant_staff_select_kds_grid_boxes" ON public.kds_grid_boxes;
CREATE POLICY "tenant_staff_select_kds_grid_boxes" ON public.kds_grid_boxes
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_grid_boxes" ON public.kds_grid_boxes;
CREATE POLICY "tenant_admin_insert_kds_grid_boxes" ON public.kds_grid_boxes
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_grid_boxes" ON public.kds_grid_boxes;
CREATE POLICY "tenant_admin_update_kds_grid_boxes" ON public.kds_grid_boxes
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_grid_boxes" ON public.kds_grid_boxes;
CREATE POLICY "tenant_admin_delete_kds_grid_boxes" ON public.kds_grid_boxes
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

COMMIT;
