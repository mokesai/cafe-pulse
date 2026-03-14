-- MOK-13: Create tenant_kds_layouts table
-- Stores per-tenant KDS screen layout JSON with draft/publish support

CREATE TABLE IF NOT EXISTS tenant_kds_layouts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  screen text NOT NULL CHECK (screen IN ('drinks', 'food')),
  layout jsonb NOT NULL,
  is_draft boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, screen, is_draft)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_kds_layouts_tenant_screen
  ON tenant_kds_layouts (tenant_id, screen, is_draft);

-- RLS
ALTER TABLE tenant_kds_layouts ENABLE ROW LEVEL SECURITY;

-- Staff+ can read layouts
CREATE POLICY "tenant_kds_layouts_select" ON tenant_kds_layouts
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin', 'staff')
    )
  );

-- Owner/admin can insert
CREATE POLICY "tenant_kds_layouts_insert" ON tenant_kds_layouts
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Owner/admin can update
CREATE POLICY "tenant_kds_layouts_update" ON tenant_kds_layouts
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Only owner can delete
CREATE POLICY "tenant_kds_layouts_delete" ON tenant_kds_layouts
  FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role = 'owner'
    )
  );

-- Service role bypass
CREATE POLICY "tenant_kds_layouts_service_role" ON tenant_kds_layouts
  FOR ALL
  USING (auth.role() = 'service_role');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_tenant_kds_layouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_kds_layouts_updated_at
  BEFORE UPDATE ON tenant_kds_layouts
  FOR EACH ROW EXECUTE FUNCTION update_tenant_kds_layouts_updated_at();

COMMENT ON TABLE tenant_kds_layouts IS 'Per-tenant KDS screen layout JSON with draft/publish support';
COMMENT ON COLUMN tenant_kds_layouts.screen IS 'KDS screen: drinks or food';
COMMENT ON COLUMN tenant_kds_layouts.layout IS 'Layout JSON (v1 schema: version, grid, sections, overlays, header, footer)';
COMMENT ON COLUMN tenant_kds_layouts.is_draft IS 'true = draft (editor preview), false = published (live KDS)';
