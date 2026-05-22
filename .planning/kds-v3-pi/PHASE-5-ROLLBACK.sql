-- KDS Pi Deployment phase 5 — ROLLBACK
--
-- Reverses migration: 20260522230507_kds_v3_pi_p5_device_screen_ids.sql
-- Spec: https://linear.app/mokesai/issue/MOK-161
-- Plan: .planning/kds-v3-pi/PHASE-5-PLAN.md
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  WHEN TO RUN                                                             ║
-- ║                                                                          ║
-- ║  Only when abandoning Pi Phase 5 OR rehearsing rollback during phase 5  ║
-- ║  verification (T5). Lives outside supabase/migrations/ so it does NOT   ║
-- ║  auto-apply via `supabase db push`.                                      ║
-- ║                                                                          ║
-- ║  Drops the two new FKs + two new UUID columns. Legacy `screen_1` /     ║
-- ║  `screen_2` text columns are untouched (they existed before this        ║
-- ║  phase). Existing device rows survive with both UUID columns gone.     ║
-- ║                                                                          ║
-- ║  AFTER RUNNING                                                          ║
-- ║  - Re-applying via `supabase db push` MUST work cleanly (columns +     ║
-- ║    FKs re-installed; existing rows get NULL UUIDs again).             ║
-- ║  - Pi-side config routes that reference screen_*_id will throw at     ║
-- ║    SELECT time. The expectation is rollback is paired with a code     ║
-- ║    revert.                                                              ║
-- ║  - Verified via T5 in PHASE-5-PLAN.md.                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop FK constraints first (they reference the columns we're about to drop).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_devices
  DROP CONSTRAINT IF EXISTS kds_devices_screen_1_id_fkey,
  DROP CONSTRAINT IF EXISTS kds_devices_screen_2_id_fkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the two new columns.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_devices
  DROP COLUMN IF EXISTS screen_1_id,
  DROP COLUMN IF EXISTS screen_2_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Delete the schema_migrations row so `supabase db push` re-applies cleanly.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM supabase_migrations.schema_migrations
  WHERE version = '20260522230507';

COMMIT;
