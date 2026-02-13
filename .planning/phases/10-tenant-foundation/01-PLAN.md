---
phase: 10
plan: 01
name: create-tenants-table
wave: 1
depends_on: []
files_modified: []
files_created:
  - supabase/migrations/20260212100000_create_tenants_table.sql
autonomous: true
---

## Objective

Create the `tenants` table with business config, Square credentials, email config, and status columns. Also create the `set_tenant_from_request()` pre-request function that reads the `x-tenant-id` header and sets the PostgreSQL session variable `app.tenant_id`.

## Tasks

1. Create migration file `supabase/migrations/20260212100000_create_tenants_table.sql` with:

2. Define the `tenants` table:
   ```sql
   CREATE TABLE public.tenants (
     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
     slug text UNIQUE NOT NULL,
     name text NOT NULL,
     business_name text NOT NULL,
     business_address text,
     business_phone text,
     business_email text,
     business_hours jsonb,
     square_application_id text,
     square_access_token text,
     square_location_id text,
     square_environment text DEFAULT 'sandbox',
     square_merchant_id text,
     square_webhook_signature_key text,
     email_sender_name text,
     email_sender_address text,
     is_active boolean DEFAULT true,
     features jsonb DEFAULT '{}',
     created_at timestamptz DEFAULT now(),
     updated_at timestamptz DEFAULT now()
   );
   ```

3. Add an index on `slug` for fast lookups (unique constraint creates one, but be explicit):
   ```sql
   CREATE INDEX idx_tenants_slug ON public.tenants (slug);
   ```

4. Add an `updated_at` trigger:
   ```sql
   CREATE OR REPLACE FUNCTION public.update_tenants_updated_at()
   RETURNS trigger AS $$
   BEGIN
     NEW.updated_at = now();
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER tenants_updated_at
     BEFORE UPDATE ON public.tenants
     FOR EACH ROW EXECUTE FUNCTION public.update_tenants_updated_at();
   ```

5. Create the `set_tenant_from_request()` function that reads `request.header.x-tenant-id` and calls `set_config('app.tenant_id', ...)`:
   ```sql
   CREATE OR REPLACE FUNCTION public.set_tenant_from_request()
   RETURNS void AS $$
   DECLARE
     header_tenant_id text;
   BEGIN
     header_tenant_id := current_setting('request.header.x-tenant-id', true);
     IF header_tenant_id IS NOT NULL AND header_tenant_id != '' THEN
       PERFORM set_config('app.tenant_id', header_tenant_id, true);
     END IF;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;
   ```

6. Also create the legacy `set_tenant_context(p_tenant_id uuid)` convenience function for direct RPC usage:
   ```sql
   CREATE OR REPLACE FUNCTION public.set_tenant_context(p_tenant_id uuid)
   RETURNS void AS $$
   BEGIN
     PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;
   ```

7. Configure PostgREST to use `set_tenant_from_request` as the pre-request hook. Wrap in exception handler in case Supabase restricts ALTER ROLE:
   ```sql
   DO $$ BEGIN
     ALTER ROLE authenticator SET pgrst.db_pre_request = 'set_tenant_from_request';
     NOTIFY pgrst, 'reload config';
   EXCEPTION WHEN OTHERS THEN
     RAISE NOTICE 'ALTER ROLE failed. Configure pre-request function manually via Supabase Dashboard > Database > Webhooks & Functions.';
   END $$;
   ```

8. Enable RLS on the `tenants` table with a permissive read policy (anyone can read active tenants) and a restrictive write policy (service role only for now):
   ```sql
   ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

   -- Allow reading non-sensitive tenant info. Exclude Square credentials via a view in Phase 30.
   -- For now, application code MUST use select() with explicit columns, NOT select('*').
   CREATE POLICY "Anyone can read active tenants"
     ON public.tenants FOR SELECT
     USING (is_active = true);

   -- Note: Service role bypasses RLS entirely. Write policies for platform admins
   -- will be added in Phase 60 (Platform Control Plane). No FOR ALL policy needed here.
   ```

9. Add column comments for documentation.

## Verification

- Run `npm run db:migrate` (after verifying `.env.local` points to dev project `ofppjltowsdvojixeflr`)
- Execute `SELECT * FROM public.tenants;` -- should return empty result set, no errors
- Execute `SELECT public.set_tenant_context('00000000-0000-0000-0000-000000000001'::uuid);` -- should succeed
- Execute `SELECT current_setting('app.tenant_id', true);` -- should return the UUID string
- Verify function exists: `SELECT proname FROM pg_proc WHERE proname = 'set_tenant_from_request';`

## must_haves

- The `tenants` table exists with columns for business config and Square credentials
- The `set_tenant_context()` PostgreSQL function exists and correctly sets `app.tenant_id`
- The `set_tenant_from_request()` pre-request function exists and reads from `request.header.x-tenant-id`
- PostgREST is configured to call `set_tenant_from_request` before each request
- RLS is enabled on the `tenants` table
