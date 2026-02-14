---
phase: 30-rls-policy-rewrite
plan: 02
type: execute
wave: 2
depends_on: ["30-01"]
files_modified:
  - supabase/migrations/20260213300001_update_security_definer_functions.sql
  - supabase/migrations/20260213300002_rewrite_storage_policies.sql
autonomous: true

must_haves:
  truths:
    - "update_inventory_stock() filters by tenant_id in all WHERE clauses"
    - "update_stock_simple() filters by tenant_id in WHERE clause"
    - "create_order_notification() includes tenant_id in INSERT"
    - "get_unread_notification_count() filters by tenant_id"
    - "mark_all_notifications_read() filters by tenant_id"
    - "invoices storage bucket uses tenant_memberships for admin check"
    - "purchase-order-attachments storage bucket uses tenant_memberships for admin check"
  artifacts:
    - path: "supabase/migrations/20260213300001_update_security_definer_functions.sql"
      provides: "Tenant-aware SECURITY DEFINER function rewrites"
      contains: "current_setting('app.tenant_id'"
    - path: "supabase/migrations/20260213300002_rewrite_storage_policies.sql"
      provides: "Storage bucket policy rewrite using tenant_memberships"
      contains: "tenant_memberships"
  key_links:
    - from: "SECURITY DEFINER functions"
      to: "current_setting('app.tenant_id', true)"
      via: "WHERE tenant_id filter in function body"
      pattern: "tenant_id = \\(current_setting\\('app\\.tenant_id'"
    - from: "storage policies"
      to: "tenant_memberships"
      via: "EXISTS subquery checking admin role"
      pattern: "tenant_memberships"
---

<objective>
Update 5 SECURITY DEFINER functions and 8 storage bucket policies for tenant awareness.

Purpose: SECURITY DEFINER functions bypass RLS (they run as the function owner). Without explicit tenant_id filtering in the function body, they could leak or modify data across tenants. Storage bucket policies currently use `profiles.role = 'admin'` which must switch to `tenant_memberships` checks, consistent with the table policy rewrite in Plan 01.

Output: Two migration files -- one for function updates, one for storage policy rewrites.
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
@.planning/phase-30/30-01-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update SECURITY DEFINER functions with tenant_id filtering</name>
  <files>supabase/migrations/20260213300001_update_security_definer_functions.sql</files>
  <action>
Create a migration file wrapped in BEGIN/COMMIT that uses CREATE OR REPLACE FUNCTION to update all 5 SECURITY DEFINER functions. Each function must add `AND tenant_id = (current_setting('app.tenant_id', true))::uuid` to its WHERE clauses. All functions keep SECURITY DEFINER and add `SET search_path = ''` if not already present.

**1. update_inventory_stock(item_id UUID, quantity_change INTEGER, operation_type TEXT, notes TEXT)**

Current body has:
- `UPDATE inventory_items SET ... WHERE id = item_id`
- `INSERT INTO inventory_movements (...)`
- Exception handler with duplicate UPDATE

Add `AND tenant_id = (current_setting('app.tenant_id', true))::uuid` to both UPDATE WHERE clauses. For the INSERT into inventory_movements (which is actually `stock_movements` -- check the actual table name in the database), add `tenant_id` to the INSERT column list and value list, getting it from `(current_setting('app.tenant_id', true))::uuid`.

**IMPORTANT:** The original function references `inventory_movements` but the actual table is `stock_movements`. Update the function to use the correct table name `stock_movements`. Keep the exception handler for backward compatibility but also update it.

