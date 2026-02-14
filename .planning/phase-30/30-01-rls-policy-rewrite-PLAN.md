---
phase: 30-rls-policy-rewrite
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20260213300000_rls_policy_rewrite.sql
  - supabase/migrations/20260213300099_rollback_rls_rewrite.sql
autonomous: false

must_haves:
  truths:
    - "All 97 old RLS policies are dropped from 48 tenant-scoped tables"
    - "All 48 tables have new tenant-scoped RLS policies using current_setting('app.tenant_id')"
    - "site_settings allows anonymous SELECT with tenant_id match (Category A)"
    - "orders/order_items/user_favorites/user_addresses/notifications use user_id + tenant_id (Category B)"
    - "KDS tables require authenticated tenant member for read (Category C)"
    - "37 admin tables use owner/admin write + staff read pattern (Category D)"
    - "is_admin() checks tenant_memberships instead of profiles.role"
    - "is_tenant_member() helper function exists and works"
    - "Anonymous guest checkout still works (orders INSERT with user_id IS NULL)"
  artifacts:
    - path: "supabase/migrations/20260213300000_rls_policy_rewrite.sql"
      provides: "Single atomic migration: helpers + drop all old policies + create all new policies"
      contains: "CREATE OR REPLACE FUNCTION public.is_tenant_member"
    - path: "supabase/migrations/20260213300099_rollback_rls_rewrite.sql"
      provides: "Rollback script to restore old policies"
      contains: "DROP POLICY"
  key_links:
    - from: "all new RLS policies"
      to: "current_setting('app.tenant_id', true)"
      via: "tenant_id column comparison in USING/WITH CHECK"
      pattern: "tenant_id = \\(select current_setting\\('app\\.tenant_id'"
    - from: "admin/staff policies"
      to: "tenant_memberships table"
      via: "is_tenant_member() helper function"
      pattern: "is_tenant_member\\(ARRAY"
    - from: "is_admin()"
      to: "tenant_memberships"
      via: "EXISTS subquery on tenant_memberships with role IN ('owner','admin')"
      pattern: "tenant_memberships"
---

<objective>
Rewrite all RLS policies on 48 tenant-scoped tables in a single atomic migration.

Purpose: This is the core of Phase 30. It replaces 97 existing RLS policies (which use `profiles.role`, `auth.uid() IS NOT NULL`, `auth.role() = 'service_role'`, and `email LIKE '%@littlecafe.com'` patterns) with new policies that enforce tenant isolation via `tenant_id = current_setting('app.tenant_id')::uuid`. Admin access switches from `profiles.role = 'admin'` to `tenant_memberships` checks. The migration is wrapped in BEGIN/COMMIT for atomicity -- no window where tables have no policies.

Output: One forward migration file (helpers + drop old + create new) and one rollback migration file.
</objective>

<execution_context>
@~/.gsd/workflows/execute-plan.md
@~/.gsd/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phase-30/30-CONTEXT.md
@.planning/phase-30/30-RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create the RLS policy rewrite migration</name>
  <files>supabase/migrations/20260213300000_rls_policy_rewrite.sql</files>
  <action>
Create a single SQL migration file wrapped in BEGIN/COMMIT with these sections in order:

**Section 1: Helper Functions (3 functions)**

1. `CREATE OR REPLACE FUNCTION public.is_tenant_member(p_roles text[] DEFAULT ARRAY['owner','admin','staff','customer'])` -- SECURITY DEFINER, SET search_path = ''. Body: `RETURN EXISTS (SELECT 1 FROM public.tenant_memberships WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid AND user_id = auth.uid() AND role = ANY(p_roles));`

2. `CREATE OR REPLACE FUNCTION public.is_admin()` -- SECURITY DEFINER, SET search_path = ''. Body: `RETURN EXISTS (SELECT 1 FROM public.tenant_memberships WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid AND user_id = auth.uid() AND role IN ('owner', 'admin'));`

