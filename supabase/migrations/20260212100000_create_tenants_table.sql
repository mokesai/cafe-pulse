-- Migration: create_tenants_table
-- Description: Create the tenants table for multi-tenant SaaS foundation.
-- Includes business config, Square credentials, email config, status columns,
-- tenant context functions, PostgREST pre-request hook, and RLS policies.

-- =============================================================================
-- 1. Create the tenants table
-- =============================================================================
CREATE TABLE public.tenants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  business_name text NOT NULL,
  business_address text,
  business_phone text,
  business_email text,
  business_hours jsonb,
  square_application_id text,
  square_access_token text,
  square_location_id text,
  square_environment text DEFAULT 'sandbox',
  square_merchant_id text,
  square_webhook_signature_key text,
  email_sender_name text,
  email_sender_address text,
  is_active boolean DEFAULT true,
  features jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================================
-- 2. Index on slug for fast lookups
-- =============================================================================
CREATE INDEX idx_tenants_slug ON public.tenants (slug);

-- =============================================================================
-- 3. updated_at trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_tenants_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_tenants_updated_at();

-- =============================================================================
-- 4. set_tenant_from_request() - PostgREST pre-request hook
--    Reads x-tenant-id header and sets session variable app.tenant_id
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_tenant_from_request()
RETURNS void AS $$
DECLARE
  header_tenant_id text;
BEGIN
  header_tenant_id := current_setting('request.header.x-tenant-id', true);
  IF header_tenant_id IS NOT NULL AND header_tenant_id != '' THEN
    PERFORM set_config('app.tenant_id', header_tenant_id, true);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 5. set_tenant_context(p_tenant_id uuid) - convenience function for direct RPC
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_tenant_context(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 6. Configure PostgREST pre-request hook
-- =============================================================================
DO $$ BEGIN
  ALTER ROLE authenticator SET pgrst.db_pre_request = 'set_tenant_from_request';
  NOTIFY pgrst, 'reload config';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'ALTER ROLE failed. Configure pre-request function manually via Supabase Dashboard > Database > Webhooks & Functions.';
END $$;

-- =============================================================================
-- 7. Enable RLS on tenants table
-- =============================================================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Allow reading non-sensitive tenant info. Exclude Square credentials via a view in Phase 30.
-- For now, application code MUST use select() with explicit columns, NOT select('*').
CREATE POLICY "Anyone can read active tenants"
  ON public.tenants FOR SELECT
  USING (is_active = true);

-- Note: Service role bypasses RLS entirely. Write policies for platform admins
-- will be added in Phase 60 (Platform Control Plane). No FOR ALL policy needed here.

-- =============================================================================
-- 8. Column comments for documentation
-- =============================================================================
COMMENT ON TABLE public.tenants IS 'Multi-tenant configuration table. Each row represents a tenant (cafe location) with business info, Square credentials, and feature flags.';
COMMENT ON COLUMN public.tenants.id IS 'Primary key, auto-generated UUID';
COMMENT ON COLUMN public.tenants.slug IS 'URL-friendly unique identifier for the tenant (e.g., "little-cafe-denver")';
COMMENT ON COLUMN public.tenants.name IS 'Display name for the tenant';
COMMENT ON COLUMN public.tenants.business_name IS 'Legal/official business name';
COMMENT ON COLUMN public.tenants.business_address IS 'Physical address of the business';
COMMENT ON COLUMN public.tenants.business_phone IS 'Business phone number';
COMMENT ON COLUMN public.tenants.business_email IS 'Business contact email';
COMMENT ON COLUMN public.tenants.business_hours IS 'JSON object describing operating hours';
COMMENT ON COLUMN public.tenants.square_application_id IS 'Square application ID for this tenant';
COMMENT ON COLUMN public.tenants.square_access_token IS 'Square access token (sensitive - exclude from public queries)';
COMMENT ON COLUMN public.tenants.square_location_id IS 'Square location ID for this tenant';
COMMENT ON COLUMN public.tenants.square_environment IS 'Square environment: sandbox or production';
COMMENT ON COLUMN public.tenants.square_merchant_id IS 'Square merchant ID';
COMMENT ON COLUMN public.tenants.square_webhook_signature_key IS 'Square webhook signature key for verifying webhook payloads';
COMMENT ON COLUMN public.tenants.email_sender_name IS 'Name used in outbound emails';
COMMENT ON COLUMN public.tenants.email_sender_address IS 'Email address used as sender for outbound emails';
COMMENT ON COLUMN public.tenants.is_active IS 'Whether the tenant is active. Inactive tenants are hidden from public queries.';
COMMENT ON COLUMN public.tenants.features IS 'JSON object of feature flags for this tenant';
COMMENT ON COLUMN public.tenants.created_at IS 'Timestamp when the tenant was created';
COMMENT ON COLUMN public.tenants.updated_at IS 'Timestamp when the tenant was last updated (auto-maintained by trigger)';