```sql
CREATE OR REPLACE FUNCTION public.update_inventory_stock(
  item_id UUID,
  quantity_change INTEGER,
  operation_type TEXT DEFAULT 'manual',
  notes TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid := (current_setting('app.tenant_id', true))::uuid;
BEGIN
  UPDATE public.inventory_items
  SET
    current_stock = current_stock + quantity_change,
    last_restocked_at = CASE WHEN quantity_change > 0 THEN NOW() ELSE last_restocked_at END,
    updated_at = NOW()
  WHERE id = item_id AND tenant_id = v_tenant_id;

  INSERT INTO public.stock_movements (
    inventory_item_id, movement_type, quantity, notes, tenant_id, created_at
  ) VALUES (
    item_id,
    CASE WHEN quantity_change > 0 THEN 'stock_in' ELSE 'stock_out' END,
    ABS(quantity_change),
    COALESCE(notes, operation_type),
    v_tenant_id,
    NOW()
  );
EXCEPTION
  WHEN undefined_table THEN
    UPDATE public.inventory_items
    SET
      current_stock = current_stock + quantity_change,
      last_restocked_at = CASE WHEN quantity_change > 0 THEN NOW() ELSE last_restocked_at END,
      updated_at = NOW()
    WHERE id = item_id AND tenant_id = v_tenant_id;
END;
$$;
```

**2. update_stock_simple(item_id UUID, new_stock INTEGER)**

```sql
CREATE OR REPLACE FUNCTION public.update_stock_simple(
  item_id UUID,
  new_stock INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.inventory_items
  SET current_stock = new_stock, updated_at = NOW()
  WHERE id = item_id
    AND tenant_id = (current_setting('app.tenant_id', true))::uuid;
END;
$$;
```

**3. create_order_notification(p_user_id UUID, p_order_id UUID, p_status VARCHAR, p_order_number VARCHAR)**

Add tenant_id to the INSERT into notifications. Read tenant_id from session variable since this function is called in the context of a request that has tenant context set.

```sql
CREATE OR REPLACE FUNCTION public.create_order_notification(
    p_user_id UUID,
    p_order_id UUID,
    p_status VARCHAR(50),
    p_order_number VARCHAR(50)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    notification_id UUID;
    notification_title VARCHAR(255);
    notification_message TEXT;
    v_tenant_id uuid := (current_setting('app.tenant_id', true))::uuid;
BEGIN
    -- Set title and message based on order status (same CASE logic as original)
    CASE p_status
        WHEN 'confirmed' THEN
            notification_title := 'Order Confirmed';
            notification_message := 'Your order #' || p_order_number || ' has been confirmed and is being prepared.';
        WHEN 'preparing' THEN
            notification_title := 'Order Being Prepared';
            notification_message := 'Your order #' || p_order_number || ' is currently being prepared.';
        WHEN 'ready' THEN
            notification_title := 'Order Ready';
            notification_message := 'Your order #' || p_order_number || ' is ready for pickup!';
        WHEN 'completed' THEN
            notification_title := 'Order Complete';
            notification_message := 'Thank you! Your order #' || p_order_number || ' has been completed.';
        WHEN 'cancelled' THEN
            notification_title := 'Order Cancelled';
            notification_message := 'Your order #' || p_order_number || ' has been cancelled.';
        ELSE
            notification_title := 'Order Update';
            notification_message := 'Your order #' || p_order_number || ' status has been updated to ' || p_status || '.';
    END CASE;

    INSERT INTO public.notifications (
        user_id, title, message, type, action_url, data, tenant_id
    ) VALUES (
        p_user_id,
        notification_title,
        notification_message,
        'order_status',
        '/orders',
        jsonb_build_object('order_id', p_order_id, 'order_number', p_order_number, 'status', p_status),
        v_tenant_id
    ) RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$$;
```

Note: The function signature does NOT change (no new parameter). The tenant_id comes from the session variable, not a parameter. This avoids breaking existing callers.

**4. get_unread_notification_count(p_user_id UUID)**

```sql
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM public.notifications
        WHERE user_id = p_user_id
          AND read = FALSE
          AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    );
END;
$$;
```

**5. mark_all_notifications_read(p_user_id UUID)**

```sql
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE public.notifications
    SET read = TRUE
    WHERE user_id = p_user_id
      AND read = FALSE
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$;
```

Keep existing GRANT statements for authenticated role on update_inventory_stock and update_stock_simple.
  </action>
  <verify>
