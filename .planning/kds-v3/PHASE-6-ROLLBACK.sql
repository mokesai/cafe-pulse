-- KDS v3 phase 6 — ROLLBACK
--
-- Reverses migration: 20260517214944_kds_v3_phase_6_renderer.sql
-- Spec: https://linear.app/mokesai/issue/MOK-158
-- Plan: .planning/kds-v3/PHASE-6-PLAN.md
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  WHEN TO RUN                                                             ║
-- ║                                                                          ║
-- ║  Only when abandoning KDS v3 phase 6 OR rehearsing rollback during      ║
-- ║  phase 6 verification (T12). Lives outside supabase/migrations/ so it   ║
-- ║  does NOT auto-apply via `supabase db push`. Execute manually via the   ║
-- ║  Supabase SQL editor, psql, or the mcp execute_sql tool.                ║
-- ║                                                                          ║
-- ║  Drops the 10 new columns + 11 phase-6 CHECK constraints on             ║
-- ║  kds_grid_boxes. Phases 1-5 schema is untouched. The existing           ║
-- ║  phase-2.5 kds_grid_boxes_division_slot_b_invariant CHECK still         ║
-- ║  references box_type_b + the original phase-2.5 slot-B content          ║
-- ║  columns; it remains intact through rollback.                           ║
-- ║                                                                          ║
-- ║  AFTER RUNNING                                                          ║
-- ║  - Re-applying the forward migration via `supabase db push` MUST work   ║
-- ║    cleanly (columns + CHECKs + backfill re-installed).                  ║
-- ║  - Any phase-6 code that reads layout_mode / price_display_mode /       ║
-- ║    density / title_size / title_align will get column-does-not-exist    ║
-- ║    errors. The expectation is that the rollback is paired with a code   ║
-- ║    revert.                                                              ║
-- ║  - Seed-script expansion (T0) is NOT part of rollback — its effect      ║
-- ║    lives in Square sandbox + the local mirror, which a code rollback   ║
-- ║    doesn't touch.                                                       ║
-- ║  - Verified end-to-end via T12 in PHASE-6-PLAN.md.                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the cross-slot-B formatting invariant first — it references the
-- columns we're about to remove.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_slot_b_formatting_invariant;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the per-column enum CHECKs (10 total: 5 slot-A + 5 slot-B).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_layout_mode_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_price_display_mode_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_density_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_title_size_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_title_align_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_layout_mode_b_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_price_display_mode_b_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_density_b_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_title_size_b_check,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_title_align_b_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the 10 new columns (5 slot-A + 5 slot-B).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP COLUMN IF EXISTS layout_mode,
  DROP COLUMN IF EXISTS price_display_mode,
  DROP COLUMN IF EXISTS density,
  DROP COLUMN IF EXISTS title_size,
  DROP COLUMN IF EXISTS title_align,
  DROP COLUMN IF EXISTS layout_mode_b,
  DROP COLUMN IF EXISTS price_display_mode_b,
  DROP COLUMN IF EXISTS density_b,
  DROP COLUMN IF EXISTS title_size_b,
  DROP COLUMN IF EXISTS title_align_b;

-- ─────────────────────────────────────────────────────────────────────────────
-- Mark the phase-6 migration row as not-applied so `supabase db push` will
-- re-run it on the next forward apply. The schema_migrations primary key
-- is the version timestamp from the migration filename.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM supabase_migrations.schema_migrations
  WHERE version = '20260517214944';

COMMIT;
