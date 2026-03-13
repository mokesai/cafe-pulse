# Plan: Team Management & Role-Based Access

## Overview

Add team member invite and management capabilities across platform and tenant admin interfaces. This plan covers the full role hierarchy, invite flows, MFA enforcement, and customer tenant-scoping.

## Role Hierarchy

### Platform Roles (`platform_admins` table)

| Role | Scope | Access |
|------|-------|--------|
| super_admin | All tenants | `/platform/*` — full platform management |
| tenant_admin | Scoped tenants | `/platform/*` — scoped to assigned tenants |

### Tenant Roles (`tenant_memberships` table)

| Role | Access | Can Invite | Can Manage Team |
|------|--------|------------|-----------------|
| owner | `<slug>/admin/*` — full | admin, staff, customer | Yes (promote, demote, remove) |
| admin | `<slug>/admin/*` — full (for now) | staff, customer | No |
| staff | `<slug>/admin/*` — full (for now) | No | No |
| customer | `<slug>/(site)/*` only | No | No |

> **Future**: staff and admin will have selectively restricted access within `/admin/*`. The role column is already in place for this.

### Invite Permission Matrix

| Inviter | Can Invite Roles | Where |
|---------|-----------------|-------|
| super_admin | owner, admin, staff | `/platform/tenants/[id]` |
| tenant_admin (platform) | admin, staff | `/platform/tenants/[id]` |
| owner (app) | admin, staff | `<slug>/admin/team` |
| admin (app) | staff | `<slug>/admin/team` |

### Team Management Permissions (owner only)

- Promote admin → owner
- Demote owner → admin (cannot demote self if sole owner)
- Remove team members (soft-delete `tenant_memberships` row)
- Cannot remove self if sole owner

---

## Current State

### What exists:
- `tenant_memberships` table with roles: owner, admin, staff, customer
- `tenant_pending_invites` table for invite-before-login flow
- `requireAdmin()` checks membership for `owner` and `admin` roles only
- Tenant onboarding creates initial owner invite (super_admin only)
- `resendInvite()` action for pending invites
- Auto-claim on first login in `requireAdmin()` (Plan 90-04)
- MFA enforced only for `/platform/*` in middleware

### What's missing:
1. `staff` role not allowed in `requireAdmin()`
2. No invite UI on platform tenant detail page (beyond initial onboarding invite)
3. No team management page in tenant admin (`<slug>/admin/team`)
4. No MFA enforcement for app admins
5. Customer registration doesn't create `tenant_memberships` row
6. No team member list view anywhere

---

## Implementation Phases

### Phase 1: Foundation — Role Access & MFA

**1a. Allow `staff` role in `requireAdmin()`**

File: `src/lib/admin/auth.ts`

Change role filter from `['owner', 'admin']` to `['owner', 'admin', 'staff']`.

**1b. Enforce MFA for app admins**

File: `src/lib/admin/auth.ts`

After authentication check, verify MFA assurance level:
- Check `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`
- If `nextLevel === 'aal2'` and `currentLevel !== 'aal2'` → redirect to `/mfa-challenge`
- If no MFA enrolled → redirect to `/mfa-enroll`
- This mirrors the middleware logic for `/platform/*` but runs at the layout level

**1c. Customer tenant-scoping**

File: customer registration flow (existing signup/profile creation)

When a customer registers on `<slug>.<domain>`:
- Create `tenant_memberships` row with `role: 'customer'`
- All queries for orders, favorites, profile are already tenant-scoped via RLS

> Note: Identify where customer registration currently happens and add the membership creation there.

---

### Phase 2: Platform Team Management

Add a "Team Members" section to the platform tenant detail page.

**2a. Fetch and display team members**

File: `src/app/platform/tenants/[tenantId]/page.tsx`

Add a new card section showing:
- List of active `tenant_memberships` for this tenant (joined with auth.users for email)
- Each row: email, role, joined date, status
- Pending invites shown separately

**2b. Invite team member action**

File: `src/app/platform/tenants/actions.ts`

New server action: `inviteTeamMember(tenantId, email, role)`
- Auth: super_admin can invite any role; tenant_admin can invite admin/staff only
- Creates `tenant_pending_invites` row
- Sends Supabase invite email (or skips if user exists)
- Validates role is allowed for the inviter

**2c. Invite UI component**

File: `src/app/platform/tenants/[tenantId]/InviteTeamMember.tsx`

