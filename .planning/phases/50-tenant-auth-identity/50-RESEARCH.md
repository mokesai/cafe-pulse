# Phase 50: Tenant-Aware Auth & Business Identity - Research

**Researched:** 2026-02-15
**Domain:** Multi-tenant authentication, business identity management, tenant-aware email templates
**Confidence:** HIGH

## Summary

This phase addresses the critical architectural transition from the Phase 40 workaround (service role client with manual tenant filtering) to proper tenant-aware admin authentication using `tenant_memberships` table and RLS policies.

The standard approach combines:
1. **Authentication verification** via Supabase Auth (already in place)
2. **Tenant membership authorization** checking `tenant_memberships` table for role-based access
3. **Tenant context setting** via session variables (`app.tenant_id`) for RLS enforcement
4. **Business identity loading** from `tenants` table instead of hardcoded constants
5. **Tenant-aware email templates** using React Email with dynamic branding

The existing codebase already has the foundation:
- `tenant_memberships` table with RLS policies (Phase 20)
- `is_tenant_member()` and `is_admin()` SECURITY DEFINER helper functions (Phase 30)
- Tenant context resolution via subdomain + cookie (Phase 10)
- `createTenantClient()` with `set_tenant_context` RPC call (Phase 40)

**Primary recommendation:** Replace `profiles.role = 'admin'` checks with `tenant_memberships` role checks, call `set_tenant_context()` RPC in admin auth flow, and use normal tenant-scoped client instead of service role client.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/ssr | Latest (implied by existing usage) | Server-side Supabase client with cookie handling | Official Supabase client for Next.js App Router |
| next | 15.x | Framework with App Router | Project's existing framework |
| react-email | 3.0+ | Build email templates as React components | Industry standard for React-based email templates, 270K+ weekly downloads |
| resend | Latest | Email delivery service | Already integrated in project, tight integration with react-email |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tailwindcss/typography | Latest | Email styling with Tailwind | For consistent branding in email templates |
| zod | Latest | Runtime validation for tenant data | When loading tenant config from database |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React Email | Plain HTML strings | React Email provides type safety, component reuse, and preview tooling |
| Resend | SendGrid/Mailgun | Resend has simpler API and better DX; existing integration |
| Session variables | JWT claims | Session variables work with existing RPC approach; JWT requires auth hook setup |

**Installation:**
```bash
npm install react-email @react-email/components
npm install -D @react-email/render
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── admin/
│   │   ├── auth.ts              # requireAdmin() - UPDATED for tenant_memberships
│   │   └── middleware.ts        # requireAdminAuth() for API routes
│   ├── tenant/
│   │   ├── context.ts           # getCurrentTenantId(), resolveTenantBySlug()
│   │   ├── identity.ts          # NEW: getTenantIdentity() for business info
│   │   └── types.ts             # Tenant, TenantMembership types
│   └── email/
│       ├── service.ts           # EmailService - UPDATED for tenant branding
│       └── templates/           # NEW: React Email templates
│           ├── OrderConfirmation.tsx
│           └── OrderStatusUpdate.tsx
├── providers/
│   └── TenantProvider.tsx       # NEW: React Context for client components
└── app/
    └── admin/(protected)/
        └── layout.tsx           # Calls requireAdmin()
```

### Pattern 1: Tenant-Aware Admin Authentication

**What:** Check user auth, then verify tenant membership, then set tenant context for RLS

**When to use:** Every admin route and admin API endpoint

**Example:**
```typescript
// src/lib/admin/auth.ts
import { createClient, createTenantClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { redirect } from 'next/navigation'

export async function requireAdmin() {
  const supabase = await createClient()

  // 1. Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/admin/login')
  }

  // 2. Get tenant context from cookie (set by middleware)
  const tenantId = await getCurrentTenantId()

  // 3. Check tenant membership with owner/admin role
  const { data: membership, error: membershipError } = await supabase
    .from('tenant_memberships')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .single()

  if (membershipError || !membership) {
    // User authenticated but not admin of this tenant
    redirect('/admin/login?error=no-access')
  }

  // 4. Create tenant-scoped client (calls set_tenant_context RPC)
  const tenantClient = await createTenantClient(tenantId)

  return { user, membership, tenantClient }
}
```

