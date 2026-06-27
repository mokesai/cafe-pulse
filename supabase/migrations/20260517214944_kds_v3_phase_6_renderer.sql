-- KDS v3 phase 6 — public renderer / group layout modes / formatting controls
--
-- Spec: https://linear.app/mokesai/issue/MOK-158
-- Plan: .planning/kds-v3/PHASE-6-PLAN.md (T1)
--
-- Adds 10 new columns to `kds_grid_boxes` to drive phase 6's layout +
-- formatting + price-display rendering. Five mirror columns per slot (A and
-- B), gated on the existing `box_type_b` "is the box divided" signal.
--
-- Slot A columns are NOT NULL with safe defaults so the next code deploy
-- against an unmodified row produces a sensible render (simple_list / lowest
-- / normal / medium / left). Slot B columns are nullable; the cross-slot-B
-- invariant CHECK enforces that they are all NULL when box_type_b is NULL
-- and all NOT NULL when box_type_b is set — preventing partial-slot-B
-- states the renderer would otherwise have to defensively normalize.
--
-- Existing phase 2.5 invariant `kds_grid_boxes_division_slot_b_invariant`
-- already gates `square_menu_group_id_b` / `aesthetic_image_id_b` /
-- `header_override_b` on the same `box_type_b`-is-set signal — we add a
-- second, parallel invariant for the formatting columns instead of
-- modifying the existing one (additive migration, no DROP-then-RECREATE).
--
-- Rollback: see .planning/kds-v3/PHASE-6-ROLLBACK.sql.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Slot A: 5 NOT NULL columns with backfill-safe defaults
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  ADD COLUMN IF NOT EXISTS layout_mode        text NOT NULL DEFAULT 'simple_list',
  ADD COLUMN IF NOT EXISTS price_display_mode text NOT NULL DEFAULT 'lowest',
  ADD COLUMN IF NOT EXISTS density            text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS title_size         text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS title_align        text NOT NULL DEFAULT 'left';

-- ─────────────────────────────────────────────────────────────────────────────
-- Slot B: 5 nullable columns (set iff box_type_b is set)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  ADD COLUMN IF NOT EXISTS layout_mode_b        text,
  ADD COLUMN IF NOT EXISTS price_display_mode_b text,
  ADD COLUMN IF NOT EXISTS density_b            text,
  ADD COLUMN IF NOT EXISTS title_size_b         text,
  ADD COLUMN IF NOT EXISTS title_align_b        text;

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum CHECKs (slot A — required)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_layout_mode_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_layout_mode_check
    CHECK (layout_mode IN ('simple_list','variation_column_header','flavor_list','compact_list'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_price_display_mode_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_price_display_mode_check
    CHECK (price_display_mode IN ('none','lowest','range','base'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_density_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_density_check
    CHECK (density IN ('compact','normal','loose'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_title_size_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_title_size_check
    CHECK (title_size IN ('small','medium','large'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_title_align_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_title_align_check
    CHECK (title_align IN ('left','center','right'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum CHECKs (slot B — nullable)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_layout_mode_b_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_layout_mode_b_check
    CHECK (layout_mode_b IS NULL
           OR layout_mode_b IN ('simple_list','variation_column_header','flavor_list','compact_list'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_price_display_mode_b_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_price_display_mode_b_check
    CHECK (price_display_mode_b IS NULL
           OR price_display_mode_b IN ('none','lowest','range','base'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_density_b_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_density_b_check
    CHECK (density_b IS NULL
           OR density_b IN ('compact','normal','loose'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_title_size_b_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_title_size_b_check
    CHECK (title_size_b IS NULL
           OR title_size_b IN ('small','medium','large'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_title_align_b_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_title_align_b_check
    CHECK (title_align_b IS NULL
           OR title_align_b IN ('left','center','right'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: existing divided boxes have box_type_b set but slot-B formatting
-- columns NULL. Populate them with the same safe defaults as slot-A so the
-- upcoming invariant CHECK is satisfied.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.kds_grid_boxes
SET layout_mode_b        = COALESCE(layout_mode_b,        'simple_list'),
    price_display_mode_b = COALESCE(price_display_mode_b, 'lowest'),
    density_b            = COALESCE(density_b,            'normal'),
    title_size_b         = COALESCE(title_size_b,         'medium'),
    title_align_b        = COALESCE(title_align_b,        'left')
WHERE box_type_b IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cross-slot-B invariant for the formatting columns. Parallel to the
-- existing kds_grid_boxes_division_slot_b_invariant (phase 2.5) which
-- gates the content columns on box_type_b.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_slot_b_formatting_invariant;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_slot_b_formatting_invariant CHECK (
    (box_type_b IS NULL
       AND layout_mode_b IS NULL
       AND price_display_mode_b IS NULL
       AND density_b IS NULL
       AND title_size_b IS NULL
       AND title_align_b IS NULL)
    OR
    (box_type_b IS NOT NULL
       AND layout_mode_b IS NOT NULL
       AND price_display_mode_b IS NOT NULL
       AND density_b IS NOT NULL
       AND title_size_b IS NOT NULL
       AND title_align_b IS NOT NULL)
  );

COMMIT;
