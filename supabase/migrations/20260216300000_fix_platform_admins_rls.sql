-- Migration: Fix platform_admins RLS chicken-and-egg problem
-- Phase: 60 Platform Control Plane
-- Plan: 60-UAT (found during testing)
-- Issue: Original RLS policy requires being platform admin to read platform_admins,
--        but middleware needs to read platform_admins to check if user is platform admin

-- Drop the circular RLS policy
DROP POLICY IF EXISTS "Platform admins can read all platform admins" ON platform_admins;

-- Create new policy: users can check if they themselves are platform admins
CREATE POLICY "Users can check own platform admin status"
  ON platform_admins
  FOR SELECT
  USING (user_id = auth.uid());

-- Add function comment
COMMENT ON POLICY "Users can check own platform admin status" ON platform_admins
  IS 'Allows authenticated users to query if they are a platform admin (needed for middleware auth check)';
