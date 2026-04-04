-- Create test accounts for E2E testing
-- NOTE: Test accounts were created manually via Supabase Auth dashboard.
-- pgcrypto (gen_salt) is not available in this project, so we skip the INSERT.
-- The ON CONFLICT DO NOTHING clause would have made this safe to re-run anyway.
-- Accounts that should exist (password: TestPassword123!):
--   lloyd.ops@agentmail.to       — platform_admin
--   test-owner@cafe-pulse.test   — tenant owner
--   test-admin@cafe-pulse.test   — tenant admin
--   test-staff@cafe-pulse.test   — staff
--   test-customer@cafe-pulse.test — customer

DO $$ BEGIN
  RAISE NOTICE 'create_test_accounts: skipped — accounts managed via Supabase Auth dashboard';
END $$;
