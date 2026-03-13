---
phase: 30-rls-policy-rewrite
plan: 03
type: execute
wave: 3
depends_on: ["30-01", "30-02"]
files_modified: []
autonomous: false

must_haves:
  truths:
    - "All 3 migration files apply without errors to dev Supabase"
    - "Queries from tenant A (default) return only tenant A data"
    - "Setting app.tenant_id to a non-existent UUID returns zero rows"
    - "Anonymous SELECT on site_settings with tenant context returns data"
    - "KDS tables require authentication (anonymous SELECT returns zero)"
    - "Admin tables require staff/admin role membership"
    - "The existing app still boots and pages load on the default tenant"
  artifacts: []
  key_links:
    - from: "app.tenant_id session variable"
      to: "all RLS policies"
      via: "set_config called by db-pre-request"
      pattern: "current_setting\\('app\\.tenant_id'"
---

<objective>
Apply all Phase 30 migrations to the dev Supabase instance and verify tenant isolation works.

Purpose: This is the final step -- applying the SQL and confirming that tenant isolation is enforced at the database level. Without verification, we cannot confirm the RLS rewrite is correct. This plan applies all 3 migration files (core RLS rewrite, SECURITY DEFINER functions, storage policies) and runs verification queries.

Output: Verified database state with tenant-scoped RLS on all 48 tables.
</objective>

<execution_context>
@~/.gsd/workflows/execute-plan.md
@~/.gsd/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phase-30/30-CONTEXT.md
@.planning/phase-30/30-01-SUMMARY.md
@.planning/phase-30/30-02-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Apply all Phase 30 migrations</name>
  <files></files>
  <action>
**BEFORE ANYTHING:** Verify the dev Supabase project is correct:
```bash
grep NEXT_PUBLIC_SUPABASE_URL .env.local
```
Must show `ofppjltowsdvojixeflr`. If it shows the prod project (`etihvnzzmtxsnbifftfh`), STOP and alert the user.

Apply the three migration files in order using `psql` or the Supabase management API. The migration files are:

1. `supabase/migrations/20260213300000_rls_policy_rewrite.sql` (core: helpers + drop + create)
2. `supabase/migrations/20260213300001_update_security_definer_functions.sql` (SECURITY DEFINER updates)
3. `supabase/migrations/20260213300002_rewrite_storage_policies.sql` (storage policies)

Use `npx supabase db push` to apply migrations, OR if that does not work, apply each file manually via the Supabase SQL editor or `psql`.

If any migration fails:
- Check the error message for the specific policy name or table
- Common issues: policy name already exists (use IF EXISTS), function signature mismatch
- Fix the migration file and retry
- Do NOT apply the rollback script unless the database is left in an inconsistent state

After applying, run `npm run build` to confirm the app still compiles (no TypeScript breakage).
  </action>
  <verify>
1. All 3 migrations applied without errors
2. `npm run build` passes
3. Check policy count: query `SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename NOT IN ('tenants', 'tenant_memberships', 'profiles');` -- should be ~100+ (the new policies)
  </verify>
  <done>All Phase 30 migration files successfully applied to dev Supabase. Build still passes.</done>
</task>

<task type="auto">
  <name>Task 2: Verify tenant isolation with SQL queries</name>
  <files></files>
  <action>
Run these verification queries against the dev Supabase instance. Use service role client or direct psql connection for queries that need to set session variables.

**Test 1: Helper functions work**
```sql
-- Set tenant context to default tenant
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);

-- Check is_admin() works (should return true if your test user is an admin of the default tenant)
-- First, ensure you have a tenant_membership row for testing
SELECT public.is_admin();

-- Check is_tenant_member
SELECT public.is_tenant_member(ARRAY['owner','admin','staff']);
```

**Test 2: Category A (site_settings) -- public read**
```sql
-- With tenant context set, should return site_settings rows
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);
SELECT * FROM site_settings;
-- Should return rows (public SELECT, no auth needed when using service role)

-- With wrong tenant context, should return zero
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000099', true);
SELECT * FROM site_settings;
-- Should return 0 rows
```

**Test 3: Category D (admin tables) -- tenant isolation**
```sql
-- With default tenant context
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);
SELECT COUNT(*) FROM inventory_items;
-- Should return existing item count

-- With non-existent tenant context
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000099', true);
SELECT COUNT(*) FROM inventory_items;
-- Should return 0

-- With NULL tenant context (unset)
SELECT set_config('app.tenant_id', '', true);
SELECT COUNT(*) FROM inventory_items;
-- Should return 0 (casting empty string to uuid fails, returns no rows)
```

