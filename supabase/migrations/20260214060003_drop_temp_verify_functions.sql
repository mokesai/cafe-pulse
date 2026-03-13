-- Cleanup: Drop temporary verification functions created during Phase 30 verification
DROP FUNCTION IF EXISTS public.verify_rls_policies();
DROP FUNCTION IF EXISTS public.list_old_policies();