3. `CREATE OR REPLACE FUNCTION public.get_admin_user_id()` -- SECURITY DEFINER, SET search_path = ''. Body: `IF public.is_admin() THEN RETURN auth.uid(); ELSE RAISE EXCEPTION 'Access denied: Admin privileges required'; END IF;`

**Section 2: Drop ALL existing policies on 48 tenant-scoped tables**

Use `DROP POLICY IF EXISTS` for every policy listed in 30-RESEARCH.md. The full list (97 policies):

- orders: "Users can view own orders", "Users can create orders", "Users can update own pending orders", "Anonymous users can create orders", "Staff can view all orders", "Staff can update order status"
- order_items: "Users can view own order items", "Users can create order items"
- user_favorites: "Users can view own favorites", "Users can manage own favorites"
- user_addresses: "Users can view own addresses", "Users can manage own addresses"
- inventory_items: "Authenticated users can manage inventory items", "Service role can manage inventory items"
- suppliers: "Authenticated users can manage suppliers", "Service role can manage suppliers"
- stock_movements: "Authenticated users can view stock movements", "Authenticated users can insert stock movements", "Service role can manage stock movements"
- purchase_orders: "Authenticated users can manage purchase orders", "Service role can manage purchase orders"
- purchase_order_items: "Authenticated users can manage purchase order items", "Service role can manage purchase order items"
- low_stock_alerts: "Authenticated users can manage low stock alerts", "Service role can manage low stock alerts"
- recipe_ingredients: "Authenticated users can manage recipe ingredients", "Service role can manage recipe ingredients"
- inventory_settings: "Allow authenticated access to inventory_settings"
- inventory_locations: "Allow authenticated access to inventory_locations"
- inventory_unit_types: "Allow authenticated access to inventory_unit_types"
- invoices: "Admins can manage invoices"
- invoice_items: "Admins can manage invoice items"
- order_invoice_matches: "Admins can manage order invoice matches"
- supplier_invoice_templates: "Admins can manage supplier invoice templates"
- invoice_import_sessions: "Admins can manage their own import sessions", "Admins can view all import sessions"
- notifications: "Users can view own notifications", "Users can update own notifications", "Authenticated users can insert notifications", "Service role can manage notifications"
- webhook_events: "Admin can manage webhook events"
- site_settings: "Allow read access to site settings", "Admins can insert site settings", "Admins can update site settings"
- inventory_sales_sync_runs: "Service role can manage sales sync runs", "Authenticated read sales sync runs"
- sales_transactions: "Service role can manage sales transactions", "Authenticated read sales transactions"
- sales_transaction_items: "Service role can manage sales transaction items", "Authenticated read sales transaction items"
- purchase_order_status_history: "Service role manages purchase order history", "Authenticated users can read purchase order history", "Admins can insert purchase order history"
- purchase_order_attachments: "Service role manages purchase order attachments", "Authenticated users can view purchase order attachments", "Authenticated users can insert purchase order attachments", "Authenticated users can update purchase order attachments", "Authenticated users can delete purchase order attachments"
- purchase_order_receipts: "Service role manages purchase order receipts", "Authenticated users can view purchase order receipts", "Authenticated users can insert purchase order receipts"
- supplier_email_templates: "Service role manages supplier email templates", "Authenticated users can view supplier email templates", "Authenticated users can manage supplier email templates"
- inventory_item_cost_history: "inventory_cost_history_read", "inventory_cost_history_insert"
- cogs_periods: "Service role manages cogs periods", "Authenticated users can read cogs periods"
- inventory_valuations: "Service role manages inventory valuations", "Authenticated users can read inventory valuations"
- cogs_reports: "Service role manages cogs reports", "Authenticated users can read cogs reports"
- cogs_products: "Service role manages cogs products", "Authenticated users can read cogs products"
- cogs_sellables: "Service role manages cogs sellables", "Authenticated users can read cogs sellables"
- cogs_sellable_aliases: "Service role manages cogs sellable aliases", "Authenticated users can read cogs sellable aliases"
- cogs_product_recipes: "Service role manages product recipes", "Authenticated users can read product recipes"
- cogs_product_recipe_lines: "Service role manages product recipe lines", "Authenticated users can read product recipe lines"
- cogs_sellable_recipe_overrides: "Service role manages sellable overrides", "Authenticated users can read sellable overrides"
- cogs_sellable_recipe_override_ops: "Service role manages sellable override ops", "Authenticated users can read sellable override ops"
- cogs_modifier_sets: "Service role manages cogs modifier sets", "Authenticated users can read cogs modifier sets"
- cogs_modifier_options: "Service role manages cogs modifier options", "Authenticated users can read cogs modifier options"
- cogs_modifier_option_recipes: "Service role manages modifier option recipes", "Authenticated users can read modifier option recipes"
- cogs_modifier_option_recipe_lines: "Service role manages modifier option recipe lines", "Authenticated users can read modifier option recipe lines"
- kds_categories: "Service role manages kds_categories", "Anyone can read kds_categories"
- kds_menu_items: "Service role manages kds_menu_items", "Anyone can read kds_menu_items"
- kds_settings: "Service role manages kds_settings", "Anyone can read kds_settings"
- kds_images: "Service role manages kds_images", "Anyone can read kds_images"

