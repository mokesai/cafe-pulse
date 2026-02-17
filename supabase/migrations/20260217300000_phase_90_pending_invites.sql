-- Phase 90: Add tenant_pending_invites table and soft-delete support for tenant_memberships

-- 1. New table for tracking pending admin invites
CREATE TABLE tenant_pending_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'staff', 'customer')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_tenant_pending_invites_email ON tenant_pending_invites (invited_email) WHERE deleted_at IS NULL;
CREATE INDEX idx_tenant_pending_invites_tenant ON tenant_pending_invites (tenant_id) WHERE deleted_at IS NULL;

-- Enable RLS (service role bypasses automatically; no user-facing access needed)
ALTER TABLE tenant_pending_invites ENABLE ROW LEVEL SECURITY;

-- Platform admins can manage pending invites (via service role client - bypasses RLS)
-- No additional policies required since all access goes through service role

-- 2. Add soft-delete support to tenant_memberships
ALTER TABLE tenant_memberships ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX idx_tenant_memberships_active ON tenant_memberships (tenant_id, user_id) WHERE deleted_at IS NULL;
