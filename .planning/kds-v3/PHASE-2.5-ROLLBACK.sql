-- KDS v3 phase 2.5 — ROLLBACK
--
-- Reverses migration: 20260516025537_kds_v3_phase_2_5_box_division.sql
-- Spec: https://linear.app/mokesai/issue/MOK-154
-- Plan: .planning/kds-v3/PHASE-2.5-PLAN.md
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  WHEN TO RUN                                                             ║
-- ║                                                                          ║
-- ║  Only when abandoning KDS v3 phase 2.5 OR rehearsing rollback during    ║
-- ║  phase 2.5 verification (T7). Lives outside supabase/migrations/ so it  ║
-- ║  does NOT auto-apply via `supabase db push`. Execute manually via the  ║
-- ║  Supabase SQL editor or `psql`.                                        ║
-- ║                                                                          ║
-- ║  Safe to run while the phase 2.5 columns exist but no rows have         ║
-- ║  populated `_b` data — DROP COLUMN drops any rows' values, but the     ║
-- ║  default state (division='none', _b NULL) carries no information, so   ║
-- ║  no data loss occurs.                                                  ║
-- ║                                                                          ║
-- ║  If rows DO have division != 'none' (operator has configured divided   ║
-- ║  boxes), DROP COLUMN destroys that config. Capture it before running   ║
-- ║  this script if recoverability matters.                                ║
-- ║                                                                          ║
-- ║  AFTER RUNNING                                                          ║
-- ║  - Re-applying via `supabase db push` MUST work cleanly (idempotent    ║
-- ║    re-add of columns + constraints).                                   ║
-- ║  - Phase 2 schema (kds_screens, kds_grid_boxes minus the 5 columns)    ║
-- ║    is untouched. Existing rows preserved.                              ║
-- ║  - Verified end-to-end via T7 in PHASE-2.5-PLAN.md.                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop the cross-column invariant + per-column CHECK constraints first.
--    DROP COLUMN below would cascade these away anyway, but explicit DROPs
--    make the rollback intent obvious and survive future Postgres behavior
--    changes around constraint-on-column-drop semantics.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_division_slot_b_invariant,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_division_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_box_type_b_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop the 5 phase-2.5 columns. Phase 2 schema is otherwise untouched.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP COLUMN IF EXISTS division,
  DROP COLUMN IF EXISTS box_type_b,
  DROP COLUMN IF EXISTS square_menu_group_id_b,
  DROP COLUMN IF EXISTS aesthetic_image_id_b,
  DROP COLUMN IF EXISTS header_override_b;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Remove the migration's row from supabase_migrations.schema_migrations so
--    `supabase db push` re-applies the forward migration on next run.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '20260516025537';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Post-rollback verification (run as separate queries):
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema='public'
--      AND table_name='kds_grid_boxes'
--      AND column_name IN ('division','box_type_b','square_menu_group_id_b',
--                         'aesthetic_image_id_b','header_override_b');
--   -- expect: 0
--
--   SELECT count(*) FROM pg_constraint
--    WHERE conrelid = 'public.kds_grid_boxes'::regclass
--      AND conname IN ('kds_grid_boxes_division_check',
--                      'kds_grid_boxes_box_type_b_check',
--                      'kds_grid_boxes_division_slot_b_invariant');
--   -- expect: 0
--
--   SELECT version FROM supabase_migrations.schema_migrations
--    WHERE version = '20260516025537';
--   -- expect: 0 rows
--
--   -- Phase 2 untouched:
--   SELECT count(*) FROM public.kds_screens;
--   SELECT count(*) FROM public.kds_grid_boxes;
--   -- expect: unchanged from pre-rollback counts.
--
-- After verification, re-apply via `supabase db push` to confirm idempotency.
-- ─────────────────────────────────────────────────────────────────────────────