Also drop policies from `inventory_items_rls_update` and `inventory_rls_fix` files if they exist:
- inventory_items: "Admin users can manage inventory items"
- stock_movements: "Admin users can manage stock movements"
- (Use IF EXISTS on all drops so it's safe if some don't exist)

**Section 3: Ensure RLS is enabled on all 48 tables**

Add `ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;` for all 48 tables. This is idempotent -- safe to run even if already enabled. Include ALL tables to ensure no table was missed.

**Section 4: Create new policies by category**

Use these exact SQL patterns, with `(select current_setting('app.tenant_id', true))::uuid` and `(select auth.uid())` for initPlan caching:

**Category A (1 table: site_settings):**
```sql
-- Public read (anyone with tenant context)
CREATE POLICY "tenant_select_site_settings" ON public.site_settings
  FOR SELECT USING (tenant_id = (select current_setting('app.tenant_id', true))::uuid);

-- Admin write (owner/admin only)
CREATE POLICY "tenant_admin_insert_site_settings" ON public.site_settings
  FOR INSERT WITH CHECK (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );
CREATE POLICY "tenant_admin_update_site_settings" ON public.site_settings
  FOR UPDATE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );
CREATE POLICY "tenant_admin_delete_site_settings" ON public.site_settings
  FOR DELETE USING (
    tenant_id = (select current_setting('app.tenant_id', true))::uuid
    AND (select public.is_tenant_member(ARRAY['owner','admin']))
  );
```

**Category B (5 tables: orders, order_items, user_favorites, user_addresses, notifications):**

For `orders`:
- SELECT own: `tenant_id match AND user_id = (select auth.uid())`
- INSERT own: `tenant_id match AND user_id = (select auth.uid())`
- UPDATE own pending: `tenant_id match AND user_id = (select auth.uid()) AND status = 'pending'`
- INSERT anonymous: `tenant_id match AND user_id IS NULL` (guest checkout)
- Admin SELECT all: `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`
- Admin UPDATE all: `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`

For `order_items`:
- SELECT own: `tenant_id match AND EXISTS (select 1 from orders where orders.id = order_items.order_id AND (orders.user_id = (select auth.uid()) OR orders.user_id IS NULL))`
- INSERT own: Same WITH CHECK
- Admin SELECT all: `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`
- Admin INSERT: `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`

For `user_favorites`:
- SELECT own: `tenant_id match AND user_id = (select auth.uid())`
- INSERT own: `tenant_id match AND user_id = (select auth.uid())`
- UPDATE own: `tenant_id match AND user_id = (select auth.uid())`
- DELETE own: `tenant_id match AND user_id = (select auth.uid())`

