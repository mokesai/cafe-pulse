# Project State

## Current Status: Phase 80 In Progress — Critical Checkout & Settings Fixes
## Current Milestone: 1.0 - Multi-Tenant MVP
## Current Phase: 80 — Critical Checkout & Settings Fixes
## Last Updated: 2026-02-17
## Branch: features/multi-tenant-saas

## Progress

Phase: 80 of 80+ (Critical Checkout & Settings Fixes)
Plan: 2 of ? in Phase 80
Status: In progress — 80-02 complete (site_settings uuid PK migration + TypeScript type update)
Last activity: 2026-02-17 - Completed 80-02-PLAN.md (site_settings PK fix)

Progress: ██████████ Phase 10 complete, Phase 20 complete, Phase 30 complete, Phase 40 complete (13/13 plans), Phase 50 complete (6/6 plans), Phase 50.1 complete (1/1 plan), Phase 60 complete (7/7 plans), Phase 70: ███████ (7/7 plans)

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
- [x] Phase 70 planned — 8 plans across 3 waves (E2E testing, security auditing, hardening)
- [x] 70-01: E2E Multi-Tenant Isolation Testing — Playwright 1.58.2 installed with parallel workers (workers: 2), 11 isolation tests across 3 suites (menu, checkout, admin), subdomain routing patterns, comprehensive README documentation, npm scripts added (test:e2e, test:e2e:ui)
- [x] 70-02: Service-Role & Cache Security Audit — Automated bash audit scripts (service-role-audit.sh, cache-audit.sh), comprehensive AUDIT_RESULTS.md report, 82 service-role usages analyzed (18 pass, 64 fail), 3 caches analyzed (2 pass, 1 warning), HIGH risk level with 64 files lacking tenant_id filtering, priority-ordered remediation roadmap
- [x] 70-03: localStorage Cross-Tenant Isolation — Tenant-aware localStorage utility module (src/lib/utils/localStorage.ts), cart hooks refactored to use tenant-scoped keys (tenantSlug:key format), all localStorage access goes through wrapper functions, zero hardcoded keys remain, verification documentation with manual testing steps
- [x] 70-04: Service-Role Gap Closure (Webhooks, KDS, Orders) — Both Square webhooks fully tenant-scoped (catalog + inventory), all 15 KDS query functions accept tenantId parameter, createOrder() stamps tenant_id on orders + order_items, api/orders/route.ts calls getCurrentTenantId(), admin/setup.ts deprecated with tenant scoping, all 6 KDS caller files updated; audit FAIL count dropped from 64 to 23; TypeScript build clean
- [x] 70-05: Per-Tenant Site Status Cache — siteSettings.edge.ts refactored to Map<string, CacheEntry> keyed by tenantId; getCachedSiteStatus() and invalidateSiteStatusCache() accept tenantId; siteSettings.ts all queries use .eq('tenant_id', tenantId) replacing .eq('id', 1); middleware reads x-tenant-id cookie and passes tenantId; all 5 caller files updated; TypeScript build clean
- [x] 70-06: COGS and Inventory Tenant_ID Gap Closure — 15 COGS admin routes + 17 inventory admin routes updated with getCurrentTenantId() and .eq('tenant_id', tenantId) filtering on all Supabase queries; tenant_id added to all INSERT payloads; tenantId threaded through helper functions in close/route.ts and sales-sync/route.ts; 32 FAIL files from 70-02 audit converted to PASS; TypeScript build clean
- [x] 70-07: Remaining Admin Route Tenant Isolation — 25 admin API routes updated: 11 invoice routes (main CRUD, upload, parse, confirm, file, link-order, match-items, match-orders, and item operations), 8 purchase order sub-routes (main CRUD, attachments, invoice matching, item exclusion, receipts, email send), 3 supplier routes (PUT/PATCH/DELETE + email templates + bulk-upload), 2 customer routes (list + orders); all 64 FAIL items from 70-02 audit now addressed; suppliers/bulk-upload and customers routes upgraded from ad-hoc auth to requireAdminAuth; TypeScript build clean

