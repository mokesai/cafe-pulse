# Phase 96 Context

## Goals
- Close Finding 4: Block soft-deleted tenants from subdomain resolution
- Close Finding 5: Document `SQUARE_SECRET` env var in all relevant places
- Close Finding 6: Write Phase 90 VERIFICATION.md using same format as other phases

## Constraints
- Phase boundary is fixed — no scope additions
- Minimal surface area: Finding 4 touches only `resolveTenantBySlug()` and `deleteTenant()`
- Finding 5 is documentation only — no code changes (unless `.env.example` needs updating)
- Finding 6 is a doc artifact — no new code, reconstruct evidence from existing plan files + audit doc

---

## Decisions

### Finding 4: Soft-Delete Tenant Resolution

**Response for deleted tenant subdomains:** 404 Not Found
- Deleted tenant returns `null` from `resolveTenantBySlug()`, same as unknown slug
- Middleware already returns 404 on null — no new handling needed

**Filter strategy — defense in depth:**
- `resolveTenantBySlug()` must filter on BOTH:
  - `.is('deleted_at', null)` — primary soft-delete filter
  - `.eq('is_active', true)` — secondary defense-in-depth filter
- **Research required:** Check if `is_active` column exists on `tenants` table. If not, a migration is needed before the filter can be applied.

**deleteTenant() Server Action:**
- Must set `is_active = false` in addition to `deleted_at = now()`
- **Research required:** Confirm current `deleteTenant()` implementation and whether `is_active` column exists

**Return type:** No change to return type or error handling
- Deleted tenant returns `null` — same as unknown slug
- Callers handle `null` uniformly (middleware → 404)

---

### Finding 5: SQUARE_SECRET Documentation

**Documentation locations:**
1. `CLAUDE.md` — add to "Environment Setup" env vars section
2. `.env.example` — if this file exists in the project, add entry there too
3. Any other doc file that lists env vars (README, `doc/SQUARE_SETUP.md`, etc.)

**Research required:** Find every place `SQUARE_SECRET` is used in the codebase to determine its correct description (webhook signature verification vs OAuth app secret vs something else). Write the documentation entry based on actual usage.

---

### Finding 6: Phase 90 VERIFICATION.md

**Format:** Standard must-have checklist format, matching Phase 95, 85, 80 VERIFICATION.md files

**Evidence sources:**
- Phase 90 plan files: `90-01-PLAN.md`, `90-02-PLAN.md`, `90-03-PLAN.md`, `90-04-PLAN.md`
- v1.0 milestone audit document (if it exists in `.planning/`)
- Cross-reference both to reconstruct must-haves and verify against codebase

**Required coverage — must-haves to verify:**
1. GAP-4: Admin invite flow
   - `inviteUserByEmail()` called in `createTenant()` Server Action
   - `tenant_pending_invites` table exists and receives insert
   - New tenant admin can log in and claim membership via first-login flow
2. SEC-1: Square OAuth CSRF protection
   - HTTP-only cookie set on `/platform/tenants/onboard/square/authorize` route
   - Cookie verified in `/platform/tenants/onboard/square/callback` route
   - `requirePlatformAdmin()` guard on callback route
3. SEC-2: Platform Server Actions auth-guarded
   - `isPlatformAdmin` / `requirePlatformAdmin` called in all 5 Server Actions:
     `createTenant`, `updateTenant`, `changeStatus`, `deleteTenant`, `restoreTenant`
4. TypeScript build clean after all Phase 90 changes

## Open Questions
- Does `is_active` column exist on `tenants` table? (Determines if a migration is needed for Finding 4)
- What is `SQUARE_SECRET` actually used for in the codebase? (Determines documentation text for Finding 5)
- Does `.env.example` exist in the project root? (Determines if Finding 5 touches that file)
- Does a v1.0 audit document exist in `.planning/`? (Finding 6 evidence source)
