# Phase 60: Platform Control Plane - Research

**Researched:** 2026-02-15
**Domain:** Multi-tenant SaaS platform administration, 2FA enforcement, OAuth integration, tenant lifecycle management
**Confidence:** HIGH (core stack), MEDIUM (implementation patterns), HIGH (security practices)

## Summary

Phase 60 requires building a super-admin control plane for managing tenants in a multi-tenant SaaS environment. Research reveals that the standard approach combines:

1. **Supabase native TOTP MFA** (built-in, production-ready as of 2026)
2. **Square OAuth Code Flow** (server-side with secure credential storage in Supabase Vault)
3. **shadcn/ui with React Hook Form + Zod** (industry standard for admin dashboards in 2026)
4. **PostgreSQL ENUM for tenant status** with pg_cron for automated state transitions
5. **Middleware-enforced authentication** with role-based access at the RLS layer

The ecosystem has matured significantly: Supabase now provides production-ready MFA (no third-party library needed), Vault for credential encryption, and pg_cron for background jobs. Next.js 15's useActionState + Server Actions with Zod validation is the established pattern for type-safe form handling.

**Primary recommendation:** Use Supabase's native MFA with middleware enforcement, Square's Code Flow OAuth with Vault storage, shadcn/ui components for the admin interface, and PostgreSQL ENUMs for tenant status state machine. Avoid custom 2FA implementations, client-side credential storage, and hand-rolled soft delete logic.

## Standard Stack

The established libraries/tools for platform admin control planes in 2026:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase Auth MFA | Built-in | TOTP 2FA enrollment and verification | Native support, zero external dependencies, free on all projects |
| React Hook Form | 7.x | Multi-step form state management | 50% fewer re-renders than Formik, uncontrolled components, excellent performance |
| Zod | 4.x (already in project) | Schema validation (client + server) | Type inference, shared schemas, Next.js 15 standard |
| shadcn/ui | Latest | Admin UI components | Copy-paste ownership, built on Radix, Tailwind-first, accessibility built-in |
| Supabase Vault | Built-in | Encrypted credential storage | AEAD encryption, keys stored externally, transparent decryption via SQL views |
| pg_cron | Built-in | Scheduled background jobs | Native Postgres extension, cron syntax, zero external infrastructure |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next-stepper | Latest | Multi-step wizard UI | Pre-built stepper components for onboarding flow |
| little-state-machine | 4.x | Cross-step form state | Lightweight state persistence between wizard steps (React Hook Form recommended pattern) |
| Radix UI Primitives | Latest | Unstyled accessible components | When shadcn/ui components need customization beyond styling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Supabase MFA | Custom TOTP (speakeasy, otplib) | Custom adds maintenance burden, Supabase MFA is production-ready and free |
| React Hook Form | Formik | Formik has 8x more re-renders in complex forms, worse performance for wizards |
| shadcn/ui | Tremor | Tremor is analytics-focused, lacks general admin UI components (forms, auth) |
| PostgreSQL ENUM | VARCHAR with CHECK | CHECK constraints require migrations to update, ENUMs are faster (4 bytes vs variable) |
| Supabase Vault | Environment variables | Env vars can't be updated per-tenant at runtime, not encrypted at rest |

**Installation:**
```bash
# React Hook Form + Zod (Zod already installed)
npm install react-hook-form

# shadcn/ui components (copy-paste approach, install as needed)
npx shadcn@latest add button form input label select

# Multi-step wizard components
npx shadcn@latest add stepper  # from shadcn/ui registry
npm install little-state-machine

# Supabase Vault and pg_cron are built-in extensions (enable via Dashboard or SQL)
```

## Architecture Patterns

### Recommended Project Structure
```
src/app/
├── platform/                    # Platform super-admin route group
│   ├── layout.tsx              # Platform auth check + 2FA enforcement
│   ├── page.tsx                # Tenant list/dashboard
│   ├── tenants/
│   │   ├── new/
│   │   │   └── page.tsx        # Multi-step onboarding wizard
│   │   ├── [tenantId]/
│   │   │   ├── page.tsx        # Tenant detail view
│   │   │   ├── edit/page.tsx   # Edit tenant config
│   │   │   └── impersonate/page.tsx  # View-only mode
│   │   └── components/
│   │       ├── OnboardingWizard.tsx
│   │       ├── SquareOAuthButton.tsx
│   │       └── TenantStatusBadge.tsx
│   └── middleware.ts           # 2FA + platform_admins check
├── api/
│   ├── platform/
│   │   ├── tenants/route.ts    # CRUD operations
│   │   └── square-oauth/
│   │       ├── authorize/route.ts    # Initiate OAuth flow
│   │       └── callback/route.ts     # Handle OAuth callback
│   └── webhooks/
│       └── square/...          # Existing Square webhooks
```

### Pattern 1: 2FA Enforcement at Middleware Level
**What:** Check user's MFA status before allowing access to /platform routes
**When to use:** All platform admin routes requiring elevated security
**Example:**
```typescript
// src/middleware.ts (or platform-specific middleware)
// Source: https://supabase.com/docs/guides/auth/auth-mfa/totp

import { createServerClient } from '@/lib/supabase/server';

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/platform')) {
    const supabase = createServerClient();

    // 1. Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // 2. Check MFA status
    const { data: { currentLevel, nextLevel } } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (nextLevel === 'aal2' && currentLevel !== 'aal2') {
      // User has MFA enrolled but hasn't verified this session
      return NextResponse.redirect(new URL('/mfa-challenge', request.url));
    }

    // 3. Verify platform admin role
    const { data: platformAdmin } = await supabase
      .from('platform_admins')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!platformAdmin) {
      return NextResponse.redirect(new URL('/unauthorized', request.url));
    }
  }

  return NextResponse.next();
}
```

