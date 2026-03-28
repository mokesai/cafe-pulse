-- Create test accounts for E2E testing (all password: TestPassword123!)
-- Covers all role types: platform admin, tenant admin, admin, staff, customer

INSERT INTO auth.users (
  email, email_confirmed_at, encrypted_password, 
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('lloyd.ops@agentmail.to', now(), crypt('TestPassword123!', gen_salt('bf')), 
   jsonb_build_object('provider', 'email'), jsonb_build_object('role', 'platform_admin')),
  ('wanda.dev@example.com', now(), crypt('TestPassword123!', gen_salt('bf')),
   jsonb_build_object('provider', 'email'), jsonb_build_object('role', 'tenant_admin')),
  ('milli.design@example.com', now(), crypt('TestPassword123!', gen_salt('bf')),
   jsonb_build_object('provider', 'email'), jsonb_build_object('role', 'admin')),
  ('jesse.business@example.com', now(), crypt('TestPassword123!', gen_salt('bf')),
   jsonb_build_object('provider', 'email'), jsonb_build_object('role', 'staff')),
  ('marvin.marketing@example.com', now(), crypt('TestPassword123!', gen_salt('bf')),
   jsonb_build_object('provider', 'email'), jsonb_build_object('role', 'customer'))
ON CONFLICT (email) DO NOTHING;
