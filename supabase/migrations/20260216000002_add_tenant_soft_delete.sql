-- Migration: Add soft delete infrastructure with pg_cron cleanup
-- Phase: 60 Platform Control Plane
-- Plan: 60-01
-- Purpose: Enable 30-day recovery window for deleted tenants with automated cleanup

-- Step 1: Add deleted_at column to tenants table
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Step 2: Create partial index for active tenant queries (performance optimization)
CREATE INDEX IF NOT EXISTS idx_tenants_active
  ON tenants (id)
  WHERE deleted_at IS NULL;

-- Step 3: Update existing RLS policy to exclude soft-deleted tenants
-- First, drop the old policy
DROP POLICY IF EXISTS "Anyone can read active tenants" ON tenants;

-- Recreate policy with deleted_at check
CREATE POLICY "Anyone can read active tenants"
  ON tenants
  FOR SELECT
  USING (deleted_at IS NULL);

-- Step 4: Create restore function for platform admins
CREATE OR REPLACE FUNCTION restore_tenant(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Verify caller is platform admin
  IF NOT EXISTS (
    SELECT 1
    FROM platform_admins
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: only platform admins can restore tenants';
  END IF;

  -- Restore tenant by setting deleted_at to NULL
  UPDATE tenants
  SET deleted_at = NULL
  WHERE id = tenant_id
    AND deleted_at IS NOT NULL;

  -- If no rows updated, tenant doesn't exist or wasn't deleted
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant % not found or not deleted', tenant_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Step 6: Unschedule existing job if it exists (for idempotency)
SELECT cron.unschedule('cleanup_deleted_tenants')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup_deleted_tenants'
);

-- Step 7: Schedule cleanup job (daily at 3 AM)
SELECT cron.schedule(
  'cleanup_deleted_tenants',
  '0 3 * * *',
  $$
  DELETE FROM tenants
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - INTERVAL '30 days';
  $$
);

-- Step 8: Add helpful comments
COMMENT ON COLUMN tenants.deleted_at IS 'Soft delete timestamp. NULL = active, NOT NULL = deleted (30-day retention)';
COMMENT ON FUNCTION restore_tenant IS 'Restore soft-deleted tenant. Platform admin only. Sets deleted_at to NULL.';

-- Log the scheduled job for reference
DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'cleanup_deleted_tenants';

  RAISE NOTICE 'Scheduled cleanup job (ID: %). Runs daily at 3 AM to purge tenants deleted >30 days ago.', v_job_id;
END $$;
