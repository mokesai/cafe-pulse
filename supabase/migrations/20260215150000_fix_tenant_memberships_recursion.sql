-- Migration: Fix infinite recursion in tenant_memberships RLS policies
-- The "Admins can read tenant memberships" policy creates recursion because
-- it queries tenant_memberships within a policy on tenant_memberships.
--
-- Solution: Drop the recursive policy. The "Users can read own memberships"
-- policy is sufficient for requireAdmin() to check the user's own membership.
-- Admin users will still be able to manage memberships via admin API routes
-- that use the service role client.

-- Drop the problematic recursive policy
DROP POLICY IF EXISTS "Admins can read tenant memberships" ON public.tenant_memberships;

-- The remaining policy is sufficient:
-- "Users can read own memberships" - allows users to SELECT their own rows
-- where user_id = auth.uid()
--
-- This is all requireAdmin() needs - it queries for the current user's membership
-- in the current tenant with owner/admin role.