**Source:** Based on existing `createTenantClient()` pattern in `src/lib/supabase/server.ts` and `is_tenant_member()` function in RLS migration.

### Pattern 2: Business Identity Loading

**What:** Load tenant business information from `tenants` table for display

**When to use:** Server Components needing business name, logo, contact info; email templates

**Example:**
```typescript
// src/lib/tenant/identity.ts
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from './context'
import type { TenantPublic } from './types'

export async function getTenantIdentity(): Promise<TenantPublic> {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('tenants')
    .select(`
      id, slug, name, business_name,
      business_address, business_phone, business_email,
      business_hours, email_sender_name, email_sender_address,
      is_active, features
    `)
    .eq('id', tenantId)
    .single()

  if (error || !data) {
    throw new Error(`Failed to load tenant identity: ${error?.message}`)
  }

  return data as TenantPublic
}
```

**Caching strategy:** Use React `cache()` wrapper for deduplication within a single request:

```typescript
import { cache } from 'react'

export const getTenantIdentity = cache(async (): Promise<TenantPublic> => {
  // ... implementation
})
```

### Pattern 3: React Context for Client Components

**What:** Provide tenant identity to client components via React Context

**When to use:** When client components need business name, branding, or contact info

**Example:**
```typescript
// src/providers/TenantProvider.tsx
'use client'

import { createContext, useContext, ReactNode } from 'react'
import type { TenantPublic } from '@/lib/tenant/types'

const TenantContext = createContext<TenantPublic | undefined>(undefined)

export function TenantProvider({
  children,
  tenant
}: {
  children: ReactNode
  tenant: TenantPublic
}) {
  return (
    <TenantContext.Provider value={tenant}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  const context = useContext(TenantContext)
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider')
  }
  return context
}
```

**Usage in layout:**
```typescript
// src/app/(site)/layout.tsx
import { getTenantIdentity } from '@/lib/tenant/identity'
import { TenantProvider } from '@/providers/TenantProvider'

export default async function SiteLayout({ children }) {
  const tenant = await getTenantIdentity()

  return (
    <TenantProvider tenant={tenant}>
      {children}
    </TenantProvider>
  )
}
```

