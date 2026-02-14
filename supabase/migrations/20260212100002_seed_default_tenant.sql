-- Seed the default "Little Cafe" tenant
-- This tenant mirrors the hardcoded business info from src/lib/constants/app.ts
-- UUID is deterministic so it can be referenced consistently across environments

INSERT INTO public.tenants (
  id,
  slug,
  name,
  business_name,
  business_address,
  business_phone,
  business_email,
  business_hours,
  square_environment,
  is_active,
  features
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'littlecafe',
  'Little Cafe',
  'Little Cafe',
  '10400 E Alameda Ave, Denver, CO',
  '(303) 123-4567',
  'info@littlecafe.com',
  '{
    "monday": "8:00 AM - 6:00 PM",
    "tuesday": "8:00 AM - 6:00 PM",
    "wednesday": "8:00 AM - 6:00 PM",
    "thursday": "8:00 AM - 6:00 PM",
    "friday": "8:00 AM - 6:00 PM",
    "saturday": "Closed",
    "sunday": "Closed"
  }'::jsonb,
  'sandbox',
  true,
  '{}'::jsonb
) ON CONFLICT (slug) DO NOTHING;

-- Document the default tenant on the table
COMMENT ON TABLE public.tenants IS 'Tenant registry. Default tenant: littlecafe (id: 00000000-0000-0000-0000-000000000001)';
