# Context: Phase 90 — Platform Completion & Security Hardening

## Goals
- GAP-4: Implement admin user creation in `createTenant()` — invite via Supabase Admin API, pending invite stored in DB, membership created on first login
- SEC-1: Add `requirePlatformAdmin()` to OAuth callback route + implement CSRF state token verification via encrypted cookie
- SEC-2: Add `requirePlatformAdmin()` to all 5 Platform Server Actions

## Constraints
- No new external dependencies (no iron-session, no Redis)
- Consistent with existing requireAdmin() throw-on-failure pattern
- Existing wizard UI extended (not rebuilt) for email field
- Supabase Vault / pg_cron / shadcn already available

---

## Decisions

### GAP-4: Admin User Invite

**Email field placement:** Added to the Basic Info step of the onboarding wizard alongside tenant name and slug. No new wizard step.

**Square OAuth optional:** Platform admin can send invite without configuring Square. Tenant is created in trial status; admin configures Square later via /platform.

**Invite failure handling:**
- Tenant is always created first (non-atomic)
- If `inviteUserByEmail()` fails: tenant row is persisted, error shown on success/detail page with a manual retry button (re-send invite)
- No rollback on invite failure

**Success page:** Show full summary after `createTenant()` completes:
- Tenant name + slug
- Invited email address
- Square connection status (connected or skipped)
- "Copy invite link" button (if Supabase returns a link)

### GAP-4: Owner Membership

**Membership timing:** NOT inserted at invite time. Inserted on first admin login.

**Mechanism:** Store pending invite in a new DB table (`tenant_pending_invites`: `invited_email`, `tenant_id`, `invited_at`, `role`). On first login to the admin app, check `tenant_pending_invites` for a matching email. If found, insert `tenant_memberships` row and delete the pending invite row.

**Existing Supabase users:** Always call `inviteUserByEmail()` without pre-checking. Let Supabase handle existing accounts (sends magic link to existing user).

**Tenant soft-delete:** When a tenant is soft-deleted, also soft-delete associated `tenant_memberships` rows (set `deleted_at` or an `active = false` flag). If tenant is restored, memberships are restored.

**Invite visibility on tenant detail page:** Show invited email + pending/accepted status. Add "Resend Invite" button that calls `inviteUserByEmail()` again.

**Resend invite:** Available on tenant detail page. Button calls a new Server Action `resendInvite(tenantId)`.

### SEC-1: CSRF State Verification

**Storage mechanism:** Encrypted HTTP-only cookie set in the authorize route, verified and cleared in the callback route. No DB table needed.

- Cookie name: `square_oauth_state`
- Cookie value: the full state string (`tenantId:randomToken:environment`)
- Set with `httpOnly: true`, `secure: true` (in prod), `maxAge: 600` (10 minutes), `sameSite: 'lax'`

**Token TTL:** 10 minutes. After 10 minutes the cookie expires automatically — no explicit cleanup needed (cookie expiry handles it).

**Verification logic in callback:**
1. Read `square_oauth_state` cookie
2. Compare to `state` query param in callback
3. On mismatch or missing cookie: redirect to onboarding with `?error=csrf_failed`
4. On match: clear the cookie, proceed with token exchange

**CSRF failure response:** Redirect to the onboarding wizard with `?error=csrf_failed`. UI shows a human-readable error message ("OAuth session expired or invalid. Please try again.").

**Cleanup:** Cookie expiry handles cleanup automatically. No pg_cron needed. Cookie is deleted explicitly on use (both success and failure paths).

### SEC-2: Server Action Auth

**When guard fails:** Throw with message `'Unauthorized'`. Callers wrap `requirePlatformAdmin()` in try/catch and return `{ error: 'Unauthorized' }` to the client.

**Guard signature:** `requirePlatformAdmin()` returns the user/session object on success, throws on failure. Consistent with `requireAdmin()` pattern.

**Guard reuse:** The same `requirePlatformAdmin()` function (from Phase 60) is called in both the OAuth callback route handler AND all Server Actions. Both throw on failure; route handler lets Next.js catch the throw, Server Actions catch and return `{ error: ... }`.

**5 Server Actions to protect:** `createTenant`, `updateTenant`, `changeStatus`, `deleteTenant`, `restoreTenant` — all in `src/app/platform/actions.ts`.

---

## Open Questions
- None — all gray areas resolved.

## Deferred Ideas
- None surfaced during discussion.
