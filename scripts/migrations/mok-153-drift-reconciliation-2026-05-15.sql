-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  MOK-153 — Migration drift reconciliation (ONE-TIME, DO NOT RE-RUN)      ║
-- ║                                                                          ║
-- ║  Spec:  https://linear.app/mokesai/issue/MOK-153                         ║
-- ║  Notes: .planning/mok-153/RECONCILIATION.md                              ║
-- ║                                                                          ║
-- ║  Aligns version IDs in `supabase_migrations.schema_migrations` with the  ║
-- ║  on-disk file timestamps for 4 migrations that were applied via the      ║
-- ║  Supabase MCP `apply_migration` tool (which generates its own version    ║
-- ║  at apply-time instead of using the file's timestamp prefix). These      ║
-- ║  are all pre-existing drift entries; they pre-date KDS v3 work.          ║
-- ║                                                                          ║
-- ║  Out of scope (intentional):                                             ║
-- ║    - kds_v3_phase_1 / kds_v3_phase_2 drift entries on cafe-pulse-dev.    ║
-- ║      These exist only on dev (KDS v3 hasn't shipped to staging/prod      ║
-- ║      yet — per the long-lived feature-branch model). They self-resolve  ║
-- ║      when kds-v3 → staging via `supabase db push` (which applies the    ║
-- ║      local file timestamps to staging+prod cleanly), or get wiped by    ║
-- ║      the phase rollback SQL if kds-v3 is abandoned. Deliberately not    ║
-- ║      part of this reconciliation so this PR has no kds-v3 surface area. ║
-- ║                                                                          ║
-- ║  EXECUTION RECORD                                                       ║
-- ║    - Executed against cafe-pulse-dev:  2026-05-15 ✓ verified            ║
-- ║    - Executed against cafe-pulse-prod: <after PR merges to staging>     ║
-- ║                                                                          ║
-- ║  Schema-migrations row structure (verified 2026-05-15):                 ║
-- ║    PRIMARY KEY (version), no FK constraints. UPDATE-in-place safe.      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────────────
-- DEV — cafe-pulse-dev (ettmabcwfhidcpapphgm)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- mok121_invoice_exception_severity
--   local file: 20260425191406_mok121_invoice_exception_severity.sql
UPDATE supabase_migrations.schema_migrations
   SET version = '20260425191406'
 WHERE version = '20260426011425'
   AND name    = 'mok121_invoice_exception_severity';

-- mok122_invoice_variance_history
--   local file: 20260426092709_mok122_invoice_variance_history.sql
UPDATE supabase_migrations.schema_migrations
   SET version = '20260426092709'
 WHERE version = '20260426152749'
   AND name    = 'mok122_invoice_variance_history';

-- mok123_exception_status_acknowledged
--   local file: 20260426095840_mok123_exception_status_acknowledged.sql
UPDATE supabase_migrations.schema_migrations
   SET version = '20260426095840'
 WHERE version = '20260426155853'
   AND name    = 'mok123_exception_status_acknowledged';

-- mok139_inventory_unit_cost_precision
--   local file: 20260502214725_mok139_inventory_unit_cost_precision.sql
UPDATE supabase_migrations.schema_migrations
   SET version = '20260502214725'
 WHERE version = '20260502214755'
   AND name    = 'mok139_inventory_unit_cost_precision';

COMMIT;

-- Verification (run separately):
--   SELECT version, name FROM supabase_migrations.schema_migrations
--    WHERE name IN ('mok121_invoice_exception_severity',
--                   'mok122_invoice_variance_history',
--                   'mok123_exception_status_acknowledged',
--                   'mok139_inventory_unit_cost_precision')
--    ORDER BY version;
--   -- expect (4 rows):
--   -- 20260425191406 mok121_invoice_exception_severity
--   -- 20260426092709 mok122_invoice_variance_history
--   -- 20260426095840 mok123_exception_status_acknowledged
--   -- 20260502214725 mok139_inventory_unit_cost_precision

-- ─────────────────────────────────────────────────────────────────────────────
-- PROD — cafe-pulse-prod (tjxarjzohmwqiqdruczv)
-- ─────────────────────────────────────────────────────────────────────────────
-- Different drift versions than dev (each env applied the migration at its
-- own wall-clock time via mcp), but the same 4 migration names + same local
-- file timestamps. Execute after the PR merges to staging.

BEGIN;

UPDATE supabase_migrations.schema_migrations
   SET version = '20260425191406'
 WHERE version = '20260426193647'
   AND name    = 'mok121_invoice_exception_severity';

UPDATE supabase_migrations.schema_migrations
   SET version = '20260426092709'
 WHERE version = '20260426193705'
   AND name    = 'mok122_invoice_variance_history';

UPDATE supabase_migrations.schema_migrations
   SET version = '20260426095840'
 WHERE version = '20260426193715'
   AND name    = 'mok123_exception_status_acknowledged';

UPDATE supabase_migrations.schema_migrations
   SET version = '20260502214725'
 WHERE version = '20260502220525'
   AND name    = 'mok139_inventory_unit_cost_precision';

COMMIT;
