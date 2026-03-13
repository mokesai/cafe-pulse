-- Migration: Create tenant_memberships table
-- Maps users to tenants with role-based access (owner, admin, staff, customer)

-- 1. Create the tenant_memberships table
CREATE TABLE public.tenant_memberships (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('owner', 'admin', 'staff', 'customer')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- 2. Add indexes for common query patterns
CREATE INDEX idx_tenant_memberships_tenant_id ON public.tenant_memberships (tenant_id);
CREATE INDEX idx_tenant_memberships_user_id ON public.tenant_memberships (user_id);
CREATE INDEX idx_tenant_memberships_role ON public.tenant_memberships (tenant_id, role);

-- 3. Enable RLS
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies

-- Users can read their own memberships
CREATE POLICY "Users can read own memberships"
  ON public.tenant_memberships FOR SELECT
  USING (user_id = auth.uid());

-- Tenant owners/admins can read all memberships for their tenant
CREATE POLICY "Admins can read tenant memberships"
  ON public.tenant_memberships FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = tenant_memberships.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('owner', 'admin')
    )
  );

-- Note: Service role bypasses RLS entirely. Write policies for platform admins
-- will be added in Phase 30 (RLS Policy Rewrite). No FOR ALL policy needed here.

-- 5. Column comments
COMMENT ON TABLE public.tenant_memberships IS 'Maps users to tenants with role-based access control';
COMMENT ON COLUMN public.tenant_memberships.id IS 'Unique membership identifier';
COMMENT ON COLUMN public.tenant_memberships.tenant_id IS 'Reference to the tenant';
COMMENT ON COLUMN public.tenant_memberships.user_id IS 'Reference to the auth user';
COMMENT ON COLUMN public.tenant_memberships.role IS 'User role within the tenant: owner, admin, staff, or customer';
COMMENT ON COLUMN public.tenant_memberships.created_at IS 'When the membership was created';
