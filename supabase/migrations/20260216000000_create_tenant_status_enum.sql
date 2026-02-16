-- Migration: Create tenant_status ENUM with state machine validation
-- Phase: 60 Platform Control Plane
-- Plan: 60-01
-- Purpose: Enable tenant lifecycle management with database-enforced state transitions

-- Step 1: Create tenant_status ENUM type
DO $$ BEGIN
  CREATE TYPE tenant_status AS ENUM ('trial', 'active', 'paused', 'suspended', 'deleted');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Step 2: Add status columns to tenants table
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS status tenant_status NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Step 3: Add trial management columns
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 14;

-- Step 4: Create trigger function to update status_changed_at timestamp
CREATE OR REPLACE FUNCTION update_tenant_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create trigger to call timestamp update function
DROP TRIGGER IF EXISTS tenant_status_changed ON tenants;
CREATE TRIGGER tenant_status_changed
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_tenant_status_timestamp();

-- Step 6: Create state machine validation function
CREATE OR REPLACE FUNCTION validate_tenant_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- trial → active, paused, deleted
  IF OLD.status = 'trial' AND NEW.status NOT IN ('active', 'paused', 'deleted') THEN
    RAISE EXCEPTION 'Invalid transition from trial to %. Allowed transitions: active, paused, deleted', NEW.status;
  END IF;

  -- active → paused, suspended, deleted
  IF OLD.status = 'active' AND NEW.status NOT IN ('paused', 'suspended', 'deleted') THEN
    RAISE EXCEPTION 'Invalid transition from active to %. Allowed transitions: paused, suspended, deleted', NEW.status;
  END IF;

  -- paused → active, suspended, deleted
  IF OLD.status = 'paused' AND NEW.status NOT IN ('active', 'suspended', 'deleted') THEN
    RAISE EXCEPTION 'Invalid transition from paused to %. Allowed transitions: active, suspended, deleted', NEW.status;
  END IF;

  -- suspended → active, deleted (requires manual intervention)
  IF OLD.status = 'suspended' AND NEW.status NOT IN ('active', 'deleted') THEN
    RAISE EXCEPTION 'Invalid transition from suspended to %. Allowed transitions: active, deleted (manual intervention required)', NEW.status;
  END IF;

  -- deleted is final state (cannot transition away)
  IF OLD.status = 'deleted' THEN
    RAISE EXCEPTION 'Cannot change status of deleted tenant. Deleted is a final state.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create trigger to validate status transitions
DROP TRIGGER IF EXISTS validate_tenant_status ON tenants;
CREATE TRIGGER validate_tenant_status
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION validate_tenant_status_transition();

-- Step 8: Create trigger function to set trial expiration
CREATE OR REPLACE FUNCTION set_trial_expiration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'trial' AND NEW.trial_expires_at IS NULL THEN
    NEW.trial_expires_at = NOW() + (NEW.trial_days || ' days')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Create trigger to set trial expiration on insert
DROP TRIGGER IF EXISTS set_trial_on_insert ON tenants;
CREATE TRIGGER set_trial_on_insert
  BEFORE INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION set_trial_expiration();

-- Step 10: Update default tenant (littlecafe) to status 'active'
UPDATE tenants
SET status = 'active'
WHERE slug = 'littlecafe'
  AND id = '00000000-0000-0000-0000-000000000001';

-- Add helpful comments
COMMENT ON TYPE tenant_status IS 'Tenant lifecycle states: trial → active ↔ paused ↔ suspended → deleted (final)';
COMMENT ON COLUMN tenants.status IS 'Current lifecycle status of tenant';
COMMENT ON COLUMN tenants.status_changed_at IS 'Timestamp of last status change';
COMMENT ON COLUMN tenants.trial_expires_at IS 'When trial period expires (auto-set on creation)';
COMMENT ON COLUMN tenants.trial_days IS 'Length of trial period in days (default 14)';