Form with:
- Email input
- Role dropdown (filtered by inviter's permissions)
- Submit button
- Success/error feedback

---

### Phase 3: App Admin Team Management

New page: `<slug>/admin/team`

**3a. Team list page**

File: `src/app/admin/(protected)/team/page.tsx`

Shows:
- All active team members (owner, admin, staff) with email, role, joined date
- Pending invites with status
- "Invite Team Member" button (owner and admin only)
- Management actions (owner only): promote, demote, remove

**3b. Invite team member action (app-level)**

File: `src/app/admin/(protected)/team/actions.ts`

New server action: `inviteAppTeamMember(email, role)`
- Gets tenant context from cookie
- Auth: owner can invite admin/staff; admin can invite staff only
- Creates `tenant_pending_invites` row
- Sends Supabase invite email with tenant-specific redirect URL

**3c. Team management actions (owner only)**

File: `src/app/admin/(protected)/team/actions.ts`

Server actions:
- `changeTeamMemberRole(membershipId, newRole)` — promote/demote
  - Only owner can call
  - Cannot promote to owner unless caller is owner
  - Cannot demote self if sole owner
- `removeTeamMember(membershipId)` — soft-delete
  - Only owner can call
  - Cannot remove self if sole owner
  - Sets `deleted_at` on the membership row

**3d. Sidebar navigation**

File: `src/app/admin/(protected)/layout.tsx`

Add "Team" link to sidebar nav (visible to owner and admin roles).

---

### Phase 4: Password Reset Flow Fixes

**4a. Smart redirect after password update**

File: `src/app/admin/update-password/page.tsx`

After setting password:
1. Sign out recovery session
2. Check user's roles via server action:
   - If `platform_admins` entry → redirect to `/admin/login?return=/platform&message=password-updated`
   - If `tenant_memberships` entry → look up tenant slug → redirect to `<slug>.<domain>/admin/login?message=password-updated`
   - If both → default to platform login
3. This requires a new server action: `getUserRedirectAfterPasswordReset()`

**4b. Neutral password reset pages**

Files: Move from `/admin/reset-password` and `/admin/update-password` to `/reset-password` and `/update-password` (root level, neutral branding).

These are shared by all admin types and always Café Pulse branded (bare domain).

---

## Database Changes

### Migration required: Add `invited_by` to `tenant_pending_invites`

```sql
ALTER TABLE tenant_pending_invites
  ADD COLUMN invited_by uuid REFERENCES auth.users(id);
```

Backfill existing rows with the super_admin user ID (jerrym@mokesai.org = `55943f8a-2e9c-4180-b44f-8865a5941eb9`) since all existing invites were created by super_admin during onboarding.

### No other schema changes needed
- `tenant_memberships` already has all required columns and roles (owner, admin, staff, customer)
- Soft-delete via `deleted_at` already in place
- Sole owner protection enforced at the application layer (server actions), not database constraints

### Future migration (not in scope)
- Role-specific permissions table when staff/admin access differentiation is needed

---

## Auth Flow Summary

### App Admin First Login (via invite)
1. Super_admin or owner invites user → `tenant_pending_invites` row created
2. Supabase invite email sent with tenant-specific redirect URL
3. User clicks link → lands on `<slug>.<domain>` → sets password
4. User logs in at `<slug>.<domain>/admin/login`
5. `requireAdmin()` auto-claims pending invite → creates `tenant_memberships` row
6. MFA enrollment required → `/mfa-enroll`
7. After MFA setup → `<slug>/admin/dashboard`

### Password Reset (any admin type)
1. Admin clicks "Forgot password" or receives reset from Supabase dashboard
2. Reset link → `<domain>/#access_token=...&type=recovery`
3. `AuthHashRedirect` → `/reset-password` (bare domain, neutral)
4. User sets new password → server action determines redirect target
5. Sign out → redirect to appropriate login page

### Customer Registration
1. Customer visits `<slug>.<domain>` → registers/signs up
2. `tenant_memberships` row created with `role: 'customer'`
3. Orders, favorites scoped to tenant via RLS

---

## File Inventory

### New files:
- `src/app/admin/(protected)/team/page.tsx` — Team list & management
- `src/app/admin/(protected)/team/actions.ts` — App-level team actions
- `src/app/platform/tenants/[tenantId]/InviteTeamMember.tsx` — Platform invite form
- `src/app/reset-password/page.tsx` — Neutral password reset callback (moved)
- `src/app/update-password/page.tsx` — Neutral password update form (moved)

### Modified files:
- `src/lib/admin/auth.ts` — Add `staff` role, MFA enforcement
- `src/app/platform/tenants/[tenantId]/page.tsx` — Add team members section
- `src/app/platform/tenants/actions.ts` — Add `inviteTeamMember` action
- `src/app/admin/(protected)/layout.tsx` — Add "Team" nav link
- `src/app/admin/update-password/page.tsx` — Smart redirect (then move)
- Customer registration flow — Add `tenant_memberships` creation

### Deleted files:
- `src/app/admin/reset-password/page.tsx` — Moved to root
- `src/app/admin/update-password/page.tsx` — Moved to root

---

### Phase 5: Email Notifications for Team Events

**5a. Team notification email template**

File: `src/lib/email/templates/TeamNotification.tsx`

React Email template for team events. Café Pulse branded (these are platform-level notifications, not tenant-branded). Supports three event types:
- `invited` — "You've been invited to join [tenant] as [role]"
- `role_changed` — "Your role at [tenant] has been changed to [role]"
- `removed` — "You've been removed from [tenant]"

**5b. Team email send function**

File: `src/lib/email/service.ts`

Add `sendTeamNotification()` static method to `EmailService`. Takes email, event type, tenant name, role, and optional login URL.

**5c. Integrate notifications into actions**

Files:
- `src/app/platform/tenants/actions.ts` — call `sendTeamNotification` from `inviteTeamMember` for existing users
- `src/app/admin/(protected)/team/actions.ts` — call from `inviteAppTeamMember` (existing users), `changeTeamMemberRole`, `removeTeamMember`

Notifications are fire-and-forget (don't block the action on email delivery failure).

---

## Resolved Decisions

1. **Sole owner protection**: Yes — always at least one owner per tenant. Block the last owner from being removed or demoted. Enforced in server actions (`changeTeamMemberRole`, `removeTeamMember`).
2. **`invited_by` tracking**: Yes — add `invited_by UUID REFERENCES auth.users(id)` column to `tenant_pending_invites`. Requires migration.
3. **Customer registration**: Self-service only. Customers register on `<slug>.<domain>` themselves. No manual customer creation by admins.
4. **Email notifications**: Yes — send email when a team member's role changes or they are removed. Uses Resend (existing email provider).
