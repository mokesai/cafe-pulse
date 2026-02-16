# Context: Phase 60 — Platform Control Plane

## Goals
Build the super-admin interface for managing tenants, including onboarding flow for new cafes and tenant status monitoring.

**Primary objective:** Enable platform administrators to create, configure, and monitor multiple tenant instances through a dedicated `/platform` route group.

## Constraints
- Phase 60 scope is FIXED per ROADMAP.md - platform control plane only
- Billing/payment processing for tenants is OUT OF SCOPE (defer to future phase)
- Advanced analytics (order volume, revenue trends) is OUT OF SCOPE (defer to future phase)
- Multi-environment per-tenant support (sandbox + production) is IN SCOPE

## Decisions

### Platform Super-Admin Identity & Access
- **platform_admins table**: Create dedicated table to track platform admin memberships (separate from tenant_memberships)
- **2FA enforcement**: Require password + 2FA for all `/platform` route access
- **Dual roles allowed**: Platform admins can ALSO be members of individual tenants via tenant_memberships
- **No auto-impersonation**: When platform admin accesses tenant routes (e.g., `littlecafe.localhost:3000/admin`), normal tenant_memberships permissions apply - no special platform admin privileges on tenant routes
- **Authentication flow**: Same Supabase auth backend, middleware checks platform_admins table after login before allowing /platform access

### Onboarding Flow Structure & Data Collection
- **Minimal-first approach**: Bare minimum to create tenant (slug, business name, admin account, Square credentials), then redirect to "complete your profile" flow within tenant's own admin panel
- **Required fields**:
  - Tenant slug (subdomain identifier, e.g., "littlecafe")
  - Business name (display name, e.g., "Little Cafe at Kaiser Permanente")
  - Admin email + password (creates first tenant admin account during onboarding)
  - Square credentials (app ID, access token, location ID, merchant ID)
- **Square OAuth flow**: Use Square's OAuth authorization flow to automatically capture credentials - NOT manual text entry
- **Dual environment support**: Each tenant can store BOTH sandbox and production Square credentials, with ability to toggle which is active

### Tenant Lifecycle Operations
- **Fully editable post-creation**:
  - Business name and branding (logo, colors) - YES
  - Tenant slug (subdomain) - YES (warn about breaking customer bookmarks)
  - Square credentials (switch accounts or rotate tokens) - YES
  - Environment toggle (sandbox ↔ production) - YES
- **Multiple status states**: Support `trial`, `active`, `paused`, `suspended` states (billing lifecycle)
  - `trial`: Limited-time evaluation period
  - `active`: Fully operational, accepting orders
  - `paused`: Billing paused, site still operational
  - `suspended`: Admin-imposed suspension, blocks all access
- **Soft delete with retention**: Mark tenant as deleted, hide from lists, retain data for 30 days, then hard delete (allows recovery window)
- **Ownership transfer**: Platform admins can promote existing tenant members (admin/staff) to owner role - cannot transfer to external users

### Monitoring Dashboard Scope & Interactions
- **Configuration completeness focus**: Dashboard shows which tenants have complete setup vs missing pieces (credentials set, branding configured, etc.) - NOT business analytics
- **Manual refresh**: Dashboard shows cached data by default, user clicks "Refresh" button to fetch latest
- **View-only impersonation**: Platform admins can open tenant admin panels in read-only mode - can see all data but cannot make edits
- **Drill-down interactions**:
  - Click tenant → dedicated detail page (full config, logs, activity timeline)
  - Recent error logs expandable inline (click error count to see last 10 failures)
  - Search and filter: search by name/slug, filter by status, sort by created date or activity
  - Quick actions on hover: pause, edit, view-only mode

## Open Questions
None - all key decisions captured above. Researcher and planner can proceed.

## Deferred Ideas
- **Billing/subscription management**: Monthly recurring billing, payment method capture, invoice generation (defer to Phase 70+)
- **Business analytics**: Order volume charts, revenue trends, customer growth metrics (defer to Phase 70+)
- **Tenant cloning**: Duplicate tenant configuration to create new tenant from template (defer to Phase 70+)
- **Bulk operations**: Multi-select tenants for batch pause/suspend/delete (defer to Phase 70+)
