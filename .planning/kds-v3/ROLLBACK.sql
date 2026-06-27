-- KDS v3 phase 1 — ROLLBACK
--
-- Reverses migration: 20260507010911_kds_v3_phase_1_square_menu_mirror.sql
-- Spec: https://linear.app/mokesai/issue/MOK-151
-- Plan: .planning/kds-v3/PHASE-1-PLAN.md
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  WHEN TO RUN                                                             ║
-- ║                                                                          ║
-- ║  Only when abandoning KDS v3 phase 1 OR rehearsing rollback during       ║
-- ║  phase 1 verification (T9). This file lives outside supabase/migrations/ ║
-- ║  so it does NOT auto-apply via `npm run db:migrate`. Execute manually    ║
-- ║  via Supabase SQL editor or `psql`.                                      ║
-- ║                                                                          ║
-- ║  Safe to run while phase 1 tables exist but are not yet referenced by    ║
-- ║  user-facing code (i.e. before phases 2-7 land). After phase 7 cutover,  ║
-- ║  rollback is a separate decision (data dependencies, live UI).           ║
-- ║                                                                          ║
-- ║  AFTER RUNNING                                                           ║
-- ║  - Re-applying the forward migration via `npm run db:migrate` MUST work  ║
-- ║    cleanly (tables re-created, policies re-installed, no manual repair). ║
-- ║  - Verified end-to-end via T9 in PHASE-1-PLAN.md.                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop RLS policies (must drop before tables to keep dependency order
--    explicit, even though DROP TABLE would cascade them).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_categories"        ON public.square_menu_categories;
DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_categories"        ON public.square_menu_categories;
DROP POLICY IF EXISTS "tenant_admin_update_square_menu_categories"        ON public.square_menu_categories;
DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_categories"        ON public.square_menu_categories;

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_items"             ON public.square_menu_items;
DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_items"             ON public.square_menu_items;
DROP POLICY IF EXISTS "tenant_admin_update_square_menu_items"             ON public.square_menu_items;
DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_items"             ON public.square_menu_items;

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_item_variations"   ON public.square_menu_item_variations;
DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_item_variations"   ON public.square_menu_item_variations;
DROP POLICY IF EXISTS "tenant_admin_update_square_menu_item_variations"   ON public.square_menu_item_variations;
DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_item_variations"   ON public.square_menu_item_variations;

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_item_categories"   ON public.square_menu_item_categories;
DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_item_categories"   ON public.square_menu_item_categories;
DROP POLICY IF EXISTS "tenant_admin_update_square_menu_item_categories"   ON public.square_menu_item_categories;
DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_item_categories"   ON public.square_menu_item_categories;

DROP POLICY IF EXISTS "tenant_staff_select_square_menu_sync_state"        ON public.square_menu_sync_state;
DROP POLICY IF EXISTS "tenant_admin_insert_square_menu_sync_state"        ON public.square_menu_sync_state;
DROP POLICY IF EXISTS "tenant_admin_update_square_menu_sync_state"        ON public.square_menu_sync_state;
DROP POLICY IF EXISTS "tenant_admin_delete_square_menu_sync_state"        ON public.square_menu_sync_state;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop tables in dependency order (FK from variations → items, so drop
--    variations first; the rest are independent so order is cosmetic).
--    DROP TABLE removes its indexes automatically.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.square_menu_item_variations;
DROP TABLE IF EXISTS public.square_menu_item_categories;
DROP TABLE IF EXISTS public.square_menu_items;
DROP TABLE IF EXISTS public.square_menu_categories;
DROP TABLE IF EXISTS public.square_menu_sync_state;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Remove the migration's row from supabase_migrations.schema_migrations so
--    `supabase db push` (and `npm run db:migrate`) re-applies the forward
--    migration on next run. Without this, the migration history says it's
--    already applied and re-applying is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '20260507010911';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Post-rollback verification (run as separate queries):
--
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name LIKE 'square_menu_%';
--   -- expect: 0
--
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname = 'public' AND tablename LIKE 'square_menu_%';
--   -- expect: 0
--
--   SELECT version FROM supabase_migrations.schema_migrations
--    WHERE version = '20260507010911';
--   -- expect: 0 rows
--
-- After verification, re-apply via `npm run db:migrate` from staging branch
-- to confirm idempotency.
-- ─────────────────────────────────────────────────────────────────────────────