### Decisions Made
- **site_settings PK migrated via add/drop/rename pattern**: PostgreSQL cannot ALTER a PK column type in-place; adding uuid column, dropping PK + integer column, then renaming is transactional and safe (Phase 80-02)
- **UNIQUE(tenant_id) enforces one settings row per tenant**: App queries by tenant_id; uuid remains the row PK; constraint prevents duplicate inserts without changing PK structure (Phase 80-02)
- **check-role profile query not tenant-filtered**: profiles.eq('id', user.id) is a lookup by the authenticated user's own ID — this is an auth primitive, not a cross-tenant data query; adding tenant_id would break auth for users who switch tenants (Phase 70-07)
- **PO child resources (receipts, matches) scoped via parent PO**: purchase_order_receipts and order_invoice_matches lack a direct tenant_id column; parent PO ownership provides the tenant boundary (Phase 70-07)
- **supplier_email_templates scoped via supplier tenant lookup**: Template queries include supplier FK; verify supplier is in tenant before template read/write (Phase 70-07)
- **Helper functions in route files accept tenantId as parameter**: When route handlers have helper functions that query the DB, tenantId is threaded through as a function parameter rather than re-reading getCurrentTenantId() inside each helper; keeps auth resolution at the route boundary (Phase 70-06)
- **tenantId as first parameter on all KDS query functions**: Compile-time enforcement; impossible to call a KDS query without tenant scope; callers get a compile error if they forget tenantId (Phase 70-04)
- **getCurrentTenantId() at route/page handler level, not inside library functions**: Library functions remain pure and testable; context resolution stays at the edge of the system (Phase 70-04)
- **admin/setup.ts profile functions marked @deprecated**: Functions may still be called by scripts; soft deprecation with pointer to requireAdmin() safer than hard delete (Phase 70-04)
- **tenant_id in INSERT payloads rather than .eq() on INSERTs**: INSERTs set data; tenant_id belongs in the data payload. .eq() is for WHERE clauses on SELECT/UPDATE/DELETE (Phase 70-04)
- **Site status cache is per-tenant (Map<string, CacheEntry> keyed by tenantId)**: Each tenant independently controls maintenance mode; singleton cache would bleed one tenant's maintenance state to all tenants; site_settings.tenant_id column from Phase 20 now properly used (Phase 70-05)
- **Tenant-scoped localStorage keys with ${tenantSlug}:${key} format**: Browser localStorage is domain-scoped on localhost (tenant-a.localhost and tenant-b.localhost share storage); prefixing prevents cross-tenant pollution (Phase 70-03)
- **Created utility module instead of inline tenant-scoping**: Centralized utility enforces consistent key formatting, provides SSR guards, makes future changes easier (Phase 70-03)
- **UserOnboarding.tsx remains tenant-agnostic**: User should see onboarding tour once per browser, not once per tenant; per-tenant onboarding would be repetitive UX (Phase 70-03)
- **useCallback for loadCartFromStorage**: Function depends on tenantSlug; useCallback prevents lint warning and ensures correct dependency tracking (Phase 70-03)
- **Automated bash scripts for security audits**: Repeatable, version-controlled, CI/CD-ready; catches regressions automatically vs manual code review (Phase 70-02)
- **grep-based pattern matching for service-role detection**: Simple and sufficient for detecting createServiceClient() patterns; AST-based tools add unnecessary complexity (Phase 70-02)
- **Three-tier categorization (PASS/WARNING/FAIL) for audit findings**: Clear priority levels for remediation; distinguishes secure, needs-review, and critical issues (Phase 70-02)
- **2 parallel workers for Playwright**: One worker per test tenant for concurrent isolation testing; catches cache pollution and race conditions (Phase 70-01)
- **Test prerequisites documented not auto-created**: Tests verify system behavior, not set up test data; manual tenant creation ensures realistic test conditions (Phase 70-01)
- **Tests fail when tenants don't exist**: Correct behavior that forces proper test environment setup before running isolation tests (Phase 70-01)
- **Chromium-only testing initially**: Focus on isolation testing over browser compatibility in Phase 70; can expand to Firefox/WebKit later (Phase 70-01)
- **--legacy-peer-deps for Playwright**: Zod version conflict between openai@5.12.2 and project's zod@4.0.5; consistent with Phase 60 pattern (Phase 70-01)
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
- **All 64 service-role audit FAILs resolved**: Reduced from 64 (70-02) to 23 (70-04) to ~0 (70-06) to 0 (70-07); all admin API domains now tenant-isolated (COGS, inventory, invoices, purchase orders, suppliers, customers)
- **Site status cache resolved**: __siteStatusCacheEdge refactored to Map<string, CacheEntry>; per-tenant isolation implemented in Phase 70-05
- **Audit script false positive**: service-role-audit.sh flags tenant/identity.ts as FAIL but it correctly filters by .eq('id', tenantId); script needs pattern improvement (Phase 70-02)
- **localStorage isolation requires manual testing**: Cart data isolation implemented; manual testing required to verify tenant-a and tenant-b carts remain separate (Phase 70-03 follow-up)
- Test tenants for E2E tests: tenant-a and tenant-b must be created in database before E2E tests can verify isolation (Phase 70-01 prerequisite)
- E2E tests currently fail: Expected behavior without test tenants; 8/11 tests fail, 3/11 pass (admin protection tests) (Phase 70-01)
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

Last session: 2026-02-17
Stopped at: Completed 80-02-PLAN.md (site_settings PK fix — uuid PK + UNIQUE(tenant_id))
Resume file: None

## Next Action
80-02 complete. site_settings uuid PK migration applied, TypeScript type updated, build clean. Continue with next Phase 80 plan.
