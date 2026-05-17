-- KDS v3 phase 5 — per-item / per-variation display overrides
--
-- Spec: https://linear.app/mokesai/issue/MOK-157
-- Plan: .planning/kds-v3/PHASE-5-PLAN.md (T1)
--
-- Tenant-scoped escape hatch for displaying Square items / variations
-- differently on KDS than Square's actual state. Three override types
-- per target (item or variation):
--   - alt_display_name             — show a different name on KDS
--   - alt_image_aesthetic_image_id — attach an image from phase 4's library
--   - hidden_from_kds              — hide the target on KDS only
--
-- Phase 6's renderer will consume the row. Precedence: variation override
-- > item override > Square default (frozen in PHASE-5-PLAN.md). Phase 5
-- only ships the data layer + admin UI for managing overrides.
--
-- Target shape is polymorphic — `target_kind` discriminates between
-- 'item' (target_id references square_menu_items.id) and 'variation'
-- (target_id references square_menu_item_variations.id). No DB FK on
-- target_id because of the polymorphism; route-layer validation enforces
-- target existence on PUT, and orphan rows (after Square hard-deletes)
-- are tolerated — phase 6's renderer skips overrides whose target_id
-- doesn't resolve.
--
-- Rollback: see .planning/kds-v3/PHASE-5-ROLLBACK.sql.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kds_display_overrides (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     uuid        NOT NULL,
  target_kind                   text        NOT NULL CHECK (target_kind IN ('item','variation')),
  target_id                     text        NOT NULL,
  alt_display_name              text        CHECK (alt_display_name IS NULL OR length(alt_display_name) <= 120),
  alt_image_aesthetic_image_id  uuid,
  hidden_from_kds               boolean     NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, target_kind, target_id)
);

-- Index for the GET-list query (tenant-scoped, often filtered by kind).
CREATE INDEX IF NOT EXISTS kds_display_overrides_tenant_target_idx
  ON public.kds_display_overrides (tenant_id, target_kind);

-- ─────────────────────────────────────────────────────────────────────────────
-- FK from alt_image to phase 4's library. ON DELETE SET NULL so hard-deleting
-- an image leaves the override row intact (operator just needs to re-bind).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_display_overrides
  DROP CONSTRAINT IF EXISTS kds_display_overrides_alt_image_fk;

ALTER TABLE public.kds_display_overrides
  ADD CONSTRAINT kds_display_overrides_alt_image_fk
    FOREIGN KEY (alt_image_aesthetic_image_id)
    REFERENCES public.kds_aesthetic_images(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Not-empty CHECK — DB-level defense in case the route's auto-delete logic
-- ever has a bug. A row in this table is meaningful only if at least one of
-- the three override fields is set to a non-default value.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_display_overrides
  DROP CONSTRAINT IF EXISTS kds_display_overrides_not_empty;

ALTER TABLE public.kds_display_overrides
  ADD CONSTRAINT kds_display_overrides_not_empty CHECK (
    alt_display_name IS NOT NULL
    OR alt_image_aesthetic_image_id IS NOT NULL
    OR hidden_from_kds = true
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_display_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_staff_select_kds_display_overrides" ON public.kds_display_overrides;
CREATE POLICY "tenant_staff_select_kds_display_overrides" ON public.kds_display_overrides
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_kds_display_overrides" ON public.kds_display_overrides;
CREATE POLICY "tenant_admin_insert_kds_display_overrides" ON public.kds_display_overrides
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_kds_display_overrides" ON public.kds_display_overrides;
CREATE POLICY "tenant_admin_update_kds_display_overrides" ON public.kds_display_overrides
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_kds_display_overrides" ON public.kds_display_overrides;
CREATE POLICY "tenant_admin_delete_kds_display_overrides" ON public.kds_display_overrides
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

COMMIT;
