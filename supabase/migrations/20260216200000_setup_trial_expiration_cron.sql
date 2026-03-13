-- Migration: Set up pg_cron job for automated trial expiration
-- Phase: 60 Platform Control Plane
-- Plan: 60-07
-- Purpose: Automatically transition expired trials to 'paused' status and notify of upcoming expirations

-- Step 1: Enable pg_cron extension (already enabled in 60-01, but safe to repeat)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Step 2: Unschedule existing jobs if they exist (for idempotency)
SELECT cron.unschedule('expire_trial_tenants')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'expire_trial_tenants'
);

SELECT cron.unschedule('trial_expiration_warnings')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'trial_expiration_warnings'
);

-- Step 3: Scheduled job to expire trials (runs hourly)
SELECT cron.schedule(
  'expire_trial_tenants',
  '0 * * * *',  -- Every hour at minute 0
  $$
  UPDATE tenants
  SET status = 'paused'
  WHERE status = 'trial'
    AND trial_expires_at < NOW()
    AND deleted_at IS NULL;
  $$
);

-- Step 4: Create notification function for upcoming expirations
CREATE OR REPLACE FUNCTION notify_trial_expiring()
RETURNS void AS $$
DECLARE
  expiring_tenant RECORD;
BEGIN
  -- Find trials expiring in next 3 days
  FOR expiring_tenant IN
    SELECT id, name, slug, trial_expires_at
    FROM tenants
    WHERE status = 'trial'
      AND trial_expires_at BETWEEN NOW() AND NOW() + INTERVAL '3 days'
      AND deleted_at IS NULL
  LOOP
    -- Log warning (in production, would trigger email notification)
    RAISE NOTICE 'Trial expiring soon: % (%) - expires %',
      expiring_tenant.name,
      expiring_tenant.slug,
      expiring_tenant.trial_expires_at;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Schedule daily notification check (9 AM)
SELECT cron.schedule(
  'trial_expiration_warnings',
  '0 9 * * *',  -- Daily at 9 AM
  $$
  SELECT notify_trial_expiring();
  $$
);

-- Step 6: Add helpful comments
COMMENT ON EXTENSION pg_cron IS 'Trial expiration automation - hourly check for expired trials, auto-transition to paused status';
COMMENT ON FUNCTION notify_trial_expiring IS 'Logs tenants with trials expiring within 3 days. Future: trigger email notifications.';

-- Step 7: Log the scheduled jobs for reference
DO $$
DECLARE
  v_expire_job_id BIGINT;
  v_warning_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_expire_job_id
  FROM cron.job
  WHERE jobname = 'expire_trial_tenants';

  SELECT jobid INTO v_warning_job_id
  FROM cron.job
  WHERE jobname = 'trial_expiration_warnings';

  RAISE NOTICE 'Scheduled trial expiration job (ID: %). Runs hourly to auto-transition expired trials to paused.', v_expire_job_id;
  RAISE NOTICE 'Scheduled trial warning job (ID: %). Runs daily at 9 AM to log upcoming expirations.', v_warning_job_id;
END $$;

-- Step 8: View scheduled jobs (for verification)
SELECT jobname, schedule, command
FROM cron.job
WHERE jobname IN ('expire_trial_tenants', 'trial_expiration_warnings');
