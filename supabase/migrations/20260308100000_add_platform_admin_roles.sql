-- Migration: Add role-based access control to platform_admins
-- Purpose: Support super_admin (all tenants) and tenant_admin (scoped to specific tenants)
-- - super_admin: tenant_id IS NULL, sees all tenants
-- - tenant_admin: tenant_id references a specific tenant

-- Step 1: Add role column with default 'super_admin' for backward compatibility
ALTER TABLE platform_admins
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super_admin'
  CHECK (role IN ('super_admin', 'tenant_admin'));

-- Step 2: Add optional tenant_id column for scoped admins
ALTER TABLE platform_admins
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Step 3: Add constraint — tenant_admin must have a tenant_id, super_admin must not
ALTER TABLE platform_admins
  ADD CONSTRAINT platform_admins_role_tenant_check
  CHECK (
    (role = 'super_admin' AND tenant_id IS NULL) OR
    (role = 'tenant_admin' AND tenant_id IS NOT NULL)
  );

-- Step 4: Drop old unique constraint on user_id (a user can now have multiple rows)
ALTER TABLE platform_admins
  DROP CONSTRAINT IF EXISTS platform_admins_user_id_unique;

-- Step 5: Add composite unique constraint — one row per user per tenant (or one super_admin row)
-- Use a unique index with COALESCE to handle NULL tenant_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_admins_user_tenant
  ON platform_admins (user_id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'));

-- Step 6: Add index on tenant_id for scoped queries
CREATE INDEX IF NOT EXISTS idx_platform_admins_tenant_id
  ON platform_admins (tenant_id) WHERE tenant_id IS NOT NULL;

-- Step 7: Update RLS — users can see their own rows (unchanged behavior, but now multiple rows possible)
-- The existing policy "Users can check own platform admin status" already uses user_id = auth.uid()
-- which will return all rows for the user, which is correct.

-- Step 8: Update comments
COMMENT ON COLUMN platform_admins.role IS 'Admin role: super_admin (all tenants) or tenant_admin (scoped to tenant_id)';
COMMENT ON COLUMN platform_admins.tenant_id IS 'Scoped tenant for tenant_admin role. NULL for super_admin.';
