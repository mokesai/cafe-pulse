-- KDS v3 phase 6.5 — ROLLBACK
--
-- Reverses migration: 20260520125705_kds_v3_phase_6_5_published_snapshots.sql
-- Spec: https://linear.app/mokesai/issue/MOK-159
-- Plan: .planning/kds-v3/PHASE-6.5-PLAN.md
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  WHEN TO RUN                                                             ║
-- ║                                                                          ║
-- ║  Only when abandoning KDS v3 phase 6.5 OR rehearsing rollback during    ║
-- ║  phase 6.5 verification (T8). Lives outside supabase/migrations/ so it  ║
-- ║  does NOT auto-apply via `supabase db push`. Execute manually via the   ║
-- ║  Supabase SQL editor, psql, or the mcp execute_sql tool.                ║
-- ║                                                                          ║
-- ║  Drops both snapshot tables (CASCADE for FK), the `draft_updated_at`    ║
-- ║  column on kds_screens, and the four emphasized-variation columns on    ║
-- ║  kds_grid_boxes (plus the slot-B gate CHECK). Phase 1-6 schema is       ║
-- ║  untouched. After rollback, Pi devices will need to read from the      ║
-- ║  draft tables — render-fetch source selection (T3) must support a      ║
-- ║  graceful fallback when the snapshot tables are absent.                ║
-- ║                                                                          ║
-- ║  AFTER RUNNING                                                          ║
-- ║  - Re-applying via `supabase db push` MUST work cleanly (snapshots +   ║
-- ║    columns + constraints + defensive copy re-installed).               ║
-- ║  - Any phase-6.5 code that reads from kds_published_* tables will get ║
-- ║    a relation-does-not-exist error. The expectation is that rollback   ║
-- ║    is paired with a code revert.                                        ║
-- ║  - Verified end-to-end via T8 in PHASE-6.5-PLAN.md.                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the publish + discard-draft PL/pgSQL functions (T2 migration). They
-- reference both the draft + snapshot tables; safe to drop before either
-- table is touched.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.publish_kds_screen(uuid, uuid);
DROP FUNCTION IF EXISTS public.discard_kds_screen_draft(uuid, uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop snapshot tables — CASCADE handles the FK back to themselves
-- (published_grid_boxes.screen_id → published_screens.id).
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.kds_published_grid_boxes CASCADE;
DROP TABLE IF EXISTS public.kds_published_screens CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the slot-B gate CHECK before the columns it references.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_emphasized_variation_b_gated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop emphasis columns on kds_grid_boxes (4 total).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP COLUMN IF EXISTS emphasized_variation_name,
  DROP COLUMN IF EXISTS emphasized_variation_explicit_none,
  DROP COLUMN IF EXISTS emphasized_variation_name_b,
  DROP COLUMN IF EXISTS emphasized_variation_explicit_none_b;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the draft tick column on kds_screens.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_screens
  DROP COLUMN IF EXISTS draft_updated_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- Delete the schema_migrations rows so `supabase db push` re-applies cleanly.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM supabase_migrations.schema_migrations
  WHERE version IN ('20260520125705', '20260520130424');

COMMIT;