**Test 4: Category B (orders) -- user scoping**
```sql
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);
SELECT COUNT(*) FROM orders;
-- Via service role, this bypasses RLS -- just checking tenant_id is on the data
```

**Test 5: Verify no old policies remain**
```sql
SELECT policyname, tablename
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename NOT IN ('tenants', 'tenant_memberships', 'profiles')
  AND policyname NOT LIKE 'tenant_%'
ORDER BY tablename, policyname;
-- Should return 0 rows (all non-tenant policies should be gone)
```

**Test 6: Verify all 48 tables have RLS enabled**
```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'orders', 'order_items', 'user_favorites', 'user_addresses', 'notifications',
    'site_settings',
    'kds_categories', 'kds_menu_items', 'kds_settings', 'kds_images',
    'inventory_items', 'suppliers', 'stock_movements', 'purchase_orders',
    'purchase_order_items', 'purchase_order_status_history', 'purchase_order_attachments',
    'purchase_order_receipts', 'low_stock_alerts', 'recipe_ingredients',
    'inventory_settings', 'inventory_locations', 'inventory_unit_types',
    'invoices', 'invoice_items', 'order_invoice_matches', 'supplier_invoice_templates',
    'invoice_import_sessions', 'supplier_email_templates', 'webhook_events',
    'inventory_sales_sync_runs', 'sales_transactions', 'sales_transaction_items',
    'inventory_item_cost_history', 'inventory_valuations',
    'cogs_periods', 'cogs_reports', 'cogs_products', 'cogs_sellables',
    'cogs_sellable_aliases', 'cogs_product_recipes', 'cogs_product_recipe_lines',
    'cogs_sellable_recipe_overrides', 'cogs_sellable_recipe_override_ops',
    'cogs_modifier_sets', 'cogs_modifier_options', 'cogs_modifier_option_recipes',
    'cogs_modifier_option_recipe_lines'
  )
ORDER BY tablename;
-- All should show rowsecurity = true
```

**Test 7: Verify SECURITY DEFINER functions have tenant filtering**
```sql
SELECT prosrc FROM pg_proc WHERE proname = 'update_inventory_stock';
-- Should contain 'tenant_id'

SELECT prosrc FROM pg_proc WHERE proname = 'create_order_notification';
-- Should contain 'tenant_id'
```

Record all results. Any test that fails needs investigation and fix before proceeding.
  </action>
  <verify>
All 7 test categories pass:
1. Helper functions return expected results
2. site_settings public read works with correct tenant, returns 0 for wrong tenant
3. Admin tables return 0 for wrong/empty tenant context
4. Orders accessible with correct tenant
5. No old non-tenant policies remain
6. All 48 tables have RLS enabled
7. SECURITY DEFINER functions contain tenant_id filtering
  </verify>
  <done>Tenant isolation verified across all 48 tables. Policy categories correctly enforce access patterns. Helper functions and SECURITY DEFINER functions are tenant-aware.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Complete Phase 30 RLS policy rewrite applied and verified against dev database. All 48 tenant-scoped tables have tenant-scoped policies. Helper functions, SECURITY DEFINER functions, and storage policies updated.</what-built>
  <how-to-verify>
1. Start the dev server: `npm run dev:webpack`
2. Navigate to the site (default tenant on localhost:3000)
3. Verify pages load without errors:
   - Home page loads (site_settings read)
   - Menu page loads (Square API, not DB -- should be fine)
   - Admin pages load if you're logged in as admin
   - KDS pages load if you're logged in as staff/admin
4. Check browser console for any Supabase errors (403s, permission denied)
5. If you have admin access, verify:
   - Inventory page loads data
   - Purchase orders page loads data
   - Invoices page loads data
6. Check that guest checkout flow still works (if testable)
  </how-to-verify>
  <resume-signal>Type "approved" if the app works correctly on the default tenant, or describe any issues found</resume-signal>
</task>

</tasks>

<verification>
- All 3 migration files applied successfully
- npm run build passes
- All 48 tables have RLS enabled with new tenant-scoped policies
- No old policies remain on tenant-scoped tables
- Tenant isolation verified: wrong tenant context returns 0 rows
- SECURITY DEFINER functions include tenant_id filtering
- Storage policies use tenant_memberships
- App boots and pages load on default tenant
</verification>

<success_criteria>
- Phase 30 migration applied to dev database without errors
- Tenant isolation proven: different tenant contexts see different data
- Existing app functionality preserved on default tenant
- No Supabase permission errors in browser console
- Human verification confirms app works end-to-end
</success_criteria>

<output>
After completion, create `.planning/phase-30/30-03-SUMMARY.md`
</output>
