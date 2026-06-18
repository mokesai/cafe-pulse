-- KDS v3 phase 1 — Square menu mirror
--
-- Spec: https://linear.app/mokesai/issue/MOK-151
-- Plan: .planning/kds-v3/PHASE-1-PLAN.md
--
-- Adds a tenant-scoped local mirror of Square menus (MENU_CATEGORY top-level),
-- menu groups (MENU_CATEGORY child), items, item variations, and item↔menu_group
-- memberships. Subsequent KDS v3 phases (grid schema, screen designer, render)
-- read exclusively from this mirror — no Square API calls in the request path.
--
-- All tables follow the multi-tenant invariants from CLAUDE.md:
--   - tenant_id NOT NULL with no default (defends against MOK-107 silent fallback)
--   - RLS enabled with tenant-scoped policies
--   - Service-role writes bypass RLS; user-scoped reads honor it.
--
-- Rollback: see .planning/kds-v3/ROLLBACK.sql (kept outside supabase/migrations/
-- so it doesn't auto-run; rehearsed against cafe-pulse-dev as part of phase 1
-- verification per the plan).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Menus and Menu Groups (both modeled as MENU_CATEGORY in Square's catalog).
-- A menu has is_top_level=true and parent_id=null. A menu group has
-- is_top_level=false and parent_id pointing to the menu.
CREATE TABLE IF NOT EXISTS public.square_menu_categories (
  tenant_id          uuid        NOT NULL,
  id                 text        NOT NULL,
  name               text        NOT NULL,
  is_top_level       boolean     NOT NULL,
  parent_id          text,
  ordinal            bigint,
  channels           text[]      NOT NULL DEFAULT '{}',
  online_visibility  boolean,
  square_version     bigint      NOT NULL,
  raw_json           jsonb,
  is_deleted         boolean     NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS square_menu_categories_tenant_parent_idx
  ON public.square_menu_categories (tenant_id, parent_id);

CREATE INDEX IF NOT EXISTS square_menu_categories_tenant_top_level_idx
  ON public.square_menu_categories (tenant_id, is_top_level)
  WHERE is_top_level;

-- Square ITEM objects that reference at least one MENU_CATEGORY. Items that
-- only belong to REGULAR_CATEGORY (e.g. legacy POS-only items) are skipped
-- by the sync — they don't appear here.
CREATE TABLE IF NOT EXISTS public.square_menu_items (
  tenant_id          uuid        NOT NULL,
  id                 text        NOT NULL,
  name               text        NOT NULL,
  description        text,
  image_url          text,
  square_version     bigint      NOT NULL,
  raw_json           jsonb,
  is_deleted         boolean     NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Variations carry the price. KDS render in later phases picks one (cheapest
-- by default; later phases may add per-item variation overrides).
CREATE TABLE IF NOT EXISTS public.square_menu_item_variations (
  tenant_id          uuid        NOT NULL,
  id                 text        NOT NULL,
  item_id            text        NOT NULL,
  name               text,
  price_cents        bigint,
  ordinal            bigint,
  is_deleted         boolean     NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id)
    REFERENCES public.square_menu_items(tenant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS square_menu_item_variations_tenant_item_idx
  ON public.square_menu_item_variations (tenant_id, item_id);

-- Many-to-many: an item can belong to multiple menu groups. The ordinal is
-- the item's sort order within the group (Square's category-membership ordinal).
-- Removing an item from a group → row deleted (not soft-marked); membership
-- doesn't have a meaningful "still exists but deleted" state.
CREATE TABLE IF NOT EXISTS public.square_menu_item_categories (
  tenant_id     uuid    NOT NULL,
  item_id       text    NOT NULL,
  category_id   text    NOT NULL,
  ordinal       bigint  NOT NULL,
  PRIMARY KEY (tenant_id, item_id, category_id)
);

CREATE INDEX IF NOT EXISTS square_menu_item_categories_tenant_category_ordinal_idx
  ON public.square_menu_item_categories (tenant_id, category_id, ordinal);

-- Per-tenant sync state. Tracks the last successful sync timestamp so the
-- next incremental sync uses begin_time = last_synced_at. One row per tenant
-- (PK on tenant_id alone).
CREATE TABLE IF NOT EXISTS public.square_menu_sync_state (
  tenant_id        uuid        PRIMARY KEY,
  last_synced_at   timestamptz,
  last_run_status  text,
  last_error       text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.square_menu_categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_menu_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_menu_item_variations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_menu_item_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_menu_sync_state         ENABLE ROW LEVEL SECURITY;

-- === square_menu_categories ===

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_categories" ON public.square_menu_categories;
CREATE POLICY "tenant_staff_select_square_menu_categories" ON public.square_menu_categories
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_categories" ON public.square_menu_categories;
CREATE POLICY "tenant_admin_insert_square_menu_categories" ON public.square_menu_categories
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_square_menu_categories" ON public.square_menu_categories;
CREATE POLICY "tenant_admin_update_square_menu_categories" ON public.square_menu_categories
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_categories" ON public.square_menu_categories;
CREATE POLICY "tenant_admin_delete_square_menu_categories" ON public.square_menu_categories
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

-- === square_menu_items ===

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_items" ON public.square_menu_items;
CREATE POLICY "tenant_staff_select_square_menu_items" ON public.square_menu_items
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_items" ON public.square_menu_items;
CREATE POLICY "tenant_admin_insert_square_menu_items" ON public.square_menu_items
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_square_menu_items" ON public.square_menu_items;
CREATE POLICY "tenant_admin_update_square_menu_items" ON public.square_menu_items
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_items" ON public.square_menu_items;
CREATE POLICY "tenant_admin_delete_square_menu_items" ON public.square_menu_items
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

-- === square_menu_item_variations ===

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_item_variations" ON public.square_menu_item_variations;
CREATE POLICY "tenant_staff_select_square_menu_item_variations" ON public.square_menu_item_variations
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_item_variations" ON public.square_menu_item_variations;
CREATE POLICY "tenant_admin_insert_square_menu_item_variations" ON public.square_menu_item_variations
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_square_menu_item_variations" ON public.square_menu_item_variations;
CREATE POLICY "tenant_admin_update_square_menu_item_variations" ON public.square_menu_item_variations
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_item_variations" ON public.square_menu_item_variations;
CREATE POLICY "tenant_admin_delete_square_menu_item_variations" ON public.square_menu_item_variations
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

-- === square_menu_item_categories ===

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_item_categories" ON public.square_menu_item_categories;
CREATE POLICY "tenant_staff_select_square_menu_item_categories" ON public.square_menu_item_categories
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_item_categories" ON public.square_menu_item_categories;
CREATE POLICY "tenant_admin_insert_square_menu_item_categories" ON public.square_menu_item_categories
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_square_menu_item_categories" ON public.square_menu_item_categories;
CREATE POLICY "tenant_admin_update_square_menu_item_categories" ON public.square_menu_item_categories
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_item_categories" ON public.square_menu_item_categories;
CREATE POLICY "tenant_admin_delete_square_menu_item_categories" ON public.square_menu_item_categories
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

-- === square_menu_sync_state ===

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_sync_state" ON public.square_menu_sync_state;
CREATE POLICY "tenant_staff_select_square_menu_sync_state" ON public.square_menu_sync_state
  FOR SELECT USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin','staff']))
  );

DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_sync_state" ON public.square_menu_sync_state;
CREATE POLICY "tenant_admin_insert_square_menu_sync_state" ON public.square_menu_sync_state
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_update_square_menu_sync_state" ON public.square_menu_sync_state;
CREATE POLICY "tenant_admin_update_square_menu_sync_state" ON public.square_menu_sync_state
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_sync_state" ON public.square_menu_sync_state;
CREATE POLICY "tenant_admin_delete_square_menu_sync_state" ON public.square_menu_sync_state
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );

COMMIT;
