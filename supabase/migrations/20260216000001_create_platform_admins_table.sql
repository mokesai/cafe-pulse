-- Migration: Create platform_admins table
-- Phase: 60 Platform Control Plane
-- Plan: 60-01
-- Purpose: Track platform super-admins who can manage all tenants

-- Step 1: Create platform_admins table
CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Step 2: Create unique constraint on user_id (one row per user)
DO $$ BEGIN
  ALTER TABLE platform_admins
    ADD CONSTRAINT platform_admins_user_id_unique UNIQUE (user_id);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Step 3: Create btree index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_platform_admins_user_id
  ON platform_admins USING btree (user_id);

-- Step 4: Enable RLS on platform_admins table
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Step 5: Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Platform admins can read all platform admins" ON platform_admins;
DROP POLICY IF EXISTS "Only postgres can insert platform admins" ON platform_admins;

-- Step 6: Create RLS policy for platform admins to read all platform admins
CREATE POLICY "Platform admins can read all platform admins"
  ON platform_admins
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM platform_admins
      WHERE user_id = auth.uid()
    )
  );

-- Step 7: Create RLS policy preventing inserts (manual/scripted only)
CREATE POLICY "Only postgres can insert platform admins"
  ON platform_admins
  FOR INSERT
  WITH CHECK (false);

-- Step 8: Add table comment
COMMENT ON TABLE platform_admins IS 'Platform super-admins who can manage all tenants';
COMMENT ON COLUMN platform_admins.user_id IS 'Reference to auth.users - one platform admin entry per user';
COMMENT ON COLUMN platform_admins.created_by IS 'User who granted platform admin access (null for bootstrap)';

-- Step 9: Create bootstrap function to create first platform admin
CREATE OR REPLACE FUNCTION bootstrap_platform_admin(admin_email TEXT)
RETURNS TEXT AS $$
DECLARE
  v_user_id UUID;
  v_existing_count INTEGER;
BEGIN
  -- Check if any platform admins already exist
  SELECT COUNT(*) INTO v_existing_count FROM platform_admins;

  IF v_existing_count > 0 THEN
    RETURN 'Error: Platform admins already exist. Bootstrap can only run when no platform admins exist.';
  END IF;

  -- Find user by email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = admin_email;

  IF v_user_id IS NULL THEN
    RETURN 'Error: No user found with email ' || admin_email;
  END IF;

  -- Insert platform admin
  INSERT INTO platform_admins (user_id, created_by)
  VALUES (v_user_id, NULL);

  RETURN 'Success: User ' || admin_email || ' is now a platform admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add function comment
COMMENT ON FUNCTION bootstrap_platform_admin IS 'Bootstrap first platform admin. Can only run when zero platform admins exist.';
