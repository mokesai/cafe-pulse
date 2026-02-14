CREATE OR REPLACE FUNCTION public.list_old_policies()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(sub))
  INTO result
  FROM (
    SELECT tablename as tbl, policyname as pol
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename NOT IN ('tenants', 'tenant_memberships', 'profiles')
      AND policyname NOT LIKE 'tenant_%'
    ORDER BY tablename, policyname
  ) sub;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
