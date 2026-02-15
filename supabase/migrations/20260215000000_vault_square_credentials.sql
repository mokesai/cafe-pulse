-- Migration: Move Square credentials to Vault with fallback support
-- Phase 40, Plan 01: Vault infrastructure for tenant-aware Square integration
--
-- This migration:
-- 1. Adds vault_secret_id columns to tenants table
-- 2. Creates SECURITY DEFINER functions for credential access
-- 3. Creates credential audit log table
-- 4. Adds merchant_id index for webhook resolution

-- =============================================================================
-- 1. Add vault_secret_id columns to tenants table
-- =============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS square_access_token_vault_id uuid REFERENCES vault.secrets(id),
  ADD COLUMN IF NOT EXISTS square_webhook_key_vault_id uuid REFERENCES vault.secrets(id);

-- =============================================================================
-- 2. Create internal credential reader (service_role only)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_square_credentials_internal(p_tenant_id uuid)
RETURNS TABLE(
  access_token text,
  application_id text,
  location_id text,
  environment text,
  merchant_id text,
  webhook_signature_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant record;
  v_access_token text;
  v_webhook_key text;
BEGIN
  -- Get tenant row
  SELECT t.square_application_id, t.square_location_id,
         t.square_environment, t.square_merchant_id,
         t.square_access_token_vault_id, t.square_webhook_key_vault_id,
         t.square_access_token AS plain_access_token,
         t.square_webhook_signature_key AS plain_webhook_key
  INTO v_tenant
  FROM public.tenants t
  WHERE t.id = p_tenant_id AND t.is_active = true;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Read access_token: Vault first, then plain column fallback
  IF v_tenant.square_access_token_vault_id IS NOT NULL THEN
    SELECT ds.decrypted_secret INTO v_access_token
    FROM vault.decrypted_secrets ds
    WHERE ds.id = v_tenant.square_access_token_vault_id;
  ELSE
    v_access_token := v_tenant.plain_access_token;
  END IF;

  -- Read webhook_signature_key: Vault first, then plain column fallback
  IF v_tenant.square_webhook_key_vault_id IS NOT NULL THEN
    SELECT ds.decrypted_secret INTO v_webhook_key
    FROM vault.decrypted_secrets ds
    WHERE ds.id = v_tenant.square_webhook_key_vault_id;
  ELSE
    v_webhook_key := v_tenant.plain_webhook_key;
  END IF;

  RETURN QUERY SELECT
    v_access_token,
    v_tenant.square_application_id,
    v_tenant.square_location_id,
    v_tenant.square_environment,
    v_tenant.square_merchant_id,
    v_webhook_key;
END;
$$;

-- Restrict to service_role and postgres
REVOKE ALL ON FUNCTION public.get_tenant_square_credentials_internal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_square_credentials_internal(uuid) TO service_role;

-- =============================================================================
-- 3. Create owner-facing credential reader (checks tenant_memberships)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_square_credentials(p_tenant_id uuid)
RETURNS TABLE(
  access_token text,
  application_id text,
  location_id text,
  environment text,
  merchant_id text,
  webhook_signature_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is tenant owner
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Access denied: owner role required for credential access';
  END IF;

  -- Delegate to internal function
  RETURN QUERY SELECT * FROM public.get_tenant_square_credentials_internal(p_tenant_id);
END;
$$;

-- =============================================================================
-- 4. Create credential writer (stores new secret in Vault)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_tenant_square_credentials(
  p_tenant_id uuid,
  p_access_token text DEFAULT NULL,
  p_webhook_signature_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vault_id uuid;
  v_existing_vault_id uuid;
BEGIN
  -- Verify caller is tenant owner
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
    AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Access denied: owner role required for credential management';
  END IF;

  -- Update access_token if provided
  IF p_access_token IS NOT NULL THEN
    -- Check for existing vault entry
    SELECT square_access_token_vault_id INTO v_existing_vault_id
    FROM public.tenants WHERE id = p_tenant_id;

    IF v_existing_vault_id IS NOT NULL THEN
      -- Update existing vault secret
      PERFORM vault.update_secret(v_existing_vault_id, p_access_token);

      -- Log the update
      INSERT INTO public.credential_audit_log (tenant_id, user_id, action, credential_type)
      VALUES (p_tenant_id, auth.uid(), 'update', 'square_access_token');
    ELSE
      -- Create new vault secret
      SELECT vault.create_secret(
        p_access_token,
        'square_access_token_' || p_tenant_id::text,
        'Square access token for tenant ' || p_tenant_id::text
      ) INTO v_vault_id;

      UPDATE public.tenants SET square_access_token_vault_id = v_vault_id WHERE id = p_tenant_id;

      -- Log the creation
      INSERT INTO public.credential_audit_log (tenant_id, user_id, action, credential_type)
      VALUES (p_tenant_id, auth.uid(), 'create', 'square_access_token');
    END IF;
  END IF;

  -- Update webhook_signature_key if provided
  IF p_webhook_signature_key IS NOT NULL THEN
    SELECT square_webhook_key_vault_id INTO v_existing_vault_id
    FROM public.tenants WHERE id = p_tenant_id;

    IF v_existing_vault_id IS NOT NULL THEN
      -- Update existing vault secret
      PERFORM vault.update_secret(v_existing_vault_id, p_webhook_signature_key);

      -- Log the update
      INSERT INTO public.credential_audit_log (tenant_id, user_id, action, credential_type)
      VALUES (p_tenant_id, auth.uid(), 'update', 'square_webhook_signature_key');
    ELSE
      -- Create new vault secret
      SELECT vault.create_secret(
        p_webhook_signature_key,
        'square_webhook_key_' || p_tenant_id::text,
        'Square webhook signature key for tenant ' || p_tenant_id::text
      ) INTO v_vault_id;

      UPDATE public.tenants SET square_webhook_key_vault_id = v_vault_id WHERE id = p_tenant_id;

      -- Log the creation
      INSERT INTO public.credential_audit_log (tenant_id, user_id, action, credential_type)
      VALUES (p_tenant_id, auth.uid(), 'create', 'square_webhook_signature_key');
    END IF;
  END IF;
END;
$$;

-- =============================================================================
-- 5. Create credential audit log table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.credential_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  credential_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS (no SELECT policies - service_role only reads audit logs)
ALTER TABLE public.credential_audit_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 6. Create merchant_id index for webhook resolution
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tenants_square_merchant_id
  ON public.tenants (square_merchant_id)
  WHERE square_merchant_id IS NOT NULL;
