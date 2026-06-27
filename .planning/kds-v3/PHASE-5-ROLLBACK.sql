-- KDS v3 phase 5 — ROLLBACK
--
-- Reverses migration: 20260517164558_kds_v3_phase_5_display_overrides.sql
-- Spec: https://linear.app/mokesai/issue/MOK-157
-- Plan: .planning/kds-v3/PHASE-5-PLAN.md
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  WHEN TO RUN                                                             ║
-- ║                                                                          ║
-- ║  Only when abandoning KDS v3 phase 5 OR rehearsing rollback during       ║
-- ║  phase 5 verification (T7). Lives outside supabase/migrations/ so it     ║
-- ║  does NOT auto-apply via `supabase db push`. Execute manually via the   ║
-- ║  Supabase SQL editor, psql, or the mcp execute_sql tool.               ║
-- ║                                                                          ║
-- ║  Drops the kds_display_overrides table cleanly. Phase 1-4 schema is     ║
-- ║  untouched. No other table FKs to kds_display_overrides (phase 6's     ║
-- ║  renderer will read it but won't reference it via FK), so DROP TABLE   ║
-- ║  is clean — no CASCADE needed.                                         ║
-- ║                                                                          ║
-- ║  AFTER RUNNING                                                          ║
-- ║  - Re-applying via `supabase db push` MUST work cleanly (table +       ║
-- ║    constraints + RLS re-installed).                                    ║
-- ║  - kds_aesthetic_images (phase 4) is unaffected — the FK from         ║
-- ║    kds_display_overrides went away with the table; no cleanup needed  ║
-- ║    on the image side.                                                   ║
-- ║  - Existing screens / boxes / menu mirror are untouched.               ║
-- ║  - Verified end-to-end via T7 in PHASE-5-PLAN.md.                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop RLS policies (explicit even though DROP TABLE cascades them).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tenant_staff_select_kds_display_overrides" ON public.kds_display_overrides;
DROP POLICY IF EXISTS "tenant_admin_insert_kds_display_overrides" ON public.kds_display_overrides;
DROP POLICY IF EXISTS "tenant_admin_update_kds_display_overrides" ON public.kds_display_overrides;
DROP POLICY IF EXISTS "tenant_admin_delete_kds_display_overrides" ON public.kds_display_overrides;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop the table. Cross-column / per-column CHECKs + UNIQUE + FK on
--    alt_image_aesthetic_image_id all go with it.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.kds_display_overrides;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Remove the migration's row from supabase_migrations.schema_migrations so
--    `supabase db push` re-applies the forward migration on next run.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '20260517164558';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Post-rollback verification (run as separate queries):
--
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name='kds_display_overrides';
--   -- expect: 0
--
--   SELECT version FROM supabase_migrations.schema_migrations
--    WHERE version = '20260517164558';
--   -- expect: 0 rows
--
--   -- Phase 1-4 unaffected:
--   SELECT count(*) FROM public.kds_screens;
--   SELECT count(*) FROM public.kds_grid_boxes;
--   SELECT count(*) FROM public.kds_aesthetic_images;
--   -- expect: unchanged from pre-rollback counts.
--
-- After verification, re-apply via `supabase db push` to confirm idempotency.
-- ─────────────────────────────────────────────────────────────────────────────