**Source:** [React Context with Next.js App Router best practices](https://nextjs.org/docs/app/getting-started/server-and-client-components)

### Pattern 4: Tenant-Aware Email Templates with React Email

**What:** Build email templates as React components that accept tenant branding props

**When to use:** All customer-facing emails (order confirmations, status updates, receipts)

**Example:**
```typescript
// src/lib/email/templates/OrderConfirmation.tsx
import {
  Html, Head, Body, Container, Heading, Text, Section
} from '@react-email/components'

interface OrderConfirmationProps {
  orderId: string
  customerName: string
  items: Array<{ name: string; quantity: number; total: number }>
  total: number
  // Tenant branding
  businessName: string
  businessAddress: string
  businessPhone: string
  logoUrl?: string
  primaryColor?: string
}

export default function OrderConfirmation({
  customerName,
  orderId,
  businessName,
  primaryColor = '#f59e0b',
  ...props
}: OrderConfirmationProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'Arial, sans-serif' }}>
        <Container>
          <Heading style={{ color: primaryColor }}>
            Order Confirmation
          </Heading>
          <Text>Thank you for your order, {customerName}!</Text>
          <Section>
            <Text><strong>{businessName}</strong></Text>
            {/* ... rest of template */}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
```

**Service integration:**
```typescript
// src/lib/email/service.ts
import { Resend } from 'resend'
import { render } from '@react-email/render'
import OrderConfirmation from './templates/OrderConfirmation'
import { getTenantIdentity } from '@/lib/tenant/identity'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendOrderConfirmation(orderData: OrderEmailData) {
  const tenant = await getTenantIdentity()

  const html = render(
    <OrderConfirmation
      {...orderData}
      businessName={tenant.business_name}
      businessAddress={tenant.business_address || ''}
      businessPhone={tenant.business_phone || ''}
      logoUrl={tenant.logo_url}
      primaryColor={tenant.primary_color}
    />
  )

  const from = tenant.email_sender_address
    ? `${tenant.email_sender_name || tenant.name} <${tenant.email_sender_address}>`
    : `${tenant.name} <noreply@yourdomain.com>`

  return resend.emails.send({
    from,
    to: [orderData.customerEmail],
    subject: `Order Confirmation #${orderData.orderId.slice(-8)}`,
    html
  })
}
```

**Sources:**
- [React Email documentation](https://react.email/docs/integrations/resend)
- [Resend + React Email guide](https://www.freecodecamp.org/news/create-and-send-email-templates-using-react-email-and-resend-in-nextjs/)

### Anti-Patterns to Avoid

- **Bypassing tenant context:** Don't use service role client in admin routes after auth check. Use `createTenantClient()` instead.
- **Hardcoded business info:** Don't use constants for business name, address, etc. Load from `tenants` table.
- **Checking profiles.role:** The `profiles` table role is deprecated. Check `tenant_memberships` instead.
- **Client-side tenant resolution:** Don't resolve tenant in client components. Middleware already sets cookie; use server-side `getCurrentTenantId()`.
- **Forgetting to set tenant context:** Every admin route must call `set_tenant_context()` RPC (via `createTenantClient()`) before querying data.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email templates | String concatenation HTML | React Email components | Type safety, reusability, preview tooling, maintenance |
| Email styling | Inline CSS by hand | React Email + Tailwind | Cross-client compatibility handled, consistent branding |
| Tenant context propagation | Manual prop drilling | React Context API | Standard pattern, less boilerplate |
| Session variable setting | Manual SQL in queries | `set_tenant_context()` RPC function | Already implemented, SECURITY DEFINER ensures permission |
| Admin role checking | Custom middleware logic | `is_tenant_member()` helper function | Already implemented, optimized for RLS policies |

**Key insight:** Multi-tenant auth is deceptively complex. The edge cases (tenant switching, subdomain resolution, RLS bypass) are already handled by existing infrastructure. Don't reimplement—use the patterns from Phase 10/20/30/40.

## Common Pitfalls

### Pitfall 1: Forgetting to Set Tenant Context Before Queries

**What goes wrong:** Admin queries return empty results or throw RLS policy violations

**Why it happens:** RLS policies check `current_setting('app.tenant_id')` session variable. If not set, policies deny access.

**How to avoid:**
1. Always use `createTenantClient()` in admin routes after auth check
2. The RPC call `set_tenant_context()` is embedded in `createTenantClient()`
3. Never query tenant-scoped tables with `createClient()` in admin context

**Warning signs:**
- Empty query results despite data existing in database
- `new row violates row-level security policy` errors on INSERT
- Different results in Supabase Studio vs. application

### Pitfall 2: Using Service Role Client After Auth Check

**What goes wrong:** Bypassing RLS means manual tenant filtering is required everywhere, and it's easy to leak data across tenants

**Why it happens:** Phase 40 used service role client as temporary workaround. That pattern must be replaced.

**How to avoid:**
- Service role client is ONLY for:
  - Middleware (before auth context exists)
  - System operations (webhook handlers, migrations)
  - Super-admin platform control plane
- Admin routes should use `createTenantClient()` after verifying membership

**Warning signs:**
- Manually adding `.eq('tenant_id', tenantId)` to every query
- Queries working but feeling "unprotected"
- Different patterns between customer and admin code

### Pitfall 3: Incorrect Email Sender Configuration

**What goes wrong:** Emails go to spam, bounce, or show wrong "From" address

**Why it happens:** Multi-tenant email requires proper domain verification and sender configuration per tenant

**How to avoid:**
1. **Domain verification:** Each tenant's email_sender_address domain must be verified in Resend
2. **Fallback strategy:** If tenant email_sender_address is null, use platform default (e.g., `noreply@yourdomain.com`)
3. **Display name format:** Use `"Business Name <email@domain.com>"` format
4. **Test thoroughly:** Send test emails to multiple providers (Gmail, Outlook, Yahoo)

**Warning signs:**
- Emails not arriving
- "Sent via Resend" warning in Gmail
- SPF/DKIM authentication failures

**Best practice from AWS SES guide:**
- Warm up new domains gradually (50-100 emails/day, increase 50% daily)
- Isolate reputation per tenant using configuration sets
- Validate DNS (SPF, DKIM, DMARC) before allowing tenant to send

**Sources:**
- [AWS SES Multi-Tenant Email Guide](https://aws.amazon.com/blogs/messaging-and-targeting/how-to-manage-email-sending-for-multiple-end-customers-using-amazon-ses/)
- [Multi-tenant email domain best practices](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/domain-names)

### Pitfall 4: Race Condition in Tenant Context

**What goes wrong:** First query in a request uses wrong tenant context

**Why it happens:** Session variables are request-scoped, but RPC call is async

**How to avoid:**
- `createTenantClient()` awaits the `set_tenant_context()` RPC call before returning client
- Always await client creation: `const client = await createTenantClient(tenantId)`
- Don't create multiple tenant clients in parallel with different tenant IDs

**Warning signs:**
- Intermittent wrong-tenant data
- Works in development, fails in production under load
- Different results on page refresh

### Pitfall 5: Exposing Sensitive Tenant Data to Client

**What goes wrong:** Square credentials, webhook keys, or access tokens leak to browser

**Why it happens:** Using `Tenant` type instead of `TenantPublic` type

**How to avoid:**
1. Always use `TenantPublic` type for client components
2. Explicitly select columns when querying `tenants` table (never `select('*')`)
3. Use `TenantProvider` which only accepts `TenantPublic` type

**Warning signs:**
- TypeScript errors when passing tenant to client components
- Seeing `square_access_token` in React DevTools
- Security audit flags sensitive data in browser

## Code Examples

Verified patterns from official sources and existing codebase:

### Multi-Tenant Admin Auth Check
```typescript
// Source: Supabase RLS multi-tenant pattern + existing createTenantClient()
export async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  const tenantId = await getCurrentTenantId()

  // Check membership
  const { data: membership } = await supabase
    .from('tenant_memberships')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .single()

  if (!membership) redirect('/admin/login?error=no-access')

  // Return tenant-scoped client for subsequent queries
  const tenantClient = await createTenantClient(tenantId)
  return { user, membership, tenantClient }
}
```

### Loading Business Identity for Display
```typescript
// Source: React cache() pattern for Next.js App Router
import { cache } from 'react'

