-- Migration: Add invited_by column to tenant_pending_invites
-- Purpose: Track who sent each invite for audit purposes

ALTER TABLE tenant_pending_invites
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id);

-- Backfill existing rows: all existing invites were created by super_admin (jerrym@mokesai.org)
UPDATE tenant_pending_invites
SET invited_by = '55943f8a-2e9c-4180-b44f-8865a5941eb9'
WHERE invited_by IS NULL;