For `user_addresses`:
- Same pattern as user_favorites (SELECT/INSERT/UPDATE/DELETE own)

For `notifications`:
- SELECT own: `tenant_id match AND user_id = (select auth.uid())`
- UPDATE own: `tenant_id match AND user_id = (select auth.uid())`
- INSERT system: `tenant_id match AND (select auth.uid()) IS NOT NULL` (any authenticated user can insert, service role bypasses anyway)
- Admin SELECT all: `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`

**Category C (4 tables: kds_categories, kds_menu_items, kds_settings, kds_images):**

For each KDS table:
- SELECT: `tenant_id match AND is_tenant_member(ARRAY['owner','admin','staff'])`
- INSERT: `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`
- UPDATE: `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`
- DELETE: `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`

**Category D (37 tables):**

For each admin table, create exactly 4 policies:
- `tenant_staff_select_{table}`: SELECT with `tenant_id match AND is_tenant_member(ARRAY['owner','admin','staff'])`
- `tenant_admin_insert_{table}`: INSERT with `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`
- `tenant_admin_update_{table}`: UPDATE with `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`
- `tenant_admin_delete_{table}`: DELETE with `tenant_id match AND is_tenant_member(ARRAY['owner','admin'])`

The 37 Category D tables are: suppliers, inventory_items, stock_movements, purchase_orders, purchase_order_items, purchase_order_status_history, purchase_order_attachments, purchase_order_receipts, low_stock_alerts, recipe_ingredients, inventory_settings, inventory_locations, inventory_unit_types, invoices, invoice_items, order_invoice_matches, supplier_invoice_templates, invoice_import_sessions, supplier_email_templates, webhook_events, inventory_sales_sync_runs, sales_transactions, sales_transaction_items, inventory_item_cost_history, inventory_valuations, cogs_periods, cogs_reports, cogs_products, cogs_sellables, cogs_sellable_aliases, cogs_product_recipes, cogs_product_recipe_lines, cogs_sellable_recipe_overrides, cogs_sellable_recipe_override_ops, cogs_modifier_sets, cogs_modifier_options, cogs_modifier_option_recipes, cogs_modifier_option_recipe_lines.

**IMPORTANT patterns to use consistently:**
- Always: `(select current_setting('app.tenant_id', true))::uuid` (not `current_setting(...)::uuid` without select wrapper)
- Always: `(select auth.uid())` (not `auth.uid()` without select wrapper)
- Always: `(select public.is_tenant_member(...))` (with select wrapper for initPlan caching)
- Policy names: use snake_case prefixed with `tenant_` (e.g., `tenant_staff_select_inventory_items`)
- No `auth.role() = 'service_role'` policies -- service role bypasses RLS entirely
- No `FOR ALL` policies -- use separate SELECT/INSERT/UPDATE/DELETE for clarity

**Note on `inventory_movements` vs `stock_movements`:** The research audit lists `stock_movements` as the table name. The `update_inventory_stock` function references `inventory_movements`. Check which name is actually used. The table was created as `stock_movements` in the initial schema. The function's reference to `inventory_movements` may be a bug in the function (it has an exception handler for undefined_table). Use `stock_movements` as the policy target.
  </action>
  <verify>
1. Verify the migration file has correct structure: `grep -c "DROP POLICY" supabase/migrations/20260213300000_rls_policy_rewrite.sql` should return ~97+
2. Verify new policy count: `grep -c "CREATE POLICY" supabase/migrations/20260213300000_rls_policy_rewrite.sql` should return ~100+
3. Verify helper functions: `grep "CREATE OR REPLACE FUNCTION" supabase/migrations/20260213300000_rls_policy_rewrite.sql` should show 3 functions
4. Verify all 48 tables have ENABLE ROW LEVEL SECURITY
5. Verify BEGIN/COMMIT wrapping
6. Verify consistent use of `(select current_setting('app.tenant_id', true))::uuid` pattern (no bare `current_setting` without select wrapper)
7. Verify no `auth.role() = 'service_role'` in any new policy
  </verify>
  <done>