### Pattern 2: Square OAuth Code Flow (Server-Side)
**What:** Initiate OAuth from server, exchange code for tokens, store in Vault
**When to use:** New tenant onboarding, credential updates
**Example:**
```typescript
// src/app/api/platform/square-oauth/authorize/route.ts
// Source: https://developer.squareup.com/docs/oauth-api/overview

import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id');
  const environment = searchParams.get('environment') || 'sandbox';

  // Generate and store state for CSRF protection
  const state = randomBytes(32).toString('hex');
  // Store state in session/database tied to tenantId

  const baseUrl = environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  const params = new URLSearchParams({
    client_id: process.env.SQUARE_APPLICATION_ID!,
    scope: 'MERCHANT_PROFILE_READ PAYMENTS_WRITE ORDERS_WRITE ITEMS_READ',
    session: 'false',
    state: `${tenantId}:${state}:${environment}`,
  });

  const authUrl = `${baseUrl}/oauth2/authorize?${params}`;
  return NextResponse.redirect(authUrl);
}

// src/app/api/platform/square-oauth/callback/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // Parse state: "tenantId:stateToken:environment"
  const [tenantId, stateToken, environment] = state!.split(':');

  // Verify state token (check against stored value)

  // Exchange code for tokens
  const tokenResponse = await fetch(
    `https://connect.squareupsandbox.com/oauth2/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SQUARE_APPLICATION_ID,
        client_secret: process.env.SQUARE_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    }
  );

  const tokens = await tokenResponse.json();

  // Store in Supabase Vault
  const supabase = createServiceClient();

  await supabase.rpc('store_square_credentials', {
    p_tenant_id: tenantId,
    p_environment: environment,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_merchant_id: tokens.merchant_id,
  });

  return NextResponse.redirect(new URL(`/platform/tenants/${tenantId}`, request.url));
}
```

### Pattern 3: Multi-Step Wizard with React Hook Form
**What:** Break onboarding into steps, validate per-step, persist state across navigation
**When to use:** Tenant onboarding flow (basic info → Square OAuth → confirmation)
**Example:**
```typescript
// src/app/platform/tenants/new/components/OnboardingWizard.tsx
// Source: https://www.react-hook-form.com/advanced-usage/

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createStore, useStateMachine } from 'little-state-machine';
import { z } from 'zod';

// Schema for Step 1
const step1Schema = z.object({
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  admin_email: z.string().email(),
});

function Step1({ onNext }: { onNext: (data: any) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(step1Schema),
  });

  const onSubmit = (data: z.infer<typeof step1Schema>) => {
    onNext(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('slug')} placeholder="cafe-slug" />
      {errors.slug && <p>{errors.slug.message}</p>}

      <input {...register('name')} placeholder="Cafe Name" />
      {errors.name && <p>{errors.name.message}</p>}

      <input {...register('admin_email')} type="email" placeholder="admin@cafe.com" />
      {errors.admin_email && <p>{errors.admin_email.message}</p>}

      <button type="submit">Next: Connect Square</button>
    </form>
  );
}

// Step 2: Square OAuth (redirect pattern)
function Step2({ data }: { data: any }) {
  const initiateSquareOAuth = async (environment: 'sandbox' | 'production') => {
    // Redirect to /api/platform/square-oauth/authorize?tenant_id=...&environment=...
    window.location.href = `/api/platform/square-oauth/authorize?tenant_id=${data.tenantId}&environment=${environment}`;
  };

  return (
    <div>
      <h2>Connect Square Account</h2>
      <button onClick={() => initiateSquareOAuth('sandbox')}>
        Connect Sandbox
      </button>
      <button onClick={() => initiateSquareOAuth('production')}>
        Connect Production
      </button>
    </div>
  );
}
```

### Pattern 4: Tenant Status State Machine with PostgreSQL ENUM
**What:** Define valid tenant states as ENUM, enforce transitions at database level
**When to use:** Tenant lifecycle management (trial → active → paused → suspended)
**Example:**
```sql
-- Source: https://www.postgresql.org/docs/current/datatype-enum.html
-- Migration: Add tenant status ENUM

CREATE TYPE tenant_status AS ENUM ('trial', 'active', 'paused', 'suspended', 'deleted');

ALTER TABLE tenants
  ADD COLUMN status tenant_status NOT NULL DEFAULT 'trial',
  ADD COLUMN status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Trigger to update status_changed_at
CREATE OR REPLACE FUNCTION update_tenant_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_status_changed
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_tenant_status_timestamp();

-- Validation function for state transitions
CREATE OR REPLACE FUNCTION validate_tenant_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- trial → active, paused, deleted
  IF OLD.status = 'trial' AND NEW.status NOT IN ('active', 'paused', 'deleted') THEN
    RAISE EXCEPTION 'Invalid transition from trial to %', NEW.status;
  END IF;

  -- active → paused, suspended, deleted
  IF OLD.status = 'active' AND NEW.status NOT IN ('paused', 'suspended', 'deleted') THEN
    RAISE EXCEPTION 'Invalid transition from active to %', NEW.status;
  END IF;

  -- paused → active, suspended, deleted
  IF OLD.status = 'paused' AND NEW.status NOT IN ('active', 'suspended', 'deleted') THEN
    RAISE EXCEPTION 'Invalid transition from paused to %', NEW.status;
  END IF;

  -- suspended → active, deleted (requires manual intervention)
  IF OLD.status = 'suspended' AND NEW.status NOT IN ('active', 'deleted') THEN
    RAISE EXCEPTION 'Invalid transition from suspended to %', NEW.status;
  END IF;

  -- deleted is final state (soft delete)
  IF OLD.status = 'deleted' THEN
    RAISE EXCEPTION 'Cannot change status of deleted tenant';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_tenant_status
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION validate_tenant_status_transition();
```

### Pattern 5: Soft Delete with Retention Period
**What:** Mark records as deleted without removing data, permanently delete after retention
**When to use:** Tenant deletion with 30-day recovery window
**Example:**
```sql
-- Source: https://oneuptime.com/blog/post/2026-01-21-postgresql-soft-deletes/view

ALTER TABLE tenants
  ADD COLUMN deleted_at TIMESTAMPTZ NULL;

-- Index for performance (only index active records)
CREATE INDEX idx_tenants_active ON tenants (id) WHERE deleted_at IS NULL;

