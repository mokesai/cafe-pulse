# Context: Phase 30 — RLS Policy Rewrite

## Goals
- Rewrite all RLS policies on 48 tenant-scoped tables to include `tenant_id = current_setting('app.tenant_id')::uuid`
- Switch admin policies from `profiles.role = 'admin'` to `tenant_memberships` checks
- Enable RLS on ALL 48 tenant-scoped tables (some currently have none)
- Update storage bucket policies to use tenant_memberships
- Rewrite helper functions (`is_admin()`, `get_admin_user_id()`) to be tenant-aware

## Constraints
- Must not break existing single-tenant functionality (default tenant still works)
- Service role bypasses RLS — no changes needed for service role policies (they stay as-is)
- Database views with `security_invoker = true` inherit RLS from underlying tables — no special handling
- All work on `features/multi-tenant-saas` branch
- Dev Supabase project: `ofppjltowsdvojixeflr`

## Decisions

### Customer Data Isolation
- **Fully isolated per tenant**: Orders, favorites, addresses scoped to tenant_id. A user on tenant B sees zero data from tenant A.
- **Global auth identity**: Supabase auth is shared across tenants. A logged-in user can visit any tenant's site without re-registering.
- **Global profiles**: `profiles` table has NO tenant_id. One profile per auth user, shared across tenants. Profile-level RLS stays as-is (`auth.uid() = id`).
- **Per-tenant favorites/addresses**: Favorites and addresses are tenant-scoped. A user's favorites at Cafe A don't appear at Cafe B.

### Admin Access Model
- **Multi-tenant admin supported**: A user can have `tenant_memberships` rows for multiple tenants, each with its own role.
- **Three-tier roles for RLS**: `owner`, `admin`, `staff` (plus `customer` which has no admin access).
  - **owner + admin**: Full CRUD on all tenant data.
  - **staff**: SELECT only on admin tables.
- **Email-domain staff check eliminated**: Kill `email LIKE '%@littlecafe.com'` entirely. All access control via `tenant_memberships`.
- **Platform super-admin via service role**: No special RLS policies. Platform admin uses service role client (bypasses RLS). Phase 60 builds the UI.

### Anonymous/Guest Scoping
- **Trust `app.tenant_id` for anonymous access**: Middleware sets tenant context from subdomain. RLS checks `tenant_id` match. No auth required for public reads.
- **Public reads for menu/categories**: Menu items, categories — tenant-scoped, no auth required. Anyone on the tenant's site can browse.
- **KDS requires authentication**: KDS tables (kds_categories, kds_menu_items, kds_settings, kds_images) require auth — any tenant member (owner/admin/staff) can view.
- **Guest checkout preserved**: Anonymous orders scoped by `tenant_id` with `user_id IS NULL`. Current guest checkout behavior maintained per-tenant.

### Tables Exempt from Tenant RLS
- **`tenants`**: Global table, keeps current policy ("Anyone can read active tenants"). No tenant_id on itself.
- **`tenant_memberships`**: Global table, keeps current per-user/per-tenant policies. No additional tenant scoping.
- **`profiles`**: Global table (no tenant_id), keeps current `auth.uid()`-based policies.

### Helper Functions
- **Rewrite `is_admin()` to be tenant-aware**: Must check `tenant_memberships` for the current tenant (`app.tenant_id`) instead of `profiles.role`.
- **Rewrite `get_admin_user_id()`**: Same tenant-aware approach.

### Storage Policies
- **Update storage bucket policies**: Switch from `profiles.role = 'admin'` to `tenant_memberships`-based admin checks (consistent with table policies).

### Views
- **No special handling**: `po_supplier_metrics_v` and `view_pending_manual_inventory_deductions` have `security_invoker = true` — they automatically inherit tenant-scoped RLS from underlying tables.

## Open Questions
- None — all gray areas resolved.

## Deferred (Not Phase 30)
- UNIQUE constraint conflicts for multi-tenant data (Phase 30+ per STATE.md known issues)
- `site_settings` singleton pattern (`id = 1`) conflict (Phase 30+ per STATE.md)
- DEFAULT on tenant_id removal (Phase 40)
- Platform admin UI (Phase 60)

## Policy Pattern Summary

For implementation reference, the three policy patterns needed:

1. **Public read (menu, categories)**: `tenant_id = current_setting('app.tenant_id')::uuid` — no auth check
2. **Authenticated tenant member**: `tenant_id = current_setting('app.tenant_id')::uuid AND EXISTS (SELECT 1 FROM tenant_memberships WHERE tenant_id = ... AND user_id = auth.uid())`
3. **Admin/owner write**: `tenant_id = current_setting('app.tenant_id')::uuid AND EXISTS (SELECT 1 FROM tenant_memberships WHERE tenant_id = ... AND user_id = auth.uid() AND role IN ('owner', 'admin'))`
4. **Staff read-only admin**: Same as #3 but for SELECT, with role IN ('owner', 'admin', 'staff')

## Table Classification (for researcher)

Researcher should classify all 48 tables into:
- **Public read** (no auth): menu-facing tables customers need to browse
- **Customer-scoped** (auth.uid() + tenant_id): orders, favorites, addresses
- **KDS** (any tenant member + tenant_id): kds_categories, kds_menu_items, kds_settings, kds_images
- **Admin** (owner/admin write, staff read + tenant_id): inventory, POs, invoices, COGS, etc.
