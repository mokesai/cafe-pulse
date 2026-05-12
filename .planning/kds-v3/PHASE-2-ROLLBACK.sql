-- KDS v3 phase 2 — ROLLBACK
--
-- Reverses migration: 20260512015358_kds_v3_phase_2_screen_designer.sql
-- Spec: https://linear.app/mokesai/issue/MOK-152
-- Plan: .planning/kds-v3/PHASE-2-PLAN.md
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  WHEN TO RUN                                                             ║
-- ║                                                                          ║
-- ║  Only when abandoning KDS v3 phase 2 OR rehearsing rollback during       ║
-- ║  phase 2 verification (T9). Lives outside supabase/migrations/ so it     ║
-- ║  does NOT auto-apply via `npm run db:migrate`. Execute manually via      ║
-- ║  Supabase SQL editor or `psql`.                                          ║
-- ║                                                                          ║
-- ║  Safe to run while phase 2 tables exist but are not yet referenced by    ║
-- ║  user-facing render code (i.e. before phase 6 wires up `/kds/*` to       ║
-- ║  read from these tables). After phase 7 cuts over, rollback is a         ║
-- ║  separate decision (live UI dependencies).                               ║
-- ║                                                                          ║
-- ║  AFTER RUNNING                                                           ║
-- ║  - Re-applying the forward migration via `npm run db:migrate` MUST work  ║
-- ║    cleanly (tables re-created, policies re-installed, no manual repair). ║
-- ║  - Verified end-to-end via T9 in PHASE-2-PLAN.md.                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop RLS policies (explicit even though DROP TABLE would cascade).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tenant_staff_select_kds_screens"     ON public.kds_screens;
DROP POLICY IF EXISTS "tenant_admin_insert_kds_screens"     ON public.kds_screens;
DROP POLICY IF EXISTS "tenant_admin_update_kds_screens"     ON public.kds_screens;
DROP POLICY IF EXISTS "tenant_admin_delete_kds_screens"     ON public.kds_screens;

DROP POLICY IF EXISTS "tenant_staff_select_kds_grid_boxes"  ON public.kds_grid_boxes;
DROP POLICY IF EXISTS "tenant_admin_insert_kds_grid_boxes"  ON public.kds_grid_boxes;
DROP POLICY IF EXISTS "tenant_admin_update_kds_grid_boxes"  ON public.kds_grid_boxes;
DROP POLICY IF EXISTS "tenant_admin_delete_kds_grid_boxes"  ON public.kds_grid_boxes;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop tables in dependency order (boxes → screens; FK CASCADE handles it
--    but explicit deletes keep the rollback intent obvious).
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.kds_grid_boxes;
DROP TABLE IF EXISTS public.kds_screens;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Remove the migration's row from supabase_migrations.schema_migrations so
--    `npm run db:migrate` re-applies the forward migration on next run.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '20260512015358';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Post-rollback verification (run as separate queries):
--
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name IN ('kds_screens','kds_grid_boxes');
--   -- expect: 0
--
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('kds_screens','kds_grid_boxes');
--   -- expect: 0
--
--   SELECT version FROM supabase_migrations.schema_migrations
--    WHERE version = '20260512015358';
--   -- expect: 0 rows
--
-- After verification, re-apply via `npm run db:migrate` to confirm idempotency.
-- ─────────────────────────────────────────────────────────────────────────────
