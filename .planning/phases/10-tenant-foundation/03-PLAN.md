---
phase: 10
plan: 03
name: seed-default-tenant
wave: 2
depends_on: [1]
files_modified: []
files_created:
  - supabase/migrations/20260212100002_seed_default_tenant.sql
autonomous: true
---

## Objective

Seed the "Little Cafe" default tenant row so the existing single-tenant app continues to work. This tenant uses `slug = 'littlecafe'` and mirrors the current hardcoded business info from `src/lib/constants/app.ts`.

## Tasks

1. Create migration file `supabase/migrations/20260212100002_seed_default_tenant.sql` with:

2. Insert the default tenant row with a deterministic UUID so it can be referenced consistently:
   ```sql
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
   ```

3. Note: Square credentials (application_id, access_token, location_id) are NOT seeded in the migration because they are environment-specific. They remain in `.env.local` for now and will be populated on the tenant row in a later phase when the Square integration becomes tenant-aware (Phase 3 per the roadmap).

4. Add a comment documenting the default tenant:
   ```sql
   COMMENT ON TABLE public.tenants IS 'Tenant registry. Default tenant: littlecafe (id: 00000000-0000-0000-0000-000000000001)';
   ```

## Verification

- Run `npm run db:migrate` (after verifying `.env.local` points to dev project `ofppjltowsdvojixeflr`)
- Execute `SELECT id, slug, name, business_name, is_active FROM public.tenants;` -- should show one row with slug `littlecafe`
- Execute `SELECT * FROM public.tenants WHERE slug = 'littlecafe';` -- should return the full tenant record
- Verify business hours are valid JSON: `SELECT business_hours->>'monday' FROM public.tenants WHERE slug = 'littlecafe';` -- should return `8:00 AM - 6:00 PM`

## must_haves

- A default "Little Cafe" tenant exists with `slug = 'littlecafe'`
- The tenant has a deterministic UUID (`00000000-0000-0000-0000-000000000001`) for consistent references
- Business info matches the current hardcoded values in `src/lib/constants/app.ts`
- The tenant is marked `is_active = true`
- The migration is idempotent (`ON CONFLICT DO NOTHING`)
