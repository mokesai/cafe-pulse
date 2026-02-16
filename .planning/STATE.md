# Project State

## Current Status: Phase 60 Complete (Platform Control Plane)
## Current Milestone: 1.0 - Multi-Tenant MVP
## Current Phase: 60 — Platform Control Plane (COMPLETE)
## Last Updated: 2026-02-16
## Branch: features/multi-tenant-saas

## Progress

Phase: 60 of 70 (Platform Control Plane)
Plan: 7 of 7 in Phase 60
Status: Phase complete, all platform admin features functional
Last activity: 2026-02-16 - Completed Phase 60: Platform Control Plane (7/7 plans)

Progress: ██████████ Phase 10 complete, Phase 20 complete, Phase 30 complete, Phase 40 complete (13/13 plans), Phase 50 complete (6/6 plans), Phase 50.1 complete (1/1 plan), Phase 60 complete (7/7 plans)

## Completed
- [x] PROJECT.md created
- [x] ROADMAP.md with 7 phases
- [x] Phase 10 researched (10-RESEARCH.md)
- [x] Phase 10 planned — 7 plans across 4 waves
- [x] Phase 10 executed — all 7 plans complete
- [x] Phase 10 verified — 14/14 must-haves passed
- [x] Phase 20 researched (20-RESEARCH.md)
- [x] Phase 20 planned — 3 plans across 3 waves
- [x] 20-01: Stage 1 migration — tenant_id columns added to all 48 tables
- [x] 20-02: Stage 2 migration — NOT NULL + FK constraints on all 48 tables
- [x] 20-03: Stage 3 migration — btree indexes on all 48 tables + full verification
- [x] Phase 30 researched (30-RESEARCH.md)
- [x] Phase 30 planned — 3 plans across 3 waves
- [x] 30-01: RLS policy rewrite migration — 104 old policies dropped, 194 new tenant-scoped policies created across 48 tables
- [x] 30-02: SECURITY DEFINER functions + storage policies — 5 functions updated with tenant_id filtering, 8 storage policies rewritten with tenant_memberships
- [x] 30-03: Apply & verify — all migrations applied to dev Supabase, 202 tenant policies verified, 13 additional old policies cleaned up, app works on default tenant
- [x] Phase 40 researched (40-RESEARCH.md)
- [x] Phase 40 planned — 11 plans across 4 waves
- [x] 40-01: Vault infrastructure — vault_secret_id columns, SECURITY DEFINER credential functions, audit table, merchant_id index
- [x] 40-02: SquareConfig type and credential loading layer — getTenantSquareConfig() with Vault RPC + env fallback, resolveTenantFromMerchantId() for webhooks
- [x] 40-03: Parameterize fetch-client.ts — all 14 functions accept SquareConfig as first parameter, zero env var reads remain
- [x] 40-04: Domain layer parameterization — catalog.ts, orders.ts, tax-validation.ts, customers.ts accept SquareConfig, tenant-scoped catalog cache, tenant-neutral source name
- [x] 40-05: Customer-facing API routes tenant-aware — menu, config, payment, order-preview resolve tenant and use getTenantSquareConfig(), menu cache keyed by tenantId
- [x] 40-06: Admin routes refactored — 7 admin API routes (sync-square, push-to-square, sales-sync, square-search, menu items, menu availability, COGS sync) resolve tenant and use getTenantSquareConfig()
- [x] 40-07: Webhook tenant resolution — catalog and inventory webhooks resolve tenant from merchant_id, verify signatures with tenant keys, use tenant credentials for API calls
- [x] 40-08: Server-rendered Square config — site layout calls getTenantSquareConfig, DynamicSquareProvider accepts props, CheckoutModal uses context (no env vars)
- [x] 40-09: Dead code cleanup — deleted client.ts, simple-client.ts, test-connection, test-square-simple, debug-tax, test-simple routes; updated test page; cleaned .next cache
- [x] 40-10: Tenant-flag support for setup scripts — sync-square-catalog, seed-inventory, setup-square-webhooks accept --tenant-id and --tenant-slug flags, load credentials from Vault via service_role RPC
- [x] 40-11: Admin menu routes gap closure — categories and items routes refactored to load per-tenant Square credentials via getTenantSquareConfig(), closing 40-06 gap
- [x] 40-12: Customer routes gap closure — cards, delete-card, save-card routes refactored to load per-tenant Square credentials via getTenantSquareConfig(), removing UAT TypeScript blocker
- [x] 40-13: Test/debug routes gap closure — 6 test/debug routes (tax-config, test-catalog, validate-catalog, test-order, test-catalog, test-square) refactored to load per-tenant Square credentials, TypeScript build passes
- [x] Phase 40 verified — 10/10 must-haves passed, all 23 Square API routes use tenant credentials, webhooks resolve tenant from merchant_id, frontend config server-rendered, zero TypeScript errors
- [x] Phase 50 researched (50-RESEARCH.md)
- [x] Phase 50 planned — 8 plans across 3 waves
- [x] 50-01: Tenant identity loading infrastructure — getTenantIdentity() cached function, branding fields added to Tenant type (logo_url, primary_color, secondary_color)
- [x] 50-02: React Email templates — OrderConfirmation and OrderStatusUpdate templates with tenant branding props, react-email dependencies installed
- [x] 50-03: Admin auth tenant-aware — requireAdmin() checks tenant_memberships and returns tenant-scoped RLS client, middleware updated for API routes, admin layout uses tenant context
- [x] 50-04: TenantProvider Context Integration — TenantProvider React Context created, integrated in site and admin layouts, useTenant() hook for client components
- [x] 50-05: React Email Integration — EmailService refactored to use React Email templates with tenant branding, getTenantIdentity() loads business info, sender addresses use tenant config
- [x] 50-06: Gap closure — logo_url, primary_color, secondary_color columns added to tenants table, default tenant populated with Little Cafe brand colors, migration applied successfully
- [x] Phase 50 re-verified — 22/22 must-haves passed (19 from plans 50-01 to 50-05, 3 from gap closure 50-06), admin auth uses tenant_memberships table, business identity with branding columns, emails use tenant branding, TypeScript build clean
- [x] Phase 50.1 planned — 1 plan to fix OrdersManagement loading bug
- [x] 50.1-01: Re-enabled OrdersManagement component — removed maintenance placeholder, component loads successfully after Phase 50-06 fixed missing branding columns
- [x] Fixed RLS recursion bug — dropped "Admins can read tenant memberships" policy that caused infinite recursion when requireAdmin() queried tenant_memberships; "Users can read own memberships" policy sufficient
- [x] Fixed admin login issue — created tenant membership for jerry.mccommas@gmail.com on default tenant (owner role)
- [x] Phase 50.1 verified — 3/3 automated checks + 6/6 human verification items passed, admin orders page loads without errors, OrdersManagement component fully functional (filtering, pagination, details modal)
- [x] Phase 60 planned — 8 plans across 3 waves (database foundation, platform UI, tenant onboarding)
- [x] 60-01: Database foundation — tenant_status ENUM with state machine validation, platform_admins table with bootstrap function, soft delete with 30-day pg_cron cleanup
- [x] 60-02: Platform admin authentication — requirePlatformAdmin() checks platform_admins table, middleware enforces auth + MFA + role checks on /platform routes, MFA enrollment/challenge pages with Supabase TOTP
- [x] 60-03: Platform dashboard UI — Dashboard with tenant stats (total, active, trial, paused, suspended), tenant list with search/sort, shadcn Table component, placeholder pages for onboarding and detail
- [x] 60-04: Square OAuth integration — OAuth Code Flow with authorize/callback routes, Vault storage functions for encrypted credentials, CSRF-safe state parameter, multi-environment support (sandbox + production)
- [x] 60-05: Tenant onboarding wizard — Multi-step form (Basic Info → Square OAuth), React Hook Form + Zod validation, createTenant Server Action with slug uniqueness check, success/error handling via query params
- [x] 60-06: Tenant detail and edit pages — Full tenant config display (status, Square, branding), edit form with React Hook Form + Zod, updateTenant Server Action, hex color validation for branding
- [x] 60-07: Tenant status management — Status change and delete Server Actions (changeStatus, deleteTenant, restoreTenant), StatusManager UI with conditional buttons, automated trial expiration via hourly pg_cron job, daily trial expiration warnings
- [x] Phase 60 verified — 42/42 must-haves passed (all 7 plans complete), platform admin dashboard functional, MFA enforcement active, Square OAuth integration working, tenant onboarding and lifecycle management operational, TypeScript build clean

