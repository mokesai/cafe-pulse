-- Migration: Fix tenant context for connection pooling
-- Phase: 40 (gap closure - admin routes)
-- Description: Updates set_tenant_context to use session-wide config and grants
-- execute permissions. This fixes issues with connection pooling where session
-- variables were lost between RPC calls and queries.

-- =============================================================================
-- 1. Update set_tenant_context to use session-wide config (not transaction-local)
-- =============================================================================
-- Original had set_config(..., true) which made the setting transaction-local.
-- With connection pooling, each RPC call and query can use different connections,
-- so transaction-local settings don't work. Changed to false for session-wide.

CREATE OR REPLACE FUNCTION public.set_tenant_context(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  -- false = session-wide (persists across queries in same session)
  -- true would be transaction-local (lost after RPC completes)
  PERFORM set_config('app.tenant_id', p_tenant_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 2. Grant execute permissions to authenticated and anon roles
-- =============================================================================
-- The function needs explicit GRANT even though it's SECURITY DEFINER

GRANT EXECUTE ON FUNCTION public.set_tenant_context(uuid) TO authenticated, anon;

-- Add helpful comment
COMMENT ON FUNCTION public.set_tenant_context(uuid) IS
  'Sets app.tenant_id session variable for RLS policies. Uses session-wide scope (not transaction-local) to work with connection pooling. Called by createTenantClient() via RPC.';
