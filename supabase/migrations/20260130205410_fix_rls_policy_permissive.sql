-- Migration: Fix Overly Permissive RLS Policy
-- Issue: INSERT policy on inventory_item_cost_history uses WITH CHECK (true)
-- Solution: Restrict INSERT to authenticated admin users only

-- Drop the permissive INSERT policy
DROP POLICY IF EXISTS inventory_cost_history_insert ON public.inventory_item_cost_history;

-- Create a proper INSERT policy that requires admin privileges
-- Cost history should only be modified by admins or system processes
CREATE POLICY inventory_cost_history_insert ON public.inventory_item_cost_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Only admins can insert cost history records
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Also ensure the SELECT policy is properly scoped (keeping public read for now)
-- If you want to restrict reads to admins only, uncomment below:
-- DROP POLICY IF EXISTS inventory_cost_history_read ON public.inventory_item_cost_history;
-- CREATE POLICY inventory_cost_history_read ON public.inventory_item_cost_history
--   FOR SELECT
--   TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1 FROM public.profiles
--       WHERE profiles.id = auth.uid()
--       AND profiles.role = 'admin'
--     )
--   );
