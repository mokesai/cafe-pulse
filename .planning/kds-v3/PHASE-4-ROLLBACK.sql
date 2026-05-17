-- KDS v3 phase 4 — ROLLBACK (table + FKs only)
--
-- Reverses migration: 20260517025818_kds_v3_phase_4_aesthetic_images.sql
-- Spec: https://linear.app/mokesai/issue/MOK-156
-- Plan: .planning/kds-v3/PHASE-4-PLAN.md
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  WHEN TO RUN                                                             ║
-- ║                                                                          ║
-- ║  Only when abandoning KDS v3 phase 4 OR rehearsing rollback during       ║
-- ║  phase 4 verification (T10). Lives outside supabase/migrations/ so it    ║
-- ║  does NOT auto-apply via `supabase db push`. Execute manually via       ║
-- ║  Supabase SQL editor, psql, or the mcp execute_sql tool.               ║
-- ║                                                                          ║
-- ║  IMPORTANT: this rollback does NOT drop the Storage bucket               ║
-- ║  `kds-v3-aesthetic-images` (set up in the T3 migration). Per the        ║
-- ║  MOK-156 decision, the bucket persists across rollback:                ║
-- ║   - It's free until populated.                                         ║
-- ║   - Any uploaded images are preserved for recovery if rollback is for  ║
-- ║     a transient issue.                                                  ║
-- ║   - If you want to drop the bucket too (e.g. permanently abandoning   ║
-- ║     phase 4), do it manually via Supabase Studio.                      ║
-- ║                                                                          ║
-- ║  AFTER RUNNING                                                          ║
-- ║  - Re-applying via `supabase db push` MUST work cleanly (idempotent    ║
-- ║    re-add of table + FKs + RLS).                                       ║
-- ║  - Phase 2/2.5/3 schema is untouched. The aesthetic_image_id and       ║
-- ║    aesthetic_image_id_b columns on kds_grid_boxes were added in       ║
-- ║    phase 2 + 2.5; this rollback only removes the FKs on them, not     ║
-- ║    the columns themselves.                                              ║
-- ║  - Existing kds_grid_boxes rows: any non-null aesthetic_image_id /    ║
-- ║    _b values that pointed at kds_aesthetic_images rows are now        ║
-- ║    dangling text uuids with no referential integrity. Phase-6's       ║
-- ║    renderer will treat them as missing-reference (same as a soft-    ║
-- ║    deleted image binding) until they get re-bound after re-apply.    ║
-- ║  - Verified end-to-end via T10 in PHASE-4-PLAN.md.                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop the FKs from kds_grid_boxes first. Without these, dropping the
--    kds_aesthetic_images table cleanly is possible (otherwise CASCADE would
--    be required, which we want to avoid for explicitness).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kds_grid_boxes
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_aesthetic_image_fk,
  DROP CONSTRAINT IF EXISTS kds_grid_boxes_aesthetic_image_b_fk;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop RLS policies (explicit even though DROP TABLE cascades them).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tenant_staff_select_kds_aesthetic_images" ON public.kds_aesthetic_images;
DROP POLICY IF EXISTS "tenant_admin_insert_kds_aesthetic_images" ON public.kds_aesthetic_images;
DROP POLICY IF EXISTS "tenant_admin_update_kds_aesthetic_images" ON public.kds_aesthetic_images;
DROP POLICY IF EXISTS "tenant_admin_delete_kds_aesthetic_images" ON public.kds_aesthetic_images;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Drop the table. The cross-column CHECK + per-column CHECKs go with it.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.kds_aesthetic_images;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Remove the migration's row from supabase_migrations.schema_migrations so
--    `supabase db push` re-applies the forward migration on next run.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '20260517025818';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Post-rollback verification (run as separate queries):
--
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name='kds_aesthetic_images';
--   -- expect: 0
--
--   SELECT count(*) FROM pg_constraint
--    WHERE conrelid = 'public.kds_grid_boxes'::regclass
--      AND conname IN ('kds_grid_boxes_aesthetic_image_fk',
--                      'kds_grid_boxes_aesthetic_image_b_fk');
--   -- expect: 0
--
--   SELECT version FROM supabase_migrations.schema_migrations
--    WHERE version = '20260517025818';
--   -- expect: 0 rows
--
--   -- Phase 2+ tables untouched:
--   SELECT count(*) FROM public.kds_screens;
--   SELECT count(*) FROM public.kds_grid_boxes;
--   -- expect: unchanged from pre-rollback counts.
--
--   -- Storage bucket still exists:
--   SELECT count(*) FROM storage.buckets WHERE id = 'kds-v3-aesthetic-images';
--   -- expect: 1 (bucket persists per MOK-156 decision)
--
-- After verification, re-apply via `supabase db push` to confirm idempotency.
-- ─────────────────────────────────────────────────────────────────────────────
