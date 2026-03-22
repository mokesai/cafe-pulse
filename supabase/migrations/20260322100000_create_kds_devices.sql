-- MOK-45: Create kds_devices table for Pi device registration and monitoring
-- Supports setup code registration, bearer token auth, and heartbeat monitoring

CREATE TABLE IF NOT EXISTS kds_devices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  setup_code text UNIQUE,
  setup_code_expires_at timestamptz,
  auth_token text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'registered', 'offline')),
  screen_1 text NOT NULL DEFAULT 'drinks' CHECK (screen_1 IN ('drinks', 'food')),
  screen_2 text NOT NULL DEFAULT 'food' CHECK (screen_2 IN ('drinks', 'food')),
  last_heartbeat_at timestamptz,
  ip_address text,
  created_at timestamptz DEFAULT now(),
  registered_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kds_devices_tenant
  ON kds_devices (tenant_id);

CREATE INDEX IF NOT EXISTS idx_kds_devices_auth_token
  ON kds_devices (auth_token) WHERE auth_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kds_devices_setup_code
  ON kds_devices (setup_code) WHERE setup_code IS NOT NULL;

-- RLS
ALTER TABLE kds_devices ENABLE ROW LEVEL SECURITY;

-- Staff+ can read devices
CREATE POLICY "kds_devices_select" ON kds_devices
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin', 'staff')
    )
  );

-- Owner/admin can insert
CREATE POLICY "kds_devices_insert" ON kds_devices
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Owner/admin can update
CREATE POLICY "kds_devices_update" ON kds_devices
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Owner/admin can delete (revoke device)
CREATE POLICY "kds_devices_delete" ON kds_devices
  FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Service role bypass (for API endpoints that use device auth tokens)
CREATE POLICY "kds_devices_service_role" ON kds_devices
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE kds_devices IS 'Registered KDS Raspberry Pi devices with heartbeat monitoring';
COMMENT ON COLUMN kds_devices.setup_code IS 'Short registration code (e.g., BIGCAFE-7X4K). Cleared after registration.';
COMMENT ON COLUMN kds_devices.auth_token IS 'Hashed bearer token for device authentication. Pi stores plaintext.';
COMMENT ON COLUMN kds_devices.status IS 'Device state: pending (awaiting registration), registered (active), offline (no heartbeat)';
COMMENT ON COLUMN kds_devices.screen_1 IS 'Screen assignment for HDMI output 1';
COMMENT ON COLUMN kds_devices.screen_2 IS 'Screen assignment for HDMI output 2';