Single atomic migration exists with: 3 helper functions, ~97 DROP POLICY statements, ENABLE RLS on all 48 tables, and ~100+ CREATE POLICY statements covering all 4 categories. All policies use initPlan-optimized patterns.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create rollback migration</name>
  <files>supabase/migrations/20260213300099_rollback_rls_rewrite.sql</files>
  <action>
Create a rollback migration that:

1. Drops ALL new policies created in the forward migration (DROP POLICY IF EXISTS for every `tenant_*` policy name)
2. Drops the `is_tenant_member` function: `DROP FUNCTION IF EXISTS public.is_tenant_member(text[]);`
3. Restores old `is_admin()` function: `CREATE OR REPLACE FUNCTION public.is_admin()` with the old body checking `profiles.role = 'admin'` (from 20260130205344_fix_function_search_paths.sql)
4. Restores old `get_admin_user_id()` function with old body calling old `is_admin()`

**Do NOT restore old policies** -- the rollback just drops new policies and restores helper functions. Old policies would need to be restored manually from the original migration files if needed. The rollback script should have a comment at the top explaining this.

Wrap in BEGIN/COMMIT.

Mark the file with a comment: `-- ROLLBACK ONLY: Do not apply unless reverting Phase 30 RLS migration`
  </action>
  <verify>
1. File exists and has DROP POLICY IF EXISTS for all `tenant_*` policies
2. File restores old is_admin() and get_admin_user_id() functions
3. File drops is_tenant_member() function
  </verify>
  <done>Rollback migration exists that can cleanly revert the RLS rewrite by dropping new policies and restoring old helper functions.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Core RLS policy rewrite migration covering all 48 tenant-scoped tables with 4 policy categories, 3 helper functions, and a rollback script.</what-built>
  <how-to-verify>
1. Review the migration file structure:
   - Open `supabase/migrations/20260213300000_rls_policy_rewrite.sql`
   - Verify it starts with BEGIN and ends with COMMIT
   - Spot-check a few policy names match expected patterns
2. Quick sanity check of policy categories:
   - Confirm `site_settings` has public SELECT (no auth check)
   - Confirm `orders` has both user_id-scoped and anonymous INSERT policies
   - Confirm KDS tables require `is_tenant_member(ARRAY['owner','admin','staff'])` for SELECT
   - Confirm admin tables use `is_tenant_member(ARRAY['owner','admin'])` for writes
3. Verify the `is_admin()` rewrite checks `tenant_memberships` not `profiles.role`
4. Do NOT apply the migration yet -- just review the SQL
  </how-to-verify>
  <resume-signal>Type "approved" to proceed to Plan 02 (SECURITY DEFINER functions + storage), or describe issues to fix</resume-signal>
</task>

</tasks>

<verification>
- Migration file has BEGIN/COMMIT wrapping
- All 48 tables have ENABLE ROW LEVEL SECURITY
- All 97+ old policies dropped with DROP POLICY IF EXISTS
- All new policies use `(select current_setting('app.tenant_id', true))::uuid` pattern
- All new policies use `(select auth.uid())` pattern
- All admin checks use `is_tenant_member()` or `is_admin()` (not `profiles.role`)
- No `auth.role() = 'service_role'` in any new policy
- Rollback script can cleanly revert
</verification>

<success_criteria>
- Forward migration file covers all 48 tables with correct category assignments
- Helper functions (is_tenant_member, is_admin, get_admin_user_id) are tenant-aware
- Guest checkout preserved (anonymous INSERT on orders)
- Rollback migration exists and is correct
- Human review confirms policy structure before application
</success_criteria>

<output>
After completion, create `.planning/phase-30/30-01-SUMMARY.md`
</output>
