-- Migration: Backfill platform admin roles
-- Purpose: Add jerry.mccommas@gmail.com as tenant_admin for bigcafe

-- Verify jerrym@mokesai.org is super_admin (should already be from default)
-- user_id: 55943f8a-2e9c-4180-b44f-8865a5941eb9

-- Add jerry.mccommas@gmail.com as tenant_admin for bigcafe
-- user_id: fe542ca5-cad9-4329-a3f3-31cae36154cf
-- tenant_id: 4fa1cbbe-49ff-4cde-a686-8d34252945b4 (bigcafe)
INSERT INTO platform_admins (user_id, role, tenant_id, created_by)
VALUES (
  'fe542ca5-cad9-4329-a3f3-31cae36154cf',
  'tenant_admin',
  '4fa1cbbe-49ff-4cde-a686-8d34252945b4',
  '55943f8a-2e9c-4180-b44f-8865a5941eb9'
)
ON CONFLICT DO NOTHING;
