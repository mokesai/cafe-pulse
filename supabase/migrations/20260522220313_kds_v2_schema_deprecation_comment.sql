-- KDS v3 phase 7 — annotate v2 tables as deprecated
--
-- Spec: https://linear.app/mokesai/issue/MOK-160
-- Plan: .planning/kds-v3/PHASE-7-PLAN.md (T6)
--
-- v2 admin + public routes + components were deleted in T1–T4. The
-- underlying tables remain in the schema for one more phase (7.5) as a
-- safety net before the structural DROP. This migration just attaches a
-- DEPRECATED comment so anyone running `\dt+` or schema introspection
-- sees the signal.
--
-- No structural change — purely metadata. No rollback artifact needed;
-- the comment is trivially re-set if reverted.

BEGIN;

COMMENT ON TABLE public.kds_categories IS
  'DEPRECATED — KDS v2 schema (phase 7 cutover, MOK-160). No callers; drop in phase 7.5.';

COMMENT ON TABLE public.kds_menu_items IS
  'DEPRECATED — KDS v2 schema (phase 7 cutover, MOK-160). No callers; drop in phase 7.5.';

COMMENT ON TABLE public.kds_settings IS
  'DEPRECATED — KDS v2 schema (phase 7 cutover, MOK-160). No callers; drop in phase 7.5.';

COMMENT ON TABLE public.kds_images IS
  'DEPRECATED — KDS v2 schema (phase 7 cutover, MOK-160). No callers; drop in phase 7.5.';

COMMIT;