1. `grep -c "current_setting('app.tenant_id'" supabase/migrations/20260213300001_update_security_definer_functions.sql` should return 7+ (one per function WHERE/INSERT, some have multiple)
2. `grep -c "CREATE OR REPLACE FUNCTION" supabase/migrations/20260213300001_update_security_definer_functions.sql` should return 5
3. All functions have SECURITY DEFINER and SET search_path = ''
4. BEGIN/COMMIT wrapping present
  </verify>
  <done>All 5 SECURITY DEFINER functions updated with tenant_id filtering in WHERE clauses and INSERT statements. Function signatures unchanged to maintain backward compatibility.</done>
</task>

<task type="auto">
  <name>Task 2: Rewrite storage bucket policies</name>
  <files>supabase/migrations/20260213300002_rewrite_storage_policies.sql</files>
  <action>
Create a migration file wrapped in BEGIN/COMMIT that drops old storage policies and creates new ones using `tenant_memberships` checks.

**Invoices bucket (4 policies to drop, 4 to create):**

Drop old:
```sql
DROP POLICY IF EXISTS "Admins can upload invoice files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can access invoice files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update invoice files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete invoice files" ON storage.objects;
```

Create new -- since `storage.objects` has no `tenant_id` column, we check `tenant_memberships` for admin role (any tenant the user is admin of). This is acceptable because file paths are already keyed by invoice data which is tenant-scoped via RLS on the invoices table. The storage policy just needs to confirm the user is a tenant admin somewhere.

```sql
CREATE POLICY "tenant_admin_insert_invoices" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_select_invoices" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_update_invoices" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_delete_invoices" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );
```

**Purchase-order-attachments bucket (4 policies to drop, 4 to create):**

Drop old:
```sql
DROP POLICY IF EXISTS "Authenticated users can upload purchase order attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update purchase order attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete purchase order attachments" ON storage.objects;
DROP POLICY IF EXISTS "Purchase order attachments public read" ON storage.objects;
```

Create new -- PO attachments need admin/owner for writes, but for SELECT allow any tenant member (staff need to view PO attachments):

```sql
CREATE POLICY "tenant_member_select_po_attachments" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'purchase-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin', 'staff')
    )
  );

CREATE POLICY "tenant_admin_insert_po_attachments" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'purchase-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_update_po_attachments" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'purchase-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tenant_admin_delete_po_attachments" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'purchase-order-attachments'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (current_setting('app.tenant_id', true))::uuid
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
    )
  );
```

Note: The `purchase-order-attachments` bucket was previously public. We are intentionally restricting SELECT to tenant members (staff/admin/owner). If public read is needed (e.g., for email links), this can be revisited. For now, restrict to authenticated tenant members.
  </action>
  <verify>
1. `grep -c "DROP POLICY" supabase/migrations/20260213300002_rewrite_storage_policies.sql` should return 8
2. `grep -c "CREATE POLICY" supabase/migrations/20260213300002_rewrite_storage_policies.sql` should return 8
3. All new policies reference `tenant_memberships` (not `profiles.role`)
4. All new policies reference `current_setting('app.tenant_id', true)`
5. BEGIN/COMMIT wrapping present
  </verify>
  <done>All 8 storage policies (4 per bucket) dropped and rewritten with tenant_memberships checks. Invoice bucket restricted to admin/owner. PO attachments restricted to tenant members (SELECT) and admin/owner (writes).</done>
</task>

</tasks>

<verification>
- All 5 SECURITY DEFINER functions have tenant_id WHERE clauses
- Function signatures unchanged (backward compatible)
- All 8 storage policies use tenant_memberships instead of profiles.role
- No references to profiles.role = 'admin' in any new code
- Both migration files have BEGIN/COMMIT wrapping
</verification>

<success_criteria>
- SECURITY DEFINER functions cannot leak or modify cross-tenant data
- Storage bucket access requires tenant membership verification
- All existing callers of the 5 functions continue to work (no signature changes)
- create_order_notification includes tenant_id in INSERT automatically from session
</success_criteria>

<output>
After completion, create `.planning/phase-30/30-02-SUMMARY.md`
</output>
