# Phase 96: Tenant Resolution Hardening & Documentation - Research

**Researched:** 2026-02-18
**Domain:** Supabase soft-delete filtering, env var documentation, VERIFICATION.md format
**Confidence:** HIGH — all findings are from direct file reads, no web search needed

---

## Summary

This is a codebase investigation phase. All open questions from 96-CONTEXT.md are answered below
from direct file reads. No external research was required.

**Finding 4 (soft-delete gap):** The `tenants` table has BOTH `is_active` (boolean, from original
creation migration) and `deleted_at` (timestamptz, added in soft-delete migration). The
`resolveTenantBySlug()` function already filters `.eq('is_active', true)` but does NOT filter
`.is('deleted_at', null)`. The `deleteTenant()` Server Action sets `deleted_at` and
`status='deleted'` but does NOT set `is_active = false`. The fix is a two-part change: add
`.is('deleted_at', null)` to `resolveTenantBySlug()` and add `is_active: false` to the
`deleteTenant()` update payload.

**Finding 5 (SQUARE_SECRET):** `SQUARE_SECRET` is the Square OAuth application secret. It is used
exclusively in `src/app/api/platform/square-oauth/callback/route.ts` at lines 68 and 93 as
`client_secret` in the authorization code exchange request. It is not in CLAUDE.md's environment
setup section, not in `doc/SQUARE_SETUP.md`, and no `.env.example` or `.env.local.example` file
exists in the project root.

**Finding 6 (Phase 90 VERIFICATION.md):** Phase 90 was implemented directly in session 2026-02-18
without a gsd-verifier run. All Phase 90 items have been confirmed wired in the v1.0 audit
document. The VERIFICATION.md must be created at
`.planning/phases/90-platform-completion-security-hardening/90-VERIFICATION.md` using evidence
already gathered in the audit.

**Primary recommendation:** All three findings are pure code/doc changes. No migration is needed
(is_active column already exists). No new library is needed. Write the fixes directly.

---

## Task 1: Tenants Table Schema

### Column Inventory

From `supabase/migrations/20260212100000_create_tenants_table.sql` (original creation):

```sql
CREATE TABLE public.tenants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  business_name text NOT NULL,
  business_address text,
  business_phone text,
  business_email text,
  business_hours jsonb,
  square_application_id text,
  square_access_token text,
  square_location_id text,
  square_environment text DEFAULT 'sandbox',
  square_merchant_id text,
  square_webhook_signature_key text,
  email_sender_name text,
  email_sender_address text,
  is_active boolean DEFAULT true,          -- EXISTS: secondary filter
  features jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

From `supabase/migrations/20260216000002_add_tenant_soft_delete.sql` (soft-delete addition):

```sql
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;  -- EXISTS: primary filter
```

**CONFIRMED:** Both `is_active` (boolean) and `deleted_at` (timestamptz) columns exist on the
tenants table. NO MIGRATION IS NEEDED for Finding 4. The fix is application-layer code only.

**Active tenant = deleted_at IS NULL AND is_active = true**

Additional columns added later (from `20260215140000_add_tenant_branding_columns.sql` referenced in
action schema): `logo_url`, `primary_color`, `secondary_color`, plus `status` enum from
`20260216000000_create_tenant_status_enum.sql`.

### Existing RLS Policy on Tenants

After soft-delete migration, the RLS policy reads:
```sql
CREATE POLICY "Anyone can read active tenants"
  ON tenants FOR SELECT
  USING (deleted_at IS NULL);
