-- KDS v3 phase 2.5 — box division (single split per box)
--
-- Spec: https://linear.app/mokesai/issue/MOK-154
-- Plan: .planning/kds-v3/PHASE-2.5-PLAN.md
--
-- Adds 5 columns + 1 cross-column CHECK constraint to kds_grid_boxes so each
-- box can optionally be split into two content slots (top/bottom or left/right):
--   - division:              none | horizontal | vertical (NOT NULL, default 'none')
--   - box_type_b:            menu_group | image_only (nullable)
--   - square_menu_group_id_b text   (nullable; populated in phase 3)
--   - aesthetic_image_id_b   uuid   (nullable; populated in phase 4)
--   - header_override_b      text   (nullable)
--
-- Invariant (enforced by CHECK):
--   (division = 'none'  AND all _b fields are NULL)
--   OR
--   (division != 'none' AND box_type_b IS NOT NULL)
--
-- Existing phase 2 rows: division backfills to 'none', _b fields stay NULL.
-- No data migration needed.
--
-- Rollback: see .planning/kds-v3/PHASE-2.5-ROLLBACK.sql.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New columns. IF NOT EXISTS keeps the migration idempotent (T7 rehearsal).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  ADD COLUMN IF NOT EXISTS division              text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS box_type_b            text,
  ADD COLUMN IF NOT EXISTS square_menu_group_id_b text,
  ADD COLUMN IF NOT EXISTS aesthetic_image_id_b  uuid,
  ADD COLUMN IF NOT EXISTS header_override_b     text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Per-column CHECK on the enums. Separate from the cross-column invariant
--    so the error message points at the offending column.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_division_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_box_type_b_check;

ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_division_check
    CHECK (division IN ('none', 'horizontal', 'vertical')),
  ADD CONSTRAINT kds_grid_boxes_box_type_b_check
    CHECK (box_type_b IS NULL OR box_type_b IN ('menu_group', 'image_only'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Cross-column invariant. The whole point of phase 2.5 — guarantees that
--    slot-B fields are present iff division != 'none' and absent iff it is.
--    NULL-safe because `division` is NOT NULL.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_division_slot_b_invariant;

ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_division_slot_b_invariant CHECK (
    (division = 'none'
     AND box_type_b              IS NULL
     AND square_menu_group_id_b  IS NULL
     AND aesthetic_image_id_b    IS NULL
     AND header_override_b       IS NULL)
    OR
    (division IN ('horizontal', 'vertical')
     AND box_type_b IS NOT NULL)
  );

COMMIT;
