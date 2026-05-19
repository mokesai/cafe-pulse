-- KDS v3 phase 6 — featured_list layout + per-box visual chrome + subtitle
--
-- Spec: MOK-158 (addendum surfaced during operator UI/UX testing)
-- Plan: .planning/kds-v3/PHASE-6-PLAN.md (T6.X — addendum)
--
-- Lets the operator highlight a single attention-grabbing box (e.g.
-- "Popular Flavors") without breaking the otherwise-standard look of the
-- rest of the menu.
--
-- Adds to `kds_grid_boxes`:
--   - Per-slot subtitle_override / subtitle_override_b (text, nullable —
--     same shape as header_override but rendered on its own line).
--   - Per-box chrome — box_border / box_radius / box_background. Per-box,
--     not per-slot, because the chrome wraps the whole box including any
--     divided halves.
--   - New 'featured_list' value added to the slot-A and slot-B layout_mode
--     enum CHECK constraints — drop + recreate to extend the allowed set.
--
-- subtitle_override_b is gated on box_type_b being set via a small additive
-- CHECK (in line with the phase 2.5 division_slot_b_invariant pattern but
-- additive, not modifying that constraint).
--
-- Rollback: see .planning/kds-v3/PHASE-6-ROLLBACK.sql (will be extended
-- alongside this migration).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- New columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  ADD COLUMN IF NOT EXISTS subtitle_override   text,
  ADD COLUMN IF NOT EXISTS subtitle_override_b text,
  ADD COLUMN IF NOT EXISTS box_border          text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS box_radius          text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS box_background      text NOT NULL DEFAULT 'none';

-- ─────────────────────────────────────────────────────────────────────────────
-- Length CHECKs on the subtitle columns (mirror alt_display_name pattern
-- from phase 5 — 120 char cap is generous for a single TV display line).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_subtitle_override_length;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_subtitle_override_length
    CHECK (subtitle_override IS NULL OR length(subtitle_override) <= 120);

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_subtitle_override_b_length;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_subtitle_override_b_length
    CHECK (subtitle_override_b IS NULL OR length(subtitle_override_b) <= 120);

-- subtitle_override_b is meaningful only when slot B is present. Phase 2.5's
-- division_slot_b_invariant already enforces "all slot-B content fields NULL
-- when box_type_b NULL" for the original slot-B columns; we add a small
-- additive CHECK here for subtitle_override_b so we don't have to DROP +
-- RECREATE the phase 2.5 invariant.
ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_subtitle_override_b_gated;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_subtitle_override_b_gated
    CHECK (subtitle_override_b IS NULL OR box_type_b IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- Box chrome enum CHECKs.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_box_border_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_box_border_check
    CHECK (box_border IN ('none','thin','thick'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_box_radius_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_box_radius_check
    CHECK (box_radius IN ('none','sm','lg'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_box_background_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_box_background_check
    CHECK (box_background IN ('none','white','accent','warm','cool'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend layout_mode / layout_mode_b enum CHECKs to include 'featured_list'.
-- The phase 6 (T1) migration created these constraints with 4 values; we
-- drop and re-add to extend to 5.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_layout_mode_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_layout_mode_check
    CHECK (layout_mode IN ('simple_list','variation_column_header','flavor_list','compact_list','featured_list'));

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_layout_mode_b_check;
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_layout_mode_b_check
    CHECK (layout_mode_b IS NULL
           OR layout_mode_b IN ('simple_list','variation_column_header','flavor_list','compact_list','featured_list'));

COMMIT;
