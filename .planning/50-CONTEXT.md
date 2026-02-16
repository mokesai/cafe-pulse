# Context: Phase 50 — Tenant-Aware Auth & Business Identity

## Goals
- Overhaul admin auth to use `tenant_memberships` instead of hardcoded roles
- Replace hardcoded business info with per-tenant config from `tenants` table
- Make email templates tenant-aware with proper branding
- Add `TenantProvider` React context for client components

## Constraints
- Phase 40 ended with service role workaround (bypasses RLS) - **must fix in Phase 50**
- Subdomain routing already established in Phase 10 (`slug.localhost:3000`)
- Must maintain backward compatibility with default tenant
- Business identity must appear across customer + admin UI surfaces
- Email delivery uses existing Resend integration

## Decisions

### Multi-tenant Admin Workflows

**Tenant Selection:**
- Subdomain determines tenant context (already built in Phase 10)
- Admin navigates to `cafe1.localhost:3000/admin`, logs in via Supabase auth
- `requireAdmin()` verifies user has membership in **that tenant**
- No tenant picker UI needed - URL subdomain is the tenant selector

**Access Control:**
- Access denied shows error: "You don't have access to this cafe"
- Tenant isolation: admins only see their own tenant's data
- Super-admin role in `tenant_memberships` grants platform-wide access to all tenants

**Fix Service Role Workaround (CRITICAL):**
Phase 40 ended with admin routes using `serviceRoleClient` + manual `tenant_id` filtering, which bypasses RLS. This was a temporary workaround implemented without awareness of Phase 50 plan.

Phase 50 must fix this:
- Admin users must be in `tenant_memberships` with appropriate roles
- `requireAdmin()` checks membership AND sets tenant context (`app.tenant_id`)
- Admin routes use normal tenant-scoped client with RLS-protected queries
- Remove service role workaround where possible (only use service role for system operations)

### Business Identity Display Scope

**Customer-Facing UI Surfaces:**
- Site header/navigation (logo and cafe name)
- Order confirmation pages
- Customer receipts/invoices
- Checkout page

**Admin-Facing UI Surfaces:**
- Admin sidebar/nav (show which cafe being managed)
- Admin dashboard header
- Business Profile settings page (for editing identity)

**Tenants Table Schema:**
```typescript
interface TenantIdentity {
  // Basic
  name: string;
  slug: string;
  logo_url?: string;

  // Contact
  phone?: string;
  email?: string;
  website?: string;

  // Location
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  timezone: string;

  // Branding
  primary_color?: string;
  secondary_color?: string;
  font_preferences?: string;
}
```

**Business Profile Settings:**
- Dedicated settings page in admin
- Editable by tenant owners only (not regular admins)
- Form for updating name, logo, contact, location, branding

### Email Branding Coverage

**Emails in Scope:**
- Order confirmations
- Order ready notifications
- Receipt emails

**Branding Strategy:**
- All customer-facing emails use tenant branding
- Sender config: `From: cafe-name@platform.com` with display name `'Cafe Name'`

**Tenant-Customizable Elements:**
- Logo (in email header)
- Business name
- Contact info (phone, email, address)
- Primary color (for buttons, headers)
- Button colors

**Platform-Standard Elements:**
- Footer with platform branding and legal links
- Unsubscribe and email preferences links
- Consistent email template structure

### Fallback Behavior

**Missing Logo:**
- Show tenant name as text logo
- No placeholder image, just styled text

**Missing Branding (Colors, Fonts):**
- Use sensible defaults: neutral colors, system fonts
- Graceful degradation without looking broken

**Missing Contact Info:**
- Hide contact sections if fields are empty
- Don't show "Not configured" placeholders
- Emails omit contact blocks if no data

**Setup Warnings:**
- Setup checklist widget in admin dashboard
- Shows incomplete config items: "Add logo", "Set business hours", "Add contact info"
- Helps new tenants complete their profile

## Open Questions
- None (all areas discussed)
