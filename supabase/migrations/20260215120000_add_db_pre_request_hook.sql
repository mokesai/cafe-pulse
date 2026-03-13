-- Migration: Add db-pre-request hook to set tenant context from header
-- Phase: 40 (gap closure)
-- Description: Creates a PostgreSQL hook function that reads the x-tenant-id header
-- and calls set_tenant_context() to enable tenant-scoped RLS filtering.

-- db-pre-request hook function
-- This function is automatically called before each request to set the tenant context
-- from the x-tenant-id header passed by createTenantClient()
CREATE OR REPLACE FUNCTION public.db_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tenant_id_header text;
BEGIN
  -- Read x-tenant-id header from current request
  tenant_id_header := current_setting('request.headers', true)::json->>'x-tenant-id';

  -- If header is present, set the tenant context
  IF tenant_id_header IS NOT NULL AND tenant_id_header != '' THEN
    PERFORM set_config('app.tenant_id', tenant_id_header, false);
  END IF;
END;
$$;

-- Grant execute permission to authenticated and anon roles
GRANT EXECUTE ON FUNCTION public.db_pre_request() TO authenticated, anon;

-- Add comment
COMMENT ON FUNCTION public.db_pre_request() IS
  'Hook function called before each database request. Reads x-tenant-id header and sets app.tenant_id session variable for RLS policies.';
