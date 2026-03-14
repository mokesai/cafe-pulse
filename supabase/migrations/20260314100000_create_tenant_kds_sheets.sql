-- MOK-7: Create tenant_kds_sheets table
-- Tracks Google Spreadsheet references per tenant for KDS configuration

CREATE TABLE IF NOT EXISTS tenant_kds_sheets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  google_spreadsheet_id text NOT NULL,
  google_sheet_url text NOT NULL,
  created_at timestamptz DEFAULT now(),
  last_synced_at timestamptz,
  last_imported_at timestamptz,
  UNIQUE(tenant_id)
);

-- RLS
ALTER TABLE tenant_kds_sheets ENABLE ROW LEVEL SECURITY;

-- Tenant members (owner/admin/staff) can read their own sheet record
CREATE POLICY "tenant_kds_sheets_select" ON tenant_kds_sheets
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin', 'staff')
    )
  );

-- Only owner/admin can insert
CREATE POLICY "tenant_kds_sheets_insert" ON tenant_kds_sheets
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Only owner/admin can update
CREATE POLICY "tenant_kds_sheets_update" ON tenant_kds_sheets
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Only owner can delete
CREATE POLICY "tenant_kds_sheets_delete" ON tenant_kds_sheets
  FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid()
      AND role = 'owner'
    )
  );

-- Service role bypass (for server-side operations)
CREATE POLICY "tenant_kds_sheets_service_role" ON tenant_kds_sheets
  FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_tenant_kds_sheets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- last_synced_at and last_imported_at are set explicitly
  -- no auto-updated_at needed on this table
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE tenant_kds_sheets IS 'Tracks Google Spreadsheet references per tenant for KDS menu configuration';
COMMENT ON COLUMN tenant_kds_sheets.google_spreadsheet_id IS 'Google Sheets file ID (from Drive API)';
COMMENT ON COLUMN tenant_kds_sheets.google_sheet_url IS 'Public edit URL for the spreadsheet';
COMMENT ON COLUMN tenant_kds_sheets.last_synced_at IS 'Last time Square catalog was synced to the sheet';
COMMENT ON COLUMN tenant_kds_sheets.last_imported_at IS 'Last time sheet data was imported into the DB';