### Decisions Made
- **Status changes via Server Actions with database validation**: Database trigger enforces state machine rules, prevents invalid transitions at data layer; changeStatus() catches and displays validation errors (Phase 60-07)
- **Hourly pg_cron job for trial expiration**: Balances system load vs responsiveness, prevents long delays after expiration; trials auto-transition to paused within 1 hour (Phase 60-07)
- **Daily trial expiration warnings at 9 AM**: Business-hours timing for platform admin review, foundation for future email notifications (Phase 60-07)
- **Direct Server Action invocation for onboarding**: useActionState returns void; need direct return value for multi-step wizard logic (Phase 60-05)
- **Slug uniqueness check in Server Action**: Prevent duplicate tenants with same subdomain by querying before insert (Phase 60-05)
- **Success/error state via URL query params**: OAuth callback redirects preserve state when returning to onboarding page (Phase 60-05)
- **--legacy-peer-deps for react-hook-form install**: Zod version conflict between openai@5.12.2 (requires zod ^3.23.8) and project's zod@4.0.5 (Phase 60-05)
- **Omit 'size' from SelectProps**: Prevent TypeScript conflict between HTML size (number) and custom size prop (string) (Phase 60-05)
- **Hex color validation for branding**: Regex pattern ensures consistent color format, prevents invalid CSS values (Phase 60-06)
- **Service client for platform dashboard queries**: Platform admins use createServiceClient() to bypass RLS and see all tenants regardless of their own tenant memberships (Phase 60-03)
- **Status badge color mapping**: TenantStatus mapped to Badge variants (trial=blue, active=green, paused=yellow, suspended=red, deleted=gray) for quick visual identification (Phase 60-03)
- **Search via client-side form with query params**: Search form uses client-side submission with query params to keep page as Server Component while supporting search functionality (Phase 60-03)
- **Next.js 15 async params pattern**: params and searchParams are Promise types in Next.js 15; must await before accessing to support streaming (Phase 60-03)
- **OAuth state format for CSRF protection**: State parameter formatted as tenantId:randomToken:environment with 32-byte random token; embeds context for callback while preventing CSRF attacks (Phase 60-04)
- **Separate platform admin and internal Vault functions**: store_square_credentials checks platform_admins, store_square_credentials_internal bypasses check for service_role API routes (Phase 60-04)
- **Vault naming convention for Square credentials**: square_{environment}_{type}_{tenant_id} format supports dual sandbox+production per tenant, consistent with Phase 40 patterns (Phase 60-04)
- **Platform route protection before tenant resolution**: Platform routes are tenant-agnostic; middleware returns early for /platform, bypassing tenant middleware logic (Phase 60-02)
- **Three-layer platform security**: Defense in depth for super-admin access; users must be authenticated, have MFA enabled/verified, and be in platform_admins table (Phase 60-02)
- **Separate MFA enrollment vs challenge pages**: Different user journeys; /mfa-enroll shows QR code for first-time setup, /mfa-challenge only accepts code (Phase 60-02)
- **Suspense boundaries for search params**: Next.js App Router requirement; wrapped MFA page content in Suspense to prevent prerender errors (Phase 60-02)
- **PostgreSQL ENUM for tenant status**: Database-level state machine enforcement prevents invalid transitions; ENUMs are 4 bytes vs VARCHAR (Phase 60-01)
- **Separate platform_admins table**: Platform admins can also be tenant members; clean separation for /platform route authorization (Phase 60-01)
- **pg_cron for tenant cleanup**: Native Postgres extension, no external infrastructure, purges soft-deleted tenants after 30 days (Phase 60-01)
- **30-day tenant retention**: Industry standard (Google/Microsoft), balances recovery window vs data retention costs (Phase 60-01)
- **postgres-only platform admin inserts**: Prevents self-promotion via RLS; bootstrap function required for first admin (Phase 60-01)
- **Drop recursive admin membership policy**: "Admins can read tenant memberships" policy created infinite recursion; "Users can read own memberships" sufficient for requireAdmin() (Phase 50.1)
- **Nullable branding columns**: Allows gradual tenant onboarding without requiring branding config upfront (Phase 50-06)
- **Default tenant brand colors**: Little Cafe gets primary_color=#f59e0b and secondary_color=#0f172a set immediately (Phase 50-06)
- **Menu cache keyed by tenantId**: Prevents cross-tenant data leakage; single-object cache would serve tenant A's menu to tenant B (Phase 40-05)
- **503 for unconfigured tenants**: Customer-facing routes return 503 when Square not configured for tenant (Phase 40-05)
- **Vault with fallback for Square credentials**: New tenants store credentials in Supabase Vault (vault.secrets), default tenant falls back to env vars (Phase 40-01)
- **Owner-only credential access**: Only tenant owners can read/write Square credentials via SECURITY DEFINER functions; API routes use service_role internal function (Phase 40-01)
- **Audit write operations only**: credential_audit_log tracks create/update/delete, not routine reads (Phase 40-01)
- **RPC returns array for RETURNS TABLE**: Supabase RPC for RETURNS TABLE functions returns an array; access via data[0] (Phase 40-02)
- **60-second credential cache TTL**: Matches existing tenant cache TTL for consistency (Phase 40-02)
- **Sandbox as default environment**: Safer default for development; production must be explicit (Phase 40-02)
- **Per-call base URL derivation**: Environment can vary per tenant; base URL must be derived from config at call time, not module level (Phase 40-03)
- **Webhook tenant resolution via merchant_id**: Webhooks identify tenant by looking up square_merchant_id from payload (Phase 40-07)
- **Return 200 for unknown merchant_id**: Prevents Square from retrying valid requests from unconfigured tenants (Phase 40-07)
- **Shared resolveTenantFromMerchantId utility**: Both webhooks import from config.ts to avoid duplication (Phase 40-07)
- **Server-render Square config**: Site layout server-renders config via getTenantSquareConfig and passes to DynamicSquareProvider as props (Phase 40-08)
- **Context-based config delivery**: SquareProvider context extended with applicationId/locationId; descendants use useSquareConfig() hook instead of env vars (Phase 40-08)
- **Graceful degradation for unconfigured tenants**: Null config renders children without SquareProvider wrapper; CheckoutModal shows config error (Phase 40-08)
- **Scripts accept both --tenant-id and --tenant-slug**: Slugs are human-friendly; IDs are deterministic (Phase 40-10)
- **Script env var fallback for backward compatibility**: Scripts default to env vars when no tenant flag provided (Phase 40-10)
- **Service-role RPC for script credential access**: Scripts use get_tenant_square_credentials_internal with service_role client to bypass RLS (Phase 40-10)
- **React cache() for getTenantIdentity**: Request-level deduplication prevents redundant database queries when multiple components need tenant identity (Phase 50-01)
- **Service client for reading tenant identity**: Tenant table data is public (non-sensitive fields) and needs to be readable before user auth context exists (Phase 50-01)
- **--legacy-peer-deps for React Email**: Zod version conflict between openai@5.12.2 (requires zod ^3.23.8) and project's zod@4.0.5 necessitates legacy peer deps flag (Phase 50-02)
- **Match existing email template structure**: React Email templates mirror existing HTML string generators for visual consistency during multi-tenant transition (Phase 50-02)
- **Check tenant_memberships not profiles.role**: Multi-tenant authorization requires per-tenant role checks; admin access scoped to tenant membership (Phase 50-03)
- **Admin routes use tenant-scoped RLS client**: requireAdmin() returns createTenantClient() instead of service role; enforces proper tenant isolation (Phase 50-03)
- **Redirect with error param for wrong tenant**: Differentiate "not authenticated" vs "not admin of this tenant" for better UX (Phase 50-03)
- **TenantProvider as outermost provider**: Ensures tenant identity available to all descendant components including Square and Cart providers (Phase 50-04)
- **useTenant() error checking**: Hook throws error if used outside TenantProvider for fail-fast debugging (Phase 50-04)
- **Tenant context via custom header**: Pass `x-tenant-id` header to Supabase client; `db-pre-request` function reads it and calls `set_config('app.tenant_id', ...)`
- **Subdomain routing**: `slug.localhost:3000` for dev (no /etc/hosts needed)
- **Caching**: Follow existing `globalThis` + TTL pattern from `siteSettings.edge.ts`, 60s TTL
- **Credential storage**: Plain columns for now, Vault migration in later phase
- **Default tenant**: Little Cafe seeded with deterministic UUID `00000000-0000-0000-0000-000000000001`
- **Unknown subdomains**: Return 404 (not fallback to default tenant)
- **Feature branch**: All multi-tenant work on `features/multi-tenant-saas` (main reset to pre-Phase 10)
- **48 tenant-scoped tables**: Full FK tree walk identified 48 tables (not 46 from early estimate)
- **Idempotent migrations**: ADD COLUMN IF NOT EXISTS / DROP COLUMN IF EXISTS for safe re-runs
- **ON DELETE RESTRICT for tenant FK**: Prevents accidental tenant deletion; removal must be explicit multi-step
- **Transactional DDL for constraints**: Single BEGIN/COMMIT wraps all 96 ALTER statements for atomic application
- **Regular CREATE INDEX for dev**: Not CONCURRENTLY, since dev DB has no production traffic; CONCURRENTLY for production migration
- **Hand-crafted types preserved**: db:generate is informational; TypeScript types in src/types/ are manually maintained
- **is_tenant_member() helper with SECURITY DEFINER**: Avoids repeating EXISTS subquery in 190+ policies; cached via initPlan
- **Separate per-operation policies (no FOR ALL)**: Explicit SELECT/INSERT/UPDATE/DELETE for clarity and safety
- **No service_role policies on tenant tables**: Service role bypasses RLS entirely; explicit policies are redundant
- **initPlan-optimized patterns**: All policies use `(select current_setting(...))::uuid` and `(select auth.uid())` wrappers
- **Session variable for tenant_id in SECURITY DEFINER functions**: Functions read tenant_id from `current_setting('app.tenant_id')`, not from new parameters; preserves backward compatibility
- **PO attachments SELECT restricted to tenant members**: Previous public read removed; staff/admin/owner only
- **Rollback scripts in supabase/rollback/**: Not in migrations/ to prevent accidental application by `supabase db push`

### Known Issues
- Platform dashboard manual testing requires bootstrap: Platform admin must be created via psql before testing /platform routes (60-02 bootstrap script needed)
- Pagination not implemented on tenant list: Will need pagination when tenant count grows beyond ~50 (deferred to Phase 60+)
- OAuth state verification storage not implemented: TODO in authorize route for server-side state storage and verification in callback (Phase 60-04 follow-up)
- Square token refresh automation needed: Access tokens expire after 30 days, need pg_cron job (deferred to Phase 60+)
- Admin user creation in onboarding: Server Action includes TODO for creating admin user account via Supabase Admin API or invite link (60-05 follow-up)
- 15+ tables have single-column UNIQUE constraints that will block multi-tenant data (deferred to Phase 60+)
- site_settings singleton pattern (`id = 1`) will conflict with second tenant (deferred to Phase 60+)
- Database views need tenant_id filtering (deferred to Phase 60)
- `db-pre-request` hook not yet configured for `x-tenant-id` header (Phase 60)

### Roadmap Evolution
- **Phase 50.1 inserted after Phase 50** (2026-02-15): Fixed OrdersManagement component loading bug — Root cause was missing branding columns in tenants table (fixed in 50-06). Also fixed RLS recursion bug in tenant_memberships policies that blocked admin login. Re-enabled component successfully.

## Session Continuity

Last session: 2026-02-16
Stopped at: Completed Phase 60 — Platform Control Plane (7/7 plans)
Resume file: None

## Next Action
Phase 60 complete. Proceed to Phase 70: Integration Testing & Hardening.