-- RLS policy to hide soft-deleted records from normal queries
CREATE POLICY hide_deleted_tenants ON tenants
  FOR SELECT
  USING (deleted_at IS NULL OR current_user = 'postgres');

-- Scheduled job to permanently delete after 30 days
-- Source: https://supabase.com/docs/guides/cron
SELECT cron.schedule(
  'cleanup_deleted_tenants',
  '0 3 * * *',  -- Daily at 3 AM
  $$
  DELETE FROM tenants
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - INTERVAL '30 days';
  $$
);

-- Restore function
CREATE OR REPLACE FUNCTION restore_tenant(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tenants
  SET deleted_at = NULL
  WHERE id = tenant_id
    AND deleted_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Pattern 6: View-Only Impersonation
**What:** Allow platform admins to view tenant admin panel in read-only mode
**When to use:** Troubleshooting tenant configuration issues
**Example:**
```typescript
// src/app/platform/tenants/[tenantId]/impersonate/page.tsx
// Source: https://oneuptime.com/blog/post/2026-01-30-impersonation-implementation/view

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ImpersonateTenant({ params }: { params: { tenantId: string } }) {
  const router = useRouter();

  const startImpersonation = async () => {
    // Set impersonation cookie/session
    await fetch('/api/platform/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: params.tenantId,
        mode: 'read-only',
      }),
    });

    // Redirect to tenant's admin panel with impersonation context
    router.push(`/admin?impersonating=${params.tenantId}`);
  };

  return (
    <div>
      <h1>Impersonate Tenant (Read-Only)</h1>
      <button onClick={startImpersonation}>
        View as Tenant Admin
      </button>
    </div>
  );
}

// Middleware to enforce read-only mode during impersonation
// src/middleware.ts addition
export async function middleware(request: NextRequest) {
  const impersonatingCookie = request.cookies.get('impersonating');

  if (impersonatingCookie && request.method !== 'GET') {
    return NextResponse.json(
      { error: 'Read-only mode: modifications not allowed during impersonation' },
      { status: 403 }
    );
  }

  // Continue with other middleware logic...
}
```

### Pattern 7: Server Actions with useActionState and Zod
**What:** Type-safe form submission with server-side validation and error handling
**When to use:** All platform admin forms (create tenant, update settings, etc.)
**Example:**
```typescript
// src/app/platform/tenants/actions.ts
// Source: https://nextjs.org/docs/app/guides/forms

'use server';

import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';

const createTenantSchema = z.object({
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  admin_email: z.string().email(),
});

type ActionState = {
  errors?: {
    slug?: string[];
    name?: string[];
    admin_email?: string[];
  };
  message?: string;
  success?: boolean;
};

export async function createTenant(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  // 1. Validate with Zod
  const validatedFields = createTenantSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    admin_email: formData.get('admin_email'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Validation failed',
    };
  }

  // 2. Check slug uniqueness
  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', validatedFields.data.slug)
    .single();

  if (existing) {
    return {
      errors: { slug: ['Slug already in use'] },
      message: 'Slug conflict',
    };
  }

  // 3. Create tenant
  const { data: tenant, error } = await supabase
    .from('tenants')
    .insert({
      slug: validatedFields.data.slug,
      name: validatedFields.data.name,
      status: 'trial',
    })
    .select()
    .single();

  if (error) {
    return { message: 'Database error: ' + error.message };
  }

  // 4. Create admin user (via Supabase Admin API)
  // ... invite user logic

  return {
    success: true,
    message: `Tenant ${tenant.name} created successfully`
  };
}

// Client component
'use client';

import { useActionState } from 'react';
import { createTenant } from './actions';

export function CreateTenantForm() {
  const [state, formAction] = useActionState(createTenant, { message: '' });

  return (
    <form action={formAction}>
      <input name="slug" required />
      {state.errors?.slug && <p>{state.errors.slug[0]}</p>}

      <input name="name" required />
      {state.errors?.name && <p>{state.errors.name[0]}</p>}

      <input name="admin_email" type="email" required />
      {state.errors?.admin_email && <p>{state.errors.admin_email[0]}</p>}

      <button type="submit">Create Tenant</button>

      {state.message && <p>{state.message}</p>}
    </form>
  );
}
```

### Anti-Patterns to Avoid

- **Don't use localStorage for OAuth state:** State parameter must be server-side to prevent CSRF (store in session or database)
- **Don't bypass RLS during impersonation:** Even in read-only mode, use RLS policies to enforce tenant isolation
- **Don't allow direct status transitions without validation:** Use triggers to enforce state machine rules
- **Don't use global variables for tenant context:** Async context leaks cause cross-tenant data exposure
- **Don't store Square credentials in environment variables for multi-tenant:** Use Vault per-tenant storage
- **Don't skip MFA verification on subsequent requests:** Check AAL level on every /platform request via middleware

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 2FA/TOTP | Custom TOTP library with QR generation | Supabase Auth MFA | Built-in, free, handles enrollment/challenge/verify, recovery via multiple factors |
| Encrypted credential storage | Custom encryption with crypto library | Supabase Vault | AEAD encryption, external key management, transparent decryption, audit trail |
| Background jobs for state transitions | Custom Node.js cron or worker threads | pg_cron | Native Postgres, no external infrastructure, SQL-based, automatic retries |
| OAuth state/PKCE management | Manual state generation and verification | NextAuth.js or manual with secure session | CSRF protection, state verification, well-tested patterns |
| Soft delete queries | Manual deleted_at checks in every query | RLS policies + partial indexes | Automatic filtering, enforced at database level, can't be bypassed |
| Multi-step form state | Custom context provider with useState | React Hook Form + little-state-machine | Validation per-step, state persistence, undo/redo, official RHF pattern |
| Tenant status badge UI | Custom status styling logic | shadcn/ui Badge component with variants | Accessible, consistent, themeable, copy-paste ownership |
| Admin table/list views | Hand-coded tables with sorting/filtering | shadcn/ui DataTable (built on TanStack Table) | Sorting, filtering, pagination, row selection, accessibility |

**Key insight:** The 2026 ecosystem has matured significantly. Supabase provides MFA, Vault, and pg_cron natively—no need for external services. Next.js 15 + React Hook Form + Zod + shadcn/ui is the established stack. Don't rebuild what's been standardized.

## Common Pitfalls

### Pitfall 1: Over-Reliance on RLS as Only Security Layer
**What goes wrong:** Developers trust RLS policies exclusively without defense-in-depth, leading to tenant data leaks through connection pooling contamination, async context leaks, or middleware bypasses.

**Why it happens:** RLS is powerful and convenient, creating false confidence that "if RLS is enabled, we're secure." However, modern SaaS architectures use connection pooling, shared caching, and async execution—each a potential cross-tenant contamination vector.

**How to avoid:**
- Treat RLS as a "safety net," not a "fortress wall"
- Set tenant context (`app.tenant_id`) at the start of EVERY request via middleware
- Never use global variables or poorly scoped singletons for tenant_id
- Validate tenant isolation in unit tests by attempting cross-tenant queries
- Use separate connection pools per tenant for high-security scenarios

**Warning signs:**
- No explicit tenant_id setting in middleware
- Using `createServiceClient()` in user-facing routes (bypasses RLS)
- Async handlers that don't explicitly capture tenant context
- Code review: "It's fine, RLS will handle it"

**Sources:**
- [Multi-Tenant Leakage: When Row-Level Security Fails in SaaS](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c)
- [Tenant Isolation in Multi-Tenant Systems](https://securityboulevard.com/2025/12/tenant-isolation-in-multi-tenant-systems-architecture-identity-and-security/)

### Pitfall 2: Square OAuth State Parameter CSRF Vulnerabilities
**What goes wrong:** Attacker crafts malicious OAuth authorization link with their own `state` parameter, tricking victim into authorizing attacker's Square account to victim's tenant.

**Why it happens:** OAuth state parameter must be unpredictable and verified server-side. Common mistakes:
- Using predictable state (e.g., just the tenant_id)
- Storing state client-side (localStorage, URL params)
- Not verifying state on callback
- Reusing state across multiple authorization attempts

**How to avoid:**
- Generate cryptographically secure random state: `randomBytes(32).toString('hex')`
- Store state server-side tied to user session and tenant_id
- Include timestamp in state storage, expire after 5 minutes (OAuth code expires in 5 min)
- Verify state on callback BEFORE exchanging code for tokens
- Format: `state = base64({ tenant_id, random_token, timestamp })`, store `random_token` in session

**Warning signs:**
- State parameter is just the tenant_id
- No state verification in OAuth callback route
- State stored in cookies without secure/httpOnly flags
- OAuth callback doesn't validate who initiated the flow

**Sources:**
- [When MCP Meets OAuth: Common Pitfalls Leading to One-Click Account Takeover](https://www.obsidiansecurity.com/blog/when-mcp-meets-oauth-common-pitfalls-leading-to-one-click-account-takeover)
- [Square OAuth Best Practices](https://developer.squareup.com/docs/oauth-api/best-practices)
- [OAuth 2.0 authentication vulnerabilities](https://portswigger.net/web-security/oauth)

### Pitfall 3: PostgreSQL ENUM Modification Limitations
**What goes wrong:** Product requirements change (e.g., add "archived" status), but PostgreSQL ENUMs can't remove values or change order without dropping and recreating the type, requiring downtime or complex migrations.

**Why it happens:** ENUMs are optimized for static value sets. Developers choose ENUMs for status fields assuming requirements won't change, then face migration pain when they do.

**How to avoid:**
- Use ENUMs ONLY when value set is truly immutable (e.g., days of week)
- For tenant status, ENUM is acceptable IF you're confident in state machine design
- Document ENUM modification process before using: "To add status, need ALTER TYPE which locks table"
- Alternative: VARCHAR with CHECK constraint (easier to modify, but slower and larger)
- Alternative: Lookup table with foreign key (most flexible, but complicates queries)

**Warning signs:**
- "We might need more statuses later" → Don't use ENUM
- States represent workflow steps likely to evolve → Use VARCHAR + CHECK or lookup table
- Frequently adding new values → Wrong use case for ENUM

**Mitigation if stuck:**
- PostgreSQL 12+ supports `ALTER TYPE ... ADD VALUE` (but can't remove)
- Can rename ENUM values with: drop old type, create new type, migrate data
- Plan for zero-downtime migrations using new column + gradual migration

**Sources:**
- [Why You Should (and Shouldn't) Use Enums in PostgreSQL](https://medium.com/@slashgkr/why-you-should-and-shouldnt-use-enums-in-postgresql-1e354203fd62)
- [PostgreSQL Enum Types](https://www.postgresql.org/docs/current/datatype-enum.html)

### Pitfall 4: MFA Lockout Without Recovery Mechanism
**What goes wrong:** Platform admin loses authenticator app access (phone lost/reset), can't log into /platform routes, no recovery codes implemented, locked out permanently.

**Why it happens:** Supabase MFA docs focus on enrollment and verification, but "Recovery codes are not supported" as of 2026. Developers assume users will "just enroll another factor" without realizing AAL2 enforcement prevents login until MFA verified.

**How to avoid:**
- Enroll multiple factors per user (Supabase supports up to 10 factors)
- UI flow: After enrolling first TOTP, prompt "Add backup authenticator" (second device)
- Implement admin-level emergency override: super-admin can temporarily disable MFA for another admin
- Document recovery process: "Contact support with photo ID to disable MFA"
- Alternative: Implement custom recovery codes in separate table (one-time use hashes)

**Warning signs:**
- Only one MFA factor enrolled per user
- No documented recovery process
- No admin-override function for MFA reset
- Users don't understand "add backup device" flow

**Mitigation:**
```sql
-- Emergency MFA bypass function (SECURITY DEFINER, only callable by postgres role)
CREATE OR REPLACE FUNCTION emergency_mfa_reset(user_email TEXT)
RETURNS VOID AS $$
BEGIN
  -- Unenroll all MFA factors for user
  -- Log action to audit table
  -- Notify user via email
  -- This should require multiple super-admin approvals in production
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Sources:**
- [Multi-Factor Authentication (TOTP) | Supabase Docs](https://supabase.com/docs/guides/auth/auth-mfa/totp) (note: "Recovery codes are not supported")
- [How to Store Your 2FA Backup Codes Securely](https://www.kolide.com/blog/how-to-store-your-2fa-backup-codes-securely)
- [Best practices for multi-factor authentication account recovery](https://www.twilio.com/en-us/blog/best-practices-multi-factor-authentication-mfa-account-recovery)

### Pitfall 5: Impersonation Without Audit Logging
**What goes wrong:** Platform admin views/modifies tenant data while impersonating, no record of actions taken, compliance violation (SOC 2, GDPR), no accountability if something breaks.

**Why it happens:** Impersonation features are built for convenience without considering audit trail requirements. "It's read-only" assumption leads to skipping logging.

**How to avoid:**
- Log ALL impersonation sessions to dedicated audit table:
  - `platform_admin_id`, `tenant_id`, `started_at`, `ended_at`, `ip_address`
- Log individual actions during impersonation (page views, queries run)
- Require reason/ticket number before starting impersonation session
- Notify tenant owner via email when impersonation occurs (transparency)
- Even for "read-only" mode, log what was viewed (GDPR right to know who accessed data)

**Warning signs:**
- No audit table for impersonation events
- No UI indicator showing "Viewing as [Tenant]"
- No automatic session timeout for impersonation mode
- No email notification to tenant when accessed

**Implementation:**
```sql
-- Audit table for impersonation
CREATE TABLE platform_admin_impersonation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID REFERENCES platform_admins(id),
  tenant_id UUID REFERENCES tenants(id),
  reason TEXT NOT NULL,
  ticket_number TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  ip_address INET,
  actions_taken JSONB DEFAULT '[]'::jsonb
);

-- Function to log impersonation start
CREATE OR REPLACE FUNCTION start_impersonation(
  admin_id UUID,
  tenant_id UUID,
  reason TEXT,
  ticket TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  session_id UUID;
BEGIN
  INSERT INTO platform_admin_impersonation_log (
    platform_admin_id, tenant_id, reason, ticket_number
  ) VALUES (admin_id, tenant_id, reason, ticket)
  RETURNING id INTO session_id;

  -- Notify tenant owner via email (trigger edge function)

  RETURN session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Sources:**
- [User Impersonation — a secure, easy way to troubleshoot remotely](https://medium.com/deskera-engineering/user-impersonation-f4939a82f38b)
- [Google Workspace Audit Logs: Track User Logins, File Access & Admin Actions](https://inventivehq.com/knowledge-base/google-workspace/how-to-monitor-user-activities-with-google-workspace-audit-logs)

### Pitfall 6: Trial Expiration Without Automation
**What goes wrong:** Tenants stay in 'trial' status indefinitely because no automated job checks trial expiration, leading to revenue loss and status field becoming meaningless.

**Why it happens:** Developers implement status field and UI but forget to automate state transitions. Manual processes don't scale.

**How to avoid:**
- Add `trial_expires_at` timestamp to tenants table (set during creation)
- Schedule pg_cron job to auto-transition expired trials:
  ```sql
  SELECT cron.schedule(
    'expire_trials',
    '0 * * * *',  -- Every hour
    $$
    UPDATE tenants
    SET status = 'paused'
    WHERE status = 'trial'
      AND trial_expires_at < NOW()
      AND deleted_at IS NULL;
    $$
  );
  ```
- Trigger email notifications before expiration (7 days, 3 days, 1 day, expired)
- Log all automated status changes to audit table

**Warning signs:**
- No `trial_expires_at` or similar timestamp field
- No scheduled jobs for lifecycle management
- Status transitions only happen via manual admin actions
- Old tenants still showing 'trial' status months later

**Sources:**
- [Tenant lifecycle (HCL Software)](https://help.hcl-software.com/UnO/v2.1.3/Administering%20multitenancy/saas_tenantlifecycle.html)
- [pg_cron: Schedule Recurring Jobs with Cron Syntax](https://supabase.com/docs/guides/database/extensions/pg_cron)

### Pitfall 7: Square Token Refresh Neglect
**What goes wrong:** Square access tokens expire after 30 days. App doesn't implement refresh logic. After 30 days, all payment/catalog operations fail for tenant, revenue stops.

**Why it happens:** OAuth code flow works perfectly during onboarding, tokens stored in Vault. Developers assume tokens are long-lived. Square docs recommend "refresh every 7 days or less" but this is easy to miss.

**How to avoid:**
- Store `token_expires_at` alongside access_token in Vault
- Schedule pg_cron job to refresh tokens weekly:
  ```sql
  SELECT cron.schedule(
    'refresh_square_tokens',
    '0 2 * * 0',  -- Every Sunday at 2 AM
    $$
    SELECT refresh_square_tokens();
    $$
  );
  ```
- Implement refresh function that calls Square's `RenewToken` endpoint
- Monitor for token refresh failures (alert platform admins)
- Gracefully handle expired tokens: retry with refresh, notify tenant if refresh fails

**Warning signs:**
- No token refresh logic implemented
- No `token_expires_at` tracking
- No scheduled job for token maintenance
- Production tenant payment failures after 30 days

**Implementation:**
```sql
-- Function to refresh Square tokens for all active tenants
CREATE OR REPLACE FUNCTION refresh_square_tokens()
RETURNS VOID AS $$
DECLARE
  tenant_record RECORD;
  new_token TEXT;
BEGIN
  FOR tenant_record IN
    SELECT t.id, t.slug, v.decrypted_secret as access_token
    FROM tenants t
    JOIN vault.decrypted_secrets v ON v.name = 'square_access_token_' || t.id
    WHERE t.status IN ('trial', 'active')
      AND t.deleted_at IS NULL
  LOOP
    -- Call Square's token refresh endpoint
    -- Store new token in Vault
    -- Update token_expires_at
    -- Log refresh action
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Sources:**
- [Receive Seller Authorization and Manage Seller OAuth Tokens](https://developer.squareup.com/docs/oauth-api/receive-and-manage-tokens) (recommends refresh every 7 days)
- [Square OAuth API Overview](https://developer.squareup.com/docs/oauth-api/overview)

## Code Examples

Verified patterns from official sources:

### Supabase MFA Enrollment Flow
```typescript
// Source: https://supabase.com/docs/guides/auth/auth-mfa/totp

'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import QRCode from 'qrcode';

export function EnrollMFA() {
  const [qrCode, setQrCode] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [factorId, setFactorId] = useState<string>('');
  const [verifyCode, setVerifyCode] = useState<string>('');
  const supabase = createClient();

  const enrollTOTP = async () => {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
    });

    if (error) {
      console.error('Error enrolling MFA:', error);
      return;
    }

    setFactorId(data.id);
    setSecret(data.totp.secret);

    // Generate QR code
    const qrCodeDataUrl = await QRCode.toDataURL(data.totp.uri);
    setQrCode(qrCodeDataUrl);
  };

  const verifyTOTP = async () => {
    const { data, error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: verifyCode,
    });

    if (error) {
      console.error('Error verifying MFA:', error);
      alert('Invalid code, please try again');
      return;
    }

    alert('MFA enrolled successfully!');
  };

  return (
    <div>
      <h2>Enable Two-Factor Authentication</h2>

      {!qrCode && (
        <button onClick={enrollTOTP}>Start MFA Enrollment</button>
      )}

      {qrCode && (
        <>
          <p>Scan this QR code with your authenticator app:</p>
          <img src={qrCode} alt="MFA QR Code" />

          <p>Or enter this secret manually: <code>{secret}</code></p>

          <input
            type="text"
            placeholder="Enter 6-digit code"
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value)}
            maxLength={6}
          />

          <button onClick={verifyTOTP}>Verify and Enable</button>
        </>
      )}
    </div>
  );
}
```

### MFA Challenge on Login (Existing Session)
```typescript
// Source: https://supabase.com/docs/guides/auth/auth-mfa/totp

'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export function MFAChallenge() {
  const [factors, setFactors] = useState<any[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState<string>('');
  const [challengeId, setChallengeId] = useState<string>('');
  const [verifyCode, setVerifyCode] = useState<string>('');
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    loadFactors();
  }, []);

  const loadFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (data) {
      const totpFactors = data.totp;
      setFactors(totpFactors);
      if (totpFactors.length > 0) {
        setSelectedFactorId(totpFactors[0].id);
      }
    }
  };

  const createChallenge = async () => {
    const { data, error } = await supabase.auth.mfa.challenge({
      factorId: selectedFactorId,
    });

    if (data) {
      setChallengeId(data.id);
    }
  };

  const verifyChallenge = async () => {
    const { data, error } = await supabase.auth.mfa.verify({
      factorId: selectedFactorId,
      challengeId,
      code: verifyCode,
    });

    if (error) {
      alert('Invalid code');
      return;
    }

    // MFA verified, redirect to platform
    router.push('/platform');
  };

  return (
    <div>
      <h2>Two-Factor Authentication Required</h2>

      {!challengeId && (
        <button onClick={createChallenge}>Request Code</button>
      )}

      {challengeId && (
        <>
          <p>Enter the 6-digit code from your authenticator app:</p>
          <input
            type="text"
            placeholder="000000"
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value)}
            maxLength={6}
          />
          <button onClick={verifyChallenge}>Verify</button>
        </>
      )}
    </div>
  );
}
```

### Supabase Vault: Store Square Credentials
```sql
-- Source: https://supabase.com/docs/guides/database/vault

-- Create function to store Square credentials for a tenant
CREATE OR REPLACE FUNCTION store_square_credentials(
  p_tenant_id UUID,
  p_environment TEXT,  -- 'sandbox' or 'production'
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_merchant_id TEXT
) RETURNS VOID AS $$
DECLARE
  v_secret_name TEXT;
BEGIN
  -- Store access token
  v_secret_name := 'square_' || p_environment || '_access_token_' || p_tenant_id::text;
  PERFORM vault.create_secret(p_access_token, v_secret_name, 'Square access token');

  -- Store refresh token
  v_secret_name := 'square_' || p_environment || '_refresh_token_' || p_tenant_id::text;
  PERFORM vault.create_secret(p_refresh_token, v_secret_name, 'Square refresh token');

  -- Store merchant ID (not sensitive, but stored with tokens for consistency)
  v_secret_name := 'square_' || p_environment || '_merchant_id_' || p_tenant_id::text;
  PERFORM vault.create_secret(p_merchant_id, v_secret_name, 'Square merchant ID');

  -- Update tenant record with token expiration
  UPDATE tenants
  SET
    square_environment = p_environment,
    square_token_expires_at = NOW() + INTERVAL '30 days'
  WHERE id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Retrieve Square credentials (owner-only access)
CREATE OR REPLACE FUNCTION get_square_credentials(p_tenant_id UUID)
RETURNS TABLE (
  access_token TEXT,
  refresh_token TEXT,
  merchant_id TEXT,
  environment TEXT
) AS $$
BEGIN
  -- Verify caller is owner of this tenant
  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Access denied: only tenant owners can retrieve credentials';
  END IF;

  -- Retrieve from Vault
  RETURN QUERY
  SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets
     WHERE name = 'square_' || t.square_environment || '_access_token_' || p_tenant_id::text) as access_token,
    (SELECT decrypted_secret FROM vault.decrypted_secrets
     WHERE name = 'square_' || t.square_environment || '_refresh_token_' || p_tenant_id::text) as refresh_token,
    (SELECT decrypted_secret FROM vault.decrypted_secrets
     WHERE name = 'square_' || t.square_environment || '_merchant_id_' || p_tenant_id::text) as merchant_id,
    t.square_environment as environment
  FROM tenants t
  WHERE t.id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### pg_cron: Automated Trial Expiration
```sql
-- Source: https://supabase.com/docs/guides/cron

-- Add trial expiration field
ALTER TABLE tenants
  ADD COLUMN trial_expires_at TIMESTAMPTZ,
  ADD COLUMN trial_days INTEGER DEFAULT 14;

-- Set trial expiration on creation
CREATE OR REPLACE FUNCTION set_trial_expiration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'trial' AND NEW.trial_expires_at IS NULL THEN
    NEW.trial_expires_at = NOW() + (NEW.trial_days || ' days')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_trial_on_insert
  BEFORE INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION set_trial_expiration();

-- Scheduled job to expire trials (runs hourly)
SELECT cron.schedule(
  'expire_trial_tenants',
  '0 * * * *',  -- Every hour at minute 0
  $$
  UPDATE tenants
  SET status = 'paused'
  WHERE status = 'trial'
    AND trial_expires_at < NOW()
    AND deleted_at IS NULL;
  $$
);

-- Scheduled job to send expiration warnings (runs daily)
SELECT cron.schedule(
  'trial_expiration_warnings',
  '0 9 * * *',  -- Daily at 9 AM
  $$
  SELECT notify_trial_expiring(id, name, trial_expires_at)
  FROM tenants
  WHERE status = 'trial'
    AND trial_expires_at BETWEEN NOW() AND NOW() + INTERVAL '3 days'
    AND deleted_at IS NULL;
  $$
);

-- List all scheduled jobs
SELECT * FROM cron.job;

-- View job execution history
SELECT * FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 20;

-- Unschedule a job
SELECT cron.unschedule('expire_trial_tenants');
```

### shadcn/ui Multi-Step Wizard with React Hook Form
```typescript
// Source: https://shadcnstudio.com/blocks/dashboard-and-application/multi-step-form
// Source: https://www.react-hook-form.com/advanced-usage/

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

// Step schemas
const step1Schema = z.object({
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
  name: z.string().min(1, 'Business name required'),
  admin_email: z.string().email('Invalid email'),
});

const step2Schema = z.object({
  square_environment: z.enum(['sandbox', 'production']),
});

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;

export function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<Step1Data & Step2Data>>({});

  const form1 = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues: formData,
  });

  const form2 = useForm<Step2Data>({
    resolver: zodResolver(step2Schema),
    defaultValues: { square_environment: 'sandbox', ...formData },
  });

  const onStep1Submit = (data: Step1Data) => {
    setFormData({ ...formData, ...data });
    setCurrentStep(2);
  };

  const onStep2Submit = (data: Step2Data) => {
    const finalData = { ...formData, ...data };

    // Initiate Square OAuth
    window.location.href = `/api/platform/square-oauth/authorize?` +
      `tenant_slug=${finalData.slug}&` +
      `environment=${data.square_environment}`;
  };

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-between">
        <div className={`flex-1 h-1 ${currentStep >= 1 ? 'bg-primary' : 'bg-muted'}`} />
        <div className={`flex-1 h-1 ${currentStep >= 2 ? 'bg-primary' : 'bg-muted'}`} />
        <div className={`flex-1 h-1 ${currentStep >= 3 ? 'bg-primary' : 'bg-muted'}`} />
      </div>

      {/* Step 1: Basic Info */}
      {currentStep === 1 && (
        <Form {...form1}>
          <form onSubmit={form1.handleSubmit(onStep1Submit)} className="space-y-4">
            <FormField
              control={form1.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cafe Slug</FormLabel>
                  <FormControl>
                    <Input placeholder="my-cafe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form1.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My Coffee Shop" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form1.control}
              name="admin_email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Admin Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="admin@mycafe.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit">Next: Connect Square</Button>
          </form>
        </Form>
      )}

      {/* Step 2: Square OAuth */}
      {currentStep === 2 && (
        <Form {...form2}>
          <form onSubmit={form2.handleSubmit(onStep2Submit)} className="space-y-4">
            <h2 className="text-xl font-semibold">Connect Square Account</h2>

            <FormField
              control={form2.control}
              name="square_environment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Environment</FormLabel>
                  <FormControl>
                    <select {...field} className="w-full border rounded p-2">
                      <option value="sandbox">Sandbox (Testing)</option>
                      <option value="production">Production (Live)</option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setCurrentStep(1)}>
                Back
              </Button>
              <Button type="submit">Authorize Square</Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom TOTP libraries (speakeasy, otplib) | Supabase native MFA | 2024-2025 | Zero external dependencies, built-in to all Supabase projects |
| NextAuth.js for all auth | Supabase Auth + NextAuth for OAuth providers | 2025 | Simpler stack, Supabase handles 90% of auth needs |
| Environment variables for all secrets | Supabase Vault for per-tenant secrets | 2024 | Runtime-updatable credentials, encrypted at rest, audit trail |
| Custom cron services (node-cron, Vercel Cron) | pg_cron for database-driven jobs | 2025 | No external infrastructure, SQL-based, automatic retries |
| Formik for complex forms | React Hook Form | 2023-2024 | 50% performance improvement, uncontrolled components |
| Custom middleware auth checks | Next.js 15 middleware + auth libraries | 2024-2025 | Standardized pattern, better DX |
| Tremor for admin dashboards | shadcn/ui for general admin + Tremor only for analytics | 2025-2026 | shadcn/ui now standard for admin panels, Tremor specialized |
| Manual status column checks | PostgreSQL ENUMs with triggers | Ongoing | Type safety, performance (4 bytes), validation at DB level |

**Deprecated/outdated:**
- **useFormState**: Renamed to `useActionState` in React 19/Next.js 15 (late 2024)
- **Custom OAuth state management**: NextAuth.js and direct Supabase integration handle this now
- **Storing secrets in `.env` for multi-tenant**: Vault is the 2026 standard for per-tenant credentials
- **Soft delete with is_deleted boolean**: `deleted_at` timestamp is preferred (supports "when was it deleted?" queries)
- **middleware export (Next.js)**: Renamed to `proxy` in Next.js 16 (early 2026)

## Open Questions

Things that couldn't be fully resolved:

1. **Supabase MFA Recovery Codes**
   - What we know: Supabase docs state "Recovery codes are not supported" as of Feb 2026
   - What's unclear: Whether this is on roadmap, or if "enroll multiple factors" is the official recovery strategy
   - Recommendation: Implement custom recovery codes table if single-device lockout is unacceptable risk, OR require users to enroll 2+ factors (backup authenticator on second device)

2. **Square OAuth PKCE vs Code Flow for Server-Side Next.js**
   - What we know: Code Flow requires client_secret (confidential client), PKCE is for public clients
   - What's unclear: Next.js API routes are server-side (confidential), but Square docs don't explicitly recommend one over the other for Next.js
   - Recommendation: Use Code Flow (client_secret) since Next.js API routes can securely store secrets. PKCE is unnecessary complexity for server-side implementations.

3. **Platform Admin Bootstrap Problem**
   - What we know: Need platform_admins table to control access to /platform routes
   - What's unclear: How to create the FIRST platform admin without manual database insertion
   - Recommendation:
     - Option A: Seed script that checks for zero platform admins, creates first one
     - Option B: Environment variable `BOOTSTRAP_PLATFORM_ADMIN_EMAIL`, auto-promote on first login
     - Option C: Manual SQL insert during initial deployment (document in setup guide)

4. **Impersonation Session Timeout**
   - What we know: Indefinite impersonation sessions are security risk
   - What's unclear: Industry standard timeout duration for admin impersonation
   - Recommendation: Auto-expire impersonation sessions after 1 hour of inactivity, require re-authentication to restart (based on Google Workspace and ServiceNow patterns)

5. **Tenant Deletion: Cascade Strategy**
   - What we know: Soft delete tenants with 30-day retention
   - What's unclear: Should related records (orders, menu items, users) also be soft-deleted or cascade-deleted immediately?
   - Recommendation: Soft delete tenant only, keep related data intact (foreign key to deleted tenant). If tenant restored, all data is still accessible. On permanent deletion (30 days), CASCADE delete all related records in single transaction.

6. **pg_cron Monitoring and Alerting**
   - What we know: pg_cron tracks job runs in `cron.job_run_details`
   - What's unclear: How to alert platform admins when critical jobs fail (e.g., token refresh fails)
   - Recommendation: Create monitoring Edge Function that queries `cron.job_run_details` for failures, sends email/Slack notification. Schedule this monitoring function itself via pg_cron (meta-monitoring).

## Sources

### Primary (HIGH confidence)
- [Supabase Multi-Factor Authentication (TOTP)](https://supabase.com/docs/guides/auth/auth-mfa/totp) - MFA enrollment and verification
- [Supabase Vault](https://supabase.com/docs/guides/database/vault) - Encrypted secret storage
- [Square OAuth API Overview](https://developer.squareup.com/docs/oauth-api/overview) - OAuth flows and token management
- [Square OAuth Best Practices](https://developer.squareup.com/docs/oauth-api/best-practices) - Security recommendations
- [PostgreSQL Enumerated Types](https://www.postgresql.org/docs/current/datatype-enum.html) - ENUM type documentation
- [React Hook Form Advanced Usage](https://www.react-hook-form.com/advanced-usage/) - Multi-step form patterns
- [Next.js Forms Guide](https://nextjs.org/docs/app/guides/forms) - Server Actions with useActionState
- [Supabase pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron) - Scheduled jobs in Postgres

### Secondary (MEDIUM confidence)
- [shadcn/ui Multi-Step Form Block](https://shadcnstudio.com/blocks/dashboard-and-application/multi-step-form) - Pre-built wizard components
- [How to Implement Soft Deletes in PostgreSQL](https://oneuptime.com/blog/post/2026-01-21-postgresql-soft-deletes/view) - Soft delete patterns (2026)
- [Soft-Delete Pattern In Postgres](https://evilmartians.com/chronicles/soft-deletion-with-postgresql-but-with-logic-on-the-database) - Database-level soft delete
- [Handling Forms in Next.js with useActionState and Zod](https://medium.com/@sorayacantos/handling-forms-in-next-js-with-next-form-server-actions-useactionstate-and-zod-validation-15f9932b0a9e) - Form validation patterns
- [React Hook Form vs Formik Comparison](https://medium.com/@jasminbhesaniya/react-forms-react-hook-form-vs-formik-a-complete-comparison-guide-56c7d53cc835) - Performance comparison
- [Multi-Step Form with React Hook Form](https://claritydev.net/blog/build-a-multistep-form-with-react-hook-form) - Implementation guide

### Tertiary (LOW confidence - marked for validation)
- [Tenant Onboarding Best Practices (AWS)](https://aws.amazon.com/blogs/apn/tenant-onboarding-best-practices-in-saas-with-the-aws-well-architected-saas-lens/) - General SaaS patterns
- [Multi-Tenant Leakage article](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c) - Security anti-patterns (2026)
- [When MCP Meets OAuth: Common Pitfalls](https://www.obsidiansecurity.com/blog/when-mcp-meets-oauth-common-pitfalls-leading-to-one-click-account-takeover) - OAuth CSRF vulnerabilities (recent Square vulnerability)
- [PostgreSQL ENUMs Pros and Cons](https://medium.com/@slashgkr/why-you-should-and-shouldnt-use-enums-in-postgresql-1e354203fd62) - ENUM usage guidance (2026)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via official docs and Context7, versions current as of Feb 2026
- Architecture patterns: MEDIUM - Patterns derived from official docs but specific implementations adapted for this project's context
- Security practices: HIGH - Based on official Supabase/Square docs and recent (2026) security research
- Pitfalls: HIGH - Derived from recent (2026) vulnerability reports and PostgreSQL/Supabase official documentation

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (30 days for stable technologies like PostgreSQL, Supabase, Square APIs)

**Note on fast-moving areas:**
- Next.js middleware patterns may evolve with Next.js 16 (proxy export already changed)
- Supabase MFA features may expand (watch for recovery code support)
- shadcn/ui components updated frequently (verify versions at implementation time)
