-- Migration: Backfill platform admin roles
-- Purpose: Add jerry.mccommas@gmail.com as tenant_admin for bigcafe (dev data)
-- Defensive: skip silently on environments where the referenced auth users or tenant don't exist.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = 'fe542ca5-cad9-4329-a3f3-31cae36154cf')
     AND EXISTS (SELECT 1 FROM auth.users WHERE id = '55943f8a-2e9c-4180-b44f-8865a5941eb9')
     AND EXISTS (SELECT 1 FROM tenants WHERE id = '4fa1cbbe-49ff-4cde-a686-8d34252945b4') THEN
    INSERT INTO platform_admins (user_id, role, tenant_id, created_by)
    VALUES (
      'fe542ca5-cad9-4329-a3f3-31cae36154cf',
      'tenant_admin',
      '4fa1cbbe-49ff-4cde-a686-8d34252945b4',
      '55943f8a-2e9c-4180-b44f-8865a5941eb9'
    )
    ON CONFLICT DO NOTHING;
  ELSE
    RAISE NOTICE 'backfill_platform_admin_roles: skipped — referenced users/tenant not present';
  END IF;
END $$;
