---
phase: 10
plan: 02
name: create-tenant-memberships-table
wave: 2
depends_on: [1]
files_modified: []
files_created:
  - supabase/migrations/20260212100001_create_tenant_memberships.sql
autonomous: true
---

## Objective

Create the `tenant_memberships` table that maps users to tenants with roles (owner, admin, staff, customer). This is the foundation for tenant-scoped access control in later phases.

## Tasks

1. Create migration file `supabase/migrations/20260212100001_create_tenant_memberships.sql` with:

2. Define the `tenant_memberships` table:
   ```sql
   CREATE TABLE public.tenant_memberships (
     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
     tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
     user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
     role text NOT NULL DEFAULT 'customer' CHECK (role IN ('owner', 'admin', 'staff', 'customer')),
     created_at timestamptz DEFAULT now(),
     UNIQUE(tenant_id, user_id)
   );
   ```

3. Add indexes for common query patterns:
   ```sql
   CREATE INDEX idx_tenant_memberships_tenant_id ON public.tenant_memberships (tenant_id);
   CREATE INDEX idx_tenant_memberships_user_id ON public.tenant_memberships (user_id);
   CREATE INDEX idx_tenant_memberships_role ON public.tenant_memberships (tenant_id, role);
   ```

4. Enable RLS with policies:
   ```sql
   ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;

   -- Users can read their own memberships
   CREATE POLICY "Users can read own memberships"
     ON public.tenant_memberships FOR SELECT
     USING (user_id = auth.uid());

   -- Tenant owners/admins can read all memberships for their tenant
   CREATE POLICY "Admins can read tenant memberships"
     ON public.tenant_memberships FOR SELECT
     USING (
       EXISTS (
         SELECT 1 FROM public.tenant_memberships tm
         WHERE tm.tenant_id = tenant_memberships.tenant_id
         AND tm.user_id = auth.uid()
         AND tm.role IN ('owner', 'admin')
       )
     );

   -- Note: Service role bypasses RLS entirely. Write policies for platform admins
   -- will be added in Phase 30 (RLS Policy Rewrite). No FOR ALL policy needed here.
   ```

5. Add column comments for documentation.

## Verification

- Run `npm run db:migrate` (after verifying `.env.local` points to dev project `ofppjltowsdvojixeflr`)
- Execute `SELECT * FROM public.tenant_memberships;` -- should return empty, no errors
- Verify foreign key: attempt to insert with non-existent `tenant_id` -- should fail
- Verify unique constraint: attempt duplicate `(tenant_id, user_id)` -- should fail
- Verify check constraint: attempt `role = 'superuser'` -- should fail

## must_haves

- The `tenant_memberships` table exists with user-tenant-role mapping
- Foreign keys reference `tenants(id)` and `auth.users(id)` with CASCADE delete
- Unique constraint on `(tenant_id, user_id)` prevents duplicate memberships
- Role check constraint limits values to owner, admin, staff, customer
- RLS is enabled on the table