```
Note: The RLS policy filters on `deleted_at IS NULL` only — NOT on `is_active`. This means RLS
alone would not block a soft-deleted-but-still-active tenant from being read. However,
`resolveTenantBySlug()` uses `createServiceClient()` which bypasses RLS entirely, making the RLS
irrelevant for tenant resolution. The service client relies solely on the explicit `.eq('is_active',
true)` filter.

---

## Task 2: resolveTenantBySlug() and deleteTenant() Current Code

### resolveTenantBySlug() — Current Code

**File:** `src/lib/tenant/context.ts`

```typescript
export async function resolveTenantBySlug(slug: string): Promise<Tenant | null> {
  // Check cache first
  const cached = getCachedTenant(slug)
  if (cached) return cached

  // Cache miss — query the database
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)       // present — secondary filter
    // .is('deleted_at', null)   // MISSING — must add
    .single()

  if (error || !data) return null

  // Store in cache and return
  setCachedTenant(slug, data as Tenant)
  return data as Tenant
}
```

**Gap:** `.is('deleted_at', null)` is not present. A soft-deleted tenant with `is_active = true`
(which is the current state after `deleteTenant()` runs, since it does not set `is_active = false`)
would be resolved successfully via subdomain.

### deleteTenant() — Current Code

**File:** `src/app/platform/tenants/actions.ts` (lines 323–383)

```typescript
export async function deleteTenant(
  tenantId: string,
  _prevState: ActionState
): Promise<ActionState> {
  // Auth guard (SEC-2)
  const user = await getAuthenticatedPlatformAdmin();
  if (!user) {
    return { errors: { _form: ['Unauthorized'] } };
  }

  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    // Soft delete by setting deleted_at timestamp
    const { error: deleteError } = await supabase
      .from('tenants')
      .update({
        deleted_at: now,
        status: 'deleted',
        // is_active: false,   // MISSING — must add
      })
      .eq('id', tenantId);

    // ... cascade to memberships and invites (correct) ...
  }
}
```

**Gap:** `is_active: false` is not set in the update payload. After deletion, a tenant has
`deleted_at = <timestamp>`, `status = 'deleted'`, but `is_active = true`. The `resolveTenantBySlug()`
function's `.eq('is_active', true)` filter therefore would NOT block resolution of the deleted
tenant.

### Required Changes for Finding 4

**Change 1 — resolveTenantBySlug() in `src/lib/tenant/context.ts`:**

Add `.is('deleted_at', null)` to the query chain, after `.eq('is_active', true)`:

```typescript
const { data, error } = await supabase
  .from('tenants')
  .select('*')
  .eq('slug', slug)
  .eq('is_active', true)
  .is('deleted_at', null)    // ADD THIS LINE
  .single()
```

**Change 2 — deleteTenant() in `src/app/platform/tenants/actions.ts`:**

Add `is_active: false` to the update payload:

```typescript
const { error: deleteError } = await supabase
  .from('tenants')
  .update({
    deleted_at: now,
    status: 'deleted',
    is_active: false,         // ADD THIS LINE
  })
  .eq('id', tenantId);
```

**Cache consideration:** `resolveTenantBySlug()` uses an in-memory cache via `setCachedTenant()`.
The cache key is the slug. After a tenant is deleted, any cached entry for that slug will persist
until server restart. This is acceptable for a defense-in-depth fix (not a security boundary), and
the cache TTL is not documented in the code. No cache invalidation is needed for this phase.

---

## Task 3: SQUARE_SECRET Usage

### Confirmed Usage

**File:** `src/app/api/platform/square-oauth/callback/route.ts`

- **Line 66–69:** Env var validation check — if `SQUARE_SECRET` is missing, route returns
  `oauth_not_configured` error redirect
- **Line 93:** Used as `client_secret` in the POST body to Square's OAuth token endpoint

```typescript
// Line 66-69: validation
if (
  !process.env.SQUARE_APPLICATION_ID ||
  !process.env.SQUARE_SECRET
) {
  // redirect with error oauth_not_configured
}

