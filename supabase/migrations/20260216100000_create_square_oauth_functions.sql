-- Migration: Create Square OAuth Vault storage functions
-- Purpose: Support Square OAuth flow for tenant onboarding
-- Functions: store_square_credentials, store_square_credentials_internal, get_square_credentials_for_oauth

-- ==============================================================================
-- Function: store_square_credentials
-- Purpose: Platform admin-accessible function to store Square credentials in Vault
-- Security: SECURITY DEFINER with platform_admins check
-- ==============================================================================

CREATE OR REPLACE FUNCTION store_square_credentials(
  p_tenant_id UUID,
  p_environment TEXT,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_merchant_id TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
  v_access_token_name TEXT;
  v_refresh_token_name TEXT;
  v_merchant_id_name TEXT;
  v_access_token_vault_id UUID;
BEGIN
  -- Validate environment parameter
  IF p_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'Invalid environment: %. Must be sandbox or production.', p_environment;
  END IF;

  -- Verify caller is platform admin
  IF NOT EXISTS (
    SELECT 1 FROM platform_admins
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: only platform admins can store Square credentials';
  END IF;

  -- Construct Vault secret names
  v_access_token_name := 'square_' || p_environment || '_access_token_' || p_tenant_id::text;
  v_refresh_token_name := 'square_' || p_environment || '_refresh_token_' || p_tenant_id::text;
  v_merchant_id_name := 'square_' || p_environment || '_merchant_id_' || p_tenant_id::text;

  -- Check if secrets already exist, update if yes, create if no
  -- Access token
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_access_token_name) THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = v_access_token_name),
      p_access_token,
      'Square access token for ' || p_environment
    );
  ELSE
    v_access_token_vault_id := vault.create_secret(
      p_access_token,
      v_access_token_name,
      'Square access token for ' || p_environment
    );
  END IF;

  -- Refresh token
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_refresh_token_name) THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = v_refresh_token_name),
      p_refresh_token,
      'Square refresh token for ' || p_environment
    );
  ELSE
    PERFORM vault.create_secret(
      p_refresh_token,
      v_refresh_token_name,
      'Square refresh token for ' || p_environment
    );
  END IF;

  -- Merchant ID
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_merchant_id_name) THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = v_merchant_id_name),
      p_merchant_id,
      'Square merchant ID for ' || p_environment
    );
  ELSE
    PERFORM vault.create_secret(
      p_merchant_id,
      v_merchant_id_name,
      'Square merchant ID for ' || p_environment
    );
  END IF;

  -- Update tenants table
  UPDATE tenants
  SET
    square_environment = p_environment,
    square_merchant_id = p_merchant_id,
    square_token_expires_at = p_expires_at,
    square_access_token_vault_id = (SELECT id FROM vault.secrets WHERE name = v_access_token_name),
    square_webhook_key_vault_id = NULL  -- Will be set separately
  WHERE id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- Function: store_square_credentials_internal
-- Purpose: Internal function for service_role to store credentials without platform admin check
-- Security: SECURITY DEFINER, no RLS bypass needed (service_role caller)
-- ==============================================================================

CREATE OR REPLACE FUNCTION store_square_credentials_internal(
  p_tenant_id UUID,
  p_environment TEXT,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_merchant_id TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
  v_access_token_name TEXT;
  v_refresh_token_name TEXT;
  v_merchant_id_name TEXT;
  v_access_token_vault_id UUID;
BEGIN
  -- Validate environment parameter
  IF p_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'Invalid environment: %. Must be sandbox or production.', p_environment;
  END IF;

  -- Construct Vault secret names
  v_access_token_name := 'square_' || p_environment || '_access_token_' || p_tenant_id::text;
  v_refresh_token_name := 'square_' || p_environment || '_refresh_token_' || p_tenant_id::text;
  v_merchant_id_name := 'square_' || p_environment || '_merchant_id_' || p_tenant_id::text;

  -- Check if secrets already exist, update if yes, create if no
  -- Access token
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_access_token_name) THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = v_access_token_name),
      p_access_token,
      'Square access token for ' || p_environment
    );
  ELSE
    v_access_token_vault_id := vault.create_secret(
      p_access_token,
      v_access_token_name,
      'Square access token for ' || p_environment
    );
  END IF;

  -- Refresh token
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_refresh_token_name) THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = v_refresh_token_name),
      p_refresh_token,
      'Square refresh token for ' || p_environment
    );
  ELSE
    PERFORM vault.create_secret(
      p_refresh_token,
      v_refresh_token_name,
      'Square refresh token for ' || p_environment
    );
  END IF;

  -- Merchant ID
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_merchant_id_name) THEN
    PERFORM vault.update_secret(
      (SELECT id FROM vault.secrets WHERE name = v_merchant_id_name),
      p_merchant_id,
      'Square merchant ID for ' || p_environment
    );
  ELSE
    PERFORM vault.create_secret(
      p_merchant_id,
      v_merchant_id_name,
      'Square merchant ID for ' || p_environment
    );
  END IF;

  -- Update tenants table
  UPDATE tenants
  SET
    square_environment = p_environment,
    square_merchant_id = p_merchant_id,
    square_token_expires_at = p_expires_at,
    square_access_token_vault_id = (SELECT id FROM vault.secrets WHERE name = v_access_token_name),
    square_webhook_key_vault_id = NULL  -- Will be set separately
  WHERE id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- Function: get_square_credentials_for_oauth
-- Purpose: Platform admin-accessible function to retrieve Square credentials
-- Security: SECURITY DEFINER with platform_admins check
-- ==============================================================================

CREATE OR REPLACE FUNCTION get_square_credentials_for_oauth(p_tenant_id UUID)
RETURNS TABLE (
  access_token TEXT,
  refresh_token TEXT,
  merchant_id TEXT,
  environment TEXT
) AS $$
DECLARE
  v_environment TEXT;
  v_access_token_name TEXT;
  v_refresh_token_name TEXT;
  v_merchant_id_name TEXT;
BEGIN
  -- Verify caller is platform admin
  IF NOT EXISTS (
    SELECT 1 FROM platform_admins
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: only platform admins can retrieve Square credentials';
  END IF;

  -- Get tenant's active Square environment
  SELECT square_environment INTO v_environment
  FROM tenants
  WHERE id = p_tenant_id;

  IF v_environment IS NULL THEN
    -- No Square configuration for this tenant
    RETURN;
  END IF;

  -- Construct Vault secret names
  v_access_token_name := 'square_' || v_environment || '_access_token_' || p_tenant_id::text;
  v_refresh_token_name := 'square_' || v_environment || '_refresh_token_' || p_tenant_id::text;
  v_merchant_id_name := 'square_' || v_environment || '_merchant_id_' || p_tenant_id::text;

  -- Retrieve from Vault
  RETURN QUERY
  SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = v_access_token_name) as access_token,
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = v_refresh_token_name) as refresh_token,
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = v_merchant_id_name) as merchant_id,
    v_environment as environment;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions to authenticated users (functions enforce their own authorization)
GRANT EXECUTE ON FUNCTION store_square_credentials TO authenticated;
GRANT EXECUTE ON FUNCTION store_square_credentials_internal TO authenticated;
GRANT EXECUTE ON FUNCTION get_square_credentials_for_oauth TO authenticated;
