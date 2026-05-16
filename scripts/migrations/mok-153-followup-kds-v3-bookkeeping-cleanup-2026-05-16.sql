-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  MOK-153 follow-up — KDS v3 bookkeeping cleanup (ONE-TIME, DO NOT RE-RUN)║
-- ║                                                                          ║
-- ║  Spec: https://linear.app/mokesai/issue/MOK-153                          ║
-- ║  Notes: .planning/mok-153/RECONCILIATION.md                              ║
-- ║                                                                          ║
-- ║  After the original MOK-153 reconciliation (PRs #115 + #116), running   ║
-- ║  `supabase db push --dry-run` from the `staging` branch (which points  ║
-- ║  at cafe-pulse-dev) still surfaced 4 "remote migration versions not    ║
-- ║  found in local migrations directory" rows — all KDS v3 work that was  ║
-- ║  applied to dev via mcp `apply_migration` during phase 1 + phase 2     ║
-- ║  development. These were intentionally left untouched by the first     ║
-- ║  reconciliation (per "no kds-v3 commits to staging" rule).             ║
-- ║                                                                          ║
-- ║  This script drops just the schema_migrations bookkeeping rows for     ║
-- ║  those 4 entries. The kds_screens / kds_grid_boxes TABLES and DATA     ║
-- ║  on dev are preserved.                                                 ║
-- ║                                                                          ║
-- ║  Net effect:                                                            ║
-- ║    - On `staging` branch (no kds-v3 files locally): db push --dry-run  ║
-- ║      reports zero drift. ✓                                             ║
-- ║    - On `kds-v3` branch (has the files locally): db push will think    ║
-- ║      the migrations need to be applied; the SQL is idempotent          ║
-- ║      (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS / DROP        ║
-- ║      CONSTRAINT IF EXISTS), so the tables remain unchanged and the    ║
-- ║      schema_migrations rows get re-added with the local file          ║
-- ║      timestamps. KDS v3 self-heals into drift-free state on its own   ║
-- ║      branch.                                                            ║
-- ║    - Rollback path unchanged: PHASE-{1,2}-ROLLBACK.sql use DROP TABLE  ║
-- ║      IF EXISTS, so missing schema_migrations rows don't matter.       ║
-- ║                                                                          ║
-- ║  Only applies to cafe-pulse-dev. KDS v3 has not shipped to prod.       ║
-- ║                                                                          ║
-- ║  EXECUTION RECORD                                                       ║
-- ║    - Executed against cafe-pulse-dev: 2026-05-16 ✓ verified            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

BEGIN;

DELETE FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260507011219', '20260507033640', '20260512015358', '20260513023650')
   AND name    IN (
     'kds_v3_phase_1_square_menu_mirror',
     'kds_v3_phase_2_screen_designer',
     'kds_v3_phase_2_grid_max_24'
   );

COMMIT;

-- Verification (run separately):
--
--   SELECT count(*) FROM supabase_migrations.schema_migrations
--    WHERE name IN ('kds_v3_phase_1_square_menu_mirror',
--                   'kds_v3_phase_2_screen_designer',
--                   'kds_v3_phase_2_grid_max_24');
--   -- expect: 0
--
--   SELECT 'kds_screens' AS t, count(*) FROM public.kds_screens
--   UNION ALL
--   SELECT 'kds_grid_boxes', count(*) FROM public.kds_grid_boxes;
--   -- expect: rows present (data preserved)