// Line 91-96: usage
body: JSON.stringify({
  client_id: process.env.SQUARE_APPLICATION_ID,
  client_secret: process.env.SQUARE_SECRET,
  code,
  grant_type: 'authorization_code',
}),
```

**What SQUARE_SECRET is:** The Square OAuth application secret (also called "Application Secret" in
the Square Developer Dashboard). This is distinct from the access token. It is the OAuth 2.0
`client_secret` used during the authorization code exchange flow. It is NOT a webhook signature
key (that's `SQUARE_WEBHOOK_SIGNATURE_KEY`).

### Where SQUARE_SECRET Is NOT Documented

- **CLAUDE.md Environment Setup section** (line 128): Lists `SQUARE_APPLICATION_ID`,
  `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT` — `SQUARE_SECRET` is absent
- **doc/SQUARE_SETUP.md**: Lists only `SQUARE_ACCESS_TOKEN`, `SQUARE_APPLICATION_ID`,
  `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT` — `SQUARE_SECRET` is absent
- **`.env.example`**: Does not exist in the project root
- **`.env.local.example`**: Does not exist in the project root

### Documentation Entry to Add

Add to CLAUDE.md's "Required `.env.local` variables" section:

```
- `SQUARE_SECRET` — Square OAuth application secret (required for Square OAuth callback; find in Square Developer Dashboard under your application's OAuth settings)
```

Add to `doc/SQUARE_SETUP.md` prerequisite env var list:
```
SQUARE_SECRET=your_oauth_application_secret
```

**Note:** `doc/SQUARE_SETUP.md` covers Square sandbox catalog seeding, not OAuth — the SQUARE_SECRET
addition to that file is low value. The CLAUDE.md addition is the critical fix.

---

## Task 4: Phase 90 Evidence for VERIFICATION.md

### What Phase 90 Built (from v1.0-MILESTONE-AUDIT.md and 90-CONTEXT.md)

Phase 90 covered three goals:

**GAP-4: Admin User Invite Flow**
- `createTenant()` in `src/app/platform/tenants/actions.ts` calls
  `supabase.auth.admin.inviteUserByEmail()` (line 128) and inserts into `tenant_pending_invites`
  (line 135–141)
- `requireAdmin()` in `src/lib/admin/auth.ts` checks `tenant_pending_invites` for matching email
  on first login (lines 26–50), upserts `tenant_memberships`, and deletes the consumed invite
- `resendInvite()` Server Action exists in actions.ts (lines 160–193)
- Tenant detail page shows invite status and Resend Invite button

**SEC-1: Square OAuth CSRF Protection**
- Authorize route (`src/app/api/platform/square-oauth/authorize/route.ts`) sets HTTP-only cookie
  `square_oauth_state` with `httpOnly: true`, `secure: process.env.NODE_ENV === 'production'`,
  `maxAge: 600`, `sameSite: 'lax'` (lines 81–85)
- Callback route verifies cookie matches `state` query param (lines 37–46), clears cookie on
  mismatch and on success
- `requirePlatformAdmin()` is called at top of callback route (line 12)

**SEC-2: Platform Server Actions Auth-Guarded**
- All 5 Server Actions in `src/app/platform/tenants/actions.ts` call
  `getAuthenticatedPlatformAdmin()` (which calls `isPlatformAdmin()`):
  - `createTenant()` — line 71
  - `resendInvite()` — line 165
  - `updateTenant()` — line 207
  - `changeStatus()` — line 270
  - `deleteTenant()` — line 330
  - `restoreTenant()` — line 396

**TypeScript Build**
- v1.0 audit notes build passes. Phase 95 VERIFICATION.md confirms `tsc --noEmit` produces zero
  errors in `src/` (test infrastructure errors in `__tests__/` are pre-existing and unrelated).

### Phase 90 Plan Files

Phase 90 has **no plan files** in `.planning/phases/90-platform-completion-security-hardening/`.
The directory is empty. Phase 90 was implemented directly in session 2026-02-18 per STATE.md,
without going through the standard gsd planning process.

Evidence for the VERIFICATION.md must come from:
1. `src/app/platform/tenants/actions.ts` — actual implementation
2. `src/lib/admin/auth.ts` — requireAdmin with invite claim
3. `src/app/api/platform/square-oauth/authorize/route.ts` — CSRF cookie setter
4. `src/app/api/platform/square-oauth/callback/route.ts` — CSRF verifier + requirePlatformAdmin
5. `.planning/v1.0-MILESTONE-AUDIT.md` — Finding 6 section (lines 312–325) which confirmed all
   items by direct codebase inspection

---

## Task 5: .env.example and Env Var Documentation Locations

### Files That Document Env Vars (for Finding 5)

| File | Current Square vars | Missing |
|------|--------------------|---------|
| `CLAUDE.md` (line 128) | `SQUARE_APPLICATION_ID`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT` | `SQUARE_SECRET` |
| `doc/SQUARE_SETUP.md` (lines 9–14) | `SQUARE_ACCESS_TOKEN`, `SQUARE_APPLICATION_ID`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT` | `SQUARE_SECRET` |
| `.env.example` | Does not exist | N/A |
| `.env.local.example` | Does not exist | N/A |

### Files That Do NOT Need to Change

- `doc/SQUARE_SETUP.md` — This doc covers catalog seeding for sandbox testing. It does not cover
  the OAuth flow. Adding `SQUARE_SECRET` there would be misleading (most devs running `seed-square`
  do not need the OAuth secret). The CONTEXT.md says to add it "if it exists." It exists but covers
  a different use case. Adding it is low-value; the CLAUDE.md fix is what matters.

---

## VERIFICATION.md Format — From Existing Files

### Canonical Format (from Phase 95 and Phase 85 VERIFICATION.md files)

```yaml
---
phase: [phase-slug]
verified: [ISO 8601 timestamp]
status: passed
score: [N/N] must-haves verified
---
```

```markdown
# Phase [N]: [Name] Verification Report

**Phase Goal:** [one sentence description]
**Verified:** [date]
**Status:** passed
**Re-verification:** [No — initial verification | Yes — re-verification of...]

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | [specific testable truth] | VERIFIED | [file path, line number, quoted code] |

**Score:** N/N truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `path/to/file.ts` | [what it should contain] | VERIFIED | [N lines, key feature confirmed] |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| [source] | [destination] | [mechanism] | WIRED | [line numbers] |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

### Notes

[Optional: edge cases, deviations, human verification required]

---

_Verified: [timestamp]_
_Verifier: assistant (gsd-verifier)_
```

### Key Observations About the Format

1. **YAML frontmatter is mandatory** — phase slug, verified timestamp, status, score
2. **Observable Truths table** is the core section — each row is a specific, testable claim with
   file+line evidence
3. **Score is in the format "N/N truths verified"** in both the frontmatter and the body
4. **Evidence column** always cites file path and line number, often with quoted code snippet
5. **Required Artifacts table** lists files with what was expected and confirmation details
6. **Key Link Verification table** traces the wiring from caller to callee
7. **Anti-Patterns Found** is always present (with "None" if clean)
8. **Footer** always has `_Verified: [timestamp]_` and `_Verifier: assistant (gsd-verifier)_`
9. Status is always `passed` (or `failed` for failing verifications — not seen in existing files)

### Phase 90 VERIFICATION.md Must-Haves (from CONTEXT.md)

The planner will need to build truths for these four items:

1. **GAP-4: Admin invite flow**
   - `inviteUserByEmail()` called in `createTenant()` at `actions.ts` line 128
   - `tenant_pending_invites` insert at `actions.ts` line 135
   - `requireAdmin()` claims pending invite at `auth.ts` lines 26–50

2. **SEC-1: Square OAuth CSRF protection**
   - HTTP-only cookie set in authorize route at `authorize/route.ts` lines 81–85
   - Cookie verified in callback route at `callback/route.ts` lines 37–46
   - `requirePlatformAdmin()` in callback at `callback/route.ts` line 12

3. **SEC-2: Platform Server Actions auth-guarded**
   - `isPlatformAdmin()` via `getAuthenticatedPlatformAdmin()` in all 5 Server Actions
   - createTenant (line 71), resendInvite (line 165), updateTenant (line 207),
     changeStatus (line 270), deleteTenant (line 330), restoreTenant (line 396)

4. **TypeScript build clean**
   - `tsc --noEmit` produces zero errors in `src/` source files

---

## Architecture Patterns

### Supabase Query Chain Pattern for Defense-in-Depth Filtering

The established pattern in this codebase is to chain multiple `.eq()` / `.is()` filters:

```typescript
// Pattern: defense-in-depth filtering (see also: resendInvite query in actions.ts line 175-177)
const { data, error } = await supabase
  .from('table')
  .select('*')
  .eq('slug', slug)
  .eq('is_active', true)       // secondary filter
  .is('deleted_at', null)      // primary soft-delete filter
  .single()
```

This pattern is already used in `resendInvite()` (line 175–177 in actions.ts):
```typescript
.eq('tenant_id', tenantId)
.is('deleted_at', null)
```

### Soft-Delete Update Pattern

When soft-deleting, set ALL exclusion flags simultaneously:

```typescript
.update({
  deleted_at: now,       // primary soft-delete marker
  status: 'deleted',     // state machine status
  is_active: false,      // secondary exclusion flag
})
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Soft-delete filter | Custom middleware or view | Additional `.is()` / `.eq()` in query chain |
| Cache invalidation on delete | Complex invalidation logic | Accept cache TTL limitation (defense-in-depth, not security boundary) |
| VERIFICATION.md format | New format | Copy existing structure from Phase 95 VERIFICATION.md |

---

## Common Pitfalls

### Pitfall 1: Cache Not Invalidated After Soft-Delete

**What goes wrong:** `resolveTenantBySlug()` caches the tenant object in memory. Adding
`.is('deleted_at', null)` to the query will only prevent caching a newly-deleted tenant; it will
NOT evict an already-cached entry for a tenant that was deleted after caching.

**How to avoid:** This is acceptable. The cache is server-process-local and short-lived (no
explicit TTL seen in code). For Finding 4's defense-in-depth purpose, the code path fix is
sufficient. A note in the plan is appropriate, but no code change is needed for cache eviction.

**Warning signs:** If a deleted tenant's subdomain still resolves immediately after deletion in
production — that's the cache. A server restart or process recycle will clear it.

### Pitfall 2: Only Fixing resolveTenantBySlug Without Fixing deleteTenant

**What goes wrong:** If you add `.is('deleted_at', null)` but don't set `is_active = false` in
`deleteTenant()`, the fix is still incomplete — a deleted tenant (with `deleted_at` set but
`is_active = true`) would still fail the `.is('deleted_at', null)` filter correctly. HOWEVER,
the CONTEXT.md decision is to fix BOTH for defense-in-depth.

**Why both matter:** If `deleteTenant()` also sets `is_active = false`, then the existing
`.eq('is_active', true)` filter in `resolveTenantBySlug()` is the first line of defense. The new
`.is('deleted_at', null)` is the second. Two independent filters mean a bug in either one doesn't
create a resolution gap.

### Pitfall 3: SQUARE_SECRET Description Ambiguity

**What goes wrong:** Documenting `SQUARE_SECRET` as "webhook secret" or "access token secret"
when it is specifically the OAuth `client_secret`.

**Correct description:** "Square OAuth application secret" — found in Square Developer Dashboard
under the application's OAuth settings tab. NOT the same as `SQUARE_ACCESS_TOKEN`.

### Pitfall 4: Phase 90 VERIFICATION.md Evidence Sources

**What goes wrong:** Trying to reconstruct what Phase 90 built from scratch instead of using the
v1.0 audit document which already contains the verification.

**Use this:** `.planning/v1.0-MILESTONE-AUDIT.md`, Finding 6 section (lines 312–325) provides the
explicit line number confirmation for each Phase 90 item. The audit also confirms the cross-phase
integration check at lines 136–172 for the invite flow and OAuth routes.

---

## Code Examples

### resolveTenantBySlug() After Fix

```typescript
// Source: src/lib/tenant/context.ts — AFTER CHANGE
export async function resolveTenantBySlug(slug: string): Promise<Tenant | null> {
  const cached = getCachedTenant(slug)
  if (cached) return cached

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .is('deleted_at', null)    // ADDED
    .single()

  if (error || !data) return null

  setCachedTenant(slug, data as Tenant)
  return data as Tenant
}
```

### deleteTenant() After Fix (relevant section only)

```typescript
// Source: src/app/platform/tenants/actions.ts — AFTER CHANGE
const { error: deleteError } = await supabase
  .from('tenants')
  .update({
    deleted_at: now,
    status: 'deleted',
    is_active: false,    // ADDED
  })
  .eq('id', tenantId);
```

### CLAUDE.md Environment Setup After Fix (diff view)

```diff
- `SQUARE_APPLICATION_ID` / `SQUARE_ACCESS_TOKEN` / `SQUARE_LOCATION_ID` / `SQUARE_ENVIRONMENT` — Square
+ `SQUARE_APPLICATION_ID` / `SQUARE_ACCESS_TOKEN` / `SQUARE_LOCATION_ID` / `SQUARE_ENVIRONMENT` / `SQUARE_SECRET` — Square
```

Or expanded format:
```
- `SQUARE_APPLICATION_ID` — Square application ID
- `SQUARE_ACCESS_TOKEN` — Square API access token
- `SQUARE_LOCATION_ID` — Square location ID
- `SQUARE_ENVIRONMENT` — `sandbox` or `production`
- `SQUARE_SECRET` — Square OAuth application secret (required for OAuth token exchange in `/api/platform/square-oauth/callback`)
```

---

## State of the Art

| Area | Current State | Needed Change |
|------|--------------|---------------|
| `resolveTenantBySlug()` filter | `.eq('is_active', true)` only | Add `.is('deleted_at', null)` |
| `deleteTenant()` payload | Sets `deleted_at` + `status='deleted'` | Also set `is_active: false` |
| CLAUDE.md Square env vars | 4 vars documented | Add `SQUARE_SECRET` |
| Phase 90 VERIFICATION.md | Does not exist | Create at `90-platform-completion-security-hardening/90-VERIFICATION.md` |

---

## Open Questions

None. All four open questions from CONTEXT.md are resolved:

1. **Does `is_active` column exist on `tenants` table?**
   YES — present in original creation migration `20260212100000_create_tenants_table.sql`.
   No migration needed.

2. **What is `SQUARE_SECRET` actually used for?**
   The Square OAuth `client_secret` for authorization code exchange. Used only in
   `src/app/api/platform/square-oauth/callback/route.ts` at lines 68 and 93.

3. **Does `.env.example` exist in the project root?**
   NO — neither `.env.example` nor `.env.local.example` exists. Finding 5 only touches CLAUDE.md
   (mandatory) and optionally `doc/SQUARE_SETUP.md` (low value but acceptable).

4. **Does a v1.0 audit document exist in `.planning/`?**
   YES — `.planning/v1.0-MILESTONE-AUDIT.md`. Finding 6 section (lines 312–325) contains explicit
   evidence for all Phase 90 items including file paths and line numbers.

---

## Sources

### Primary (HIGH confidence — direct file reads)

- `src/lib/tenant/context.ts` — current `resolveTenantBySlug()` implementation
- `src/app/platform/tenants/actions.ts` — current `deleteTenant()` implementation and all 5 Server
  Actions
- `src/lib/admin/auth.ts` — `requireAdmin()` with pending invite claim (Phase 90 GAP-4)
- `src/app/api/platform/square-oauth/callback/route.ts` — `SQUARE_SECRET` usage at lines 68, 93;
  CSRF verification at lines 37–46; `requirePlatformAdmin()` at line 12
- `src/app/api/platform/square-oauth/authorize/route.ts` — CSRF cookie setter at lines 81–85
- `supabase/migrations/20260212100000_create_tenants_table.sql` — confirms `is_active` column
- `supabase/migrations/20260216000002_add_tenant_soft_delete.sql` — confirms `deleted_at` column
- `.planning/v1.0-MILESTONE-AUDIT.md` — Phase 90 Finding 6 (lines 312–325), all wiring confirmed
- `.planning/90-CONTEXT.md` — Phase 90 decisions for GAP-4, SEC-1, SEC-2
- `CLAUDE.md` lines 125–131 — current Environment Setup section (confirms `SQUARE_SECRET` absent)
- `doc/SQUARE_SETUP.md` lines 7–14 — current Square env vars (confirms `SQUARE_SECRET` absent)
- `.planning/phases/95-admin-auth-hardening-orders-isolation/95-VERIFICATION.md` — canonical format
- `.planning/phases/85-multi-tenant-schema-constraints/85-VERIFICATION.md` — canonical format

---

## Metadata

**Confidence breakdown:**
- Finding 4 schema facts: HIGH — read directly from migration files
- Finding 4 code facts: HIGH — read directly from source files with verbatim code
- Finding 5 SQUARE_SECRET usage: HIGH — read directly from callback route
- Finding 5 documentation locations: HIGH — verified all env var files, confirmed no .env.example
- Finding 6 Phase 90 evidence: HIGH — confirmed from v1.0 audit + direct source file reads
- VERIFICATION.md format: HIGH — read two existing files (Phase 95, Phase 85)

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (stable codebase — 30-day validity)