export const getTenantIdentity = cache(async (): Promise<TenantPublic> => {
  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient() // OK: reading public tenant info

  const { data } = await supabase
    .from('tenants')
    .select('id, slug, name, business_name, business_phone, business_email')
    .eq('id', tenantId)
    .single()

  return data as TenantPublic
})
```

### React Email Template with Branding
```typescript
// Source: React Email official examples
import { Html, Container, Heading, Text } from '@react-email/components'

export default function BrandedEmail({
  businessName,
  primaryColor = '#3b82f6',
  children
}: {
  businessName: string
  primaryColor?: string
  children: React.ReactNode
}) {
  return (
    <Html>
      <Container style={{ maxWidth: '600px', margin: '0 auto' }}>
        <Heading style={{ color: primaryColor }}>
          {businessName}
        </Heading>
        {children}
        <Text style={{ fontSize: '12px', color: '#666' }}>
          © {new Date().getFullYear()} {businessName}
        </Text>
      </Container>
    </Html>
  )
}
```

### Tenant Context Provider Setup
```typescript
// Source: Next.js App Router context pattern
// app/(site)/layout.tsx
export default async function SiteLayout({ children }) {
  const tenant = await getTenantIdentity()

  return (
    <html>
      <body>
        <TenantProvider tenant={tenant}>
          {children}
        </TenantProvider>
      </body>
    </html>
  )
}

// Client component usage
'use client'
export function BusinessHeader() {
  const { business_name, business_phone } = useTenant()
  return <header>{business_name} | {business_phone}</header>
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `profiles.role = 'admin'` | `tenant_memberships` role check | Phase 20 (2026-02) | Users can be admin of multiple tenants |
| Service role for admin queries | Tenant-scoped client with RLS | Phase 40→50 transition | Proper multi-tenant isolation |
| Hardcoded business info in constants | Load from `tenants` table | Phase 50 | Per-tenant customization |
| HTML string email templates | React Email components | Industry trend 2024-2026 | Type safety, reusability, tooling |
| Single sender email address | Per-tenant sender configuration | Phase 50 | Brand consistency, deliverability |

**Deprecated/outdated:**
- **profiles.role check:** Replaced by tenant_memberships. The profiles table no longer stores admin role.
- **Service role in admin routes:** Was temporary workaround in Phase 40. Phase 50 removes it.
- **NEXT_PUBLIC_* business constants:** Will be replaced by database-driven tenant identity.

## Open Questions

### 1. Email Domain Verification Workflow

**What we know:**
- Resend requires domain verification for custom sender addresses
- Each tenant may want to send from their own domain (e.g., `orders@littlecafe.com`)

**What's unclear:**
- How to handle tenant-initiated domain verification (DNS TXT records)?
- Should we support per-tenant domains or use subdomains of platform domain?
- Fallback strategy if tenant domain verification fails?

**Recommendation:**
- **Phase 50:** Use platform domain with tenant name in display (e.g., `"Little Cafe" <noreply@platform.com>`)
- **Future phase:** Build domain verification workflow (DNS check, Resend API integration)
- Set `email_sender_address` to NULL initially, show setup wizard in admin dashboard

### 2. Logo/Branding Asset Storage

**What we know:**
- Tenants table has fields for logo_url, primary_color, secondary_color
- Need to display in UI and email templates

**What's unclear:**
- Where to store logo files (Supabase Storage? CDN?)?
- Size/format requirements?
- Migration path for existing hardcoded logo?

**Recommendation:**
- Use Supabase Storage with tenant-scoped bucket policies
- Define max size (500KB), accepted formats (SVG, PNG, JPG)
- Provide fallback to text-based branding if logo missing

### 3. Tenant Switching for Super-Admins

**What we know:**
- Some users may need access to multiple tenants (platform admins, consultants)
- Current subdomain approach locks to one tenant

**What's unclear:**
- Should super-admins be able to switch tenants within the UI?
- How to indicate current tenant context clearly?

**Recommendation:**
- **Phase 50:** Single-tenant access only (subdomain determines tenant)
- **Future phase:** Tenant switcher UI for users with multiple memberships
- Add tenant indicator to admin nav header

## Sources

### Primary (HIGH confidence)
- Next.js App Router documentation - [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- Supabase RLS documentation - [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- React Email documentation - [Resend Integration](https://react.email/docs/integrations/resend)
- Existing codebase patterns:
  - `src/lib/supabase/server.ts` - createTenantClient() implementation
  - `supabase/migrations/20260213300000_rls_policy_rewrite.sql` - is_tenant_member() function
  - `supabase/migrations/20260212100000_create_tenants_table.sql` - tenants schema

### Secondary (MEDIUM confidence)
- [Multi-Tenant Applications with RLS on Supabase](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/)
- [Next.js Server Actions Security Guide](https://makerkit.dev/blog/tutorials/secure-nextjs-server-actions)
- [AWS SES Multi-Tenant Email Management](https://aws.amazon.com/blogs/messaging-and-targeting/how-to-manage-email-sending-for-multiple-end-customers-using-amazon-ses/)
- [React Email 3.0 Release](https://resend.com/blog/react-email-3)

### Tertiary (LOW confidence - informational only)
- [WorkOS SaaS Multi-Tenant Architecture Guide](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture)
- [Microsoft Multi-Tenant Domain Considerations](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/domain-names)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - React Email and Resend are industry standard, existing integration verified
- Architecture patterns: HIGH - Based on existing codebase patterns and official Next.js/Supabase docs
- Admin auth flow: HIGH - Direct extension of existing `requireAdmin()` with tenant_memberships
- Email templates: MEDIUM - React Email verified, but tenant branding workflow needs testing
- Pitfalls: HIGH - Based on existing Phase 40 issues and official multi-tenant guidance

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (30 days - stable technologies, incremental changes expected)
