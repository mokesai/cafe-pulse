# Phase 10: Tenant Foundation

## Goal
Create the database tables and application code needed to identify and resolve tenants. After this phase, the app can determine which cafe a request belongs to.

## Wave 1: Database Tables (no code dependencies)

### Task 1.1: Create tenants table migration
- **File:** `supabase/migrations/YYYYMMDD_create_tenants_table.sql`
- **Action:** Create `tenants` table with business config, Square credentials, email config, status
- **Reference:** Schema in `doc/multi-tenant-saas-plan.md` Phase 0
- **Acceptance:** Table exists in Supabase with all columns

### Task 1.2: Create tenant_memberships table migration
- **File:** `supabase/migrations/YYYYMMDD_create_tenant_memberships.sql`
- **Action:** Create `tenant_memberships` table (tenant_id, user_id, role) with unique constraint
- **Acceptance:** Table exists with proper foreign keys and constraints

### Task 1.3: Create set_tenant_context() function
- **File:** Same migration as 1.1 or separate
- **Action:** Create `set_tenant_context(p_tenant_id uuid)` PostgreSQL function using `set_config('app.tenant_id', ...)`
- **Acceptance:** Calling the function sets the session variable correctly

### Task 1.4: Seed default tenant
- **File:** `supabase/migrations/YYYYMMDD_seed_default_tenant.sql`
- **Action:** Insert "Little Cafe" as the default tenant with current Square credentials and business info
- **Reference:** Current values in `.env.local` and `src/lib/constants/app.ts`
- **Acceptance:** Default tenant row exists with slug `littlecafe`

> Wave 1 tasks are all independent — they can run in parallel.

---

## Wave 2: Tenant Library (depends on Wave 1 for types)

### Task 2.1: Create tenant types
- **File:** `src/lib/tenant/types.ts`
- **Action:** Define `Tenant`, `TenantMembership`, `TenantSquareConfig` interfaces
- **Acceptance:** Types match the database table columns

### Task 2.2: Create tenant context module
- **File:** `src/lib/tenant/context.ts`
- **Action:** Implement `resolveTenantBySlug()`, `getCurrentTenant()`, `getCurrentTenantId()`
- **Uses:** `createServiceClient()` from `src/lib/supabase/server.ts` (already exists)
- **Acceptance:** Given a slug, returns the full tenant record

### Task 2.3: Create tenant cache
- **File:** `src/lib/tenant/cache.ts`
- **Action:** In-memory cache for tenant lookups (avoid DB query per request)
- **Acceptance:** Second lookup for same slug hits cache, not DB

> Wave 2 tasks depend on each other slightly (2.2 uses types from 2.1), so run 2.1 first, then 2.2 and 2.3 in parallel.

---

## Wave 3: Middleware Integration (depends on Wave 2)

### Task 3.1: Update middleware.ts
- **File:** `middleware.ts`
- **Action:** Extract subdomain from `Host` header, resolve tenant, set `x-tenant-id` cookie
- **Reference:** Current middleware at `middleware.ts` (session + maintenance check)
- **Acceptance:** Visiting `littlecafe.localhost:3000` sets the tenant cookie

### Task 3.2: Add createTenantClient() to Supabase server
- **File:** `src/lib/supabase/server.ts`
- **Action:** Add function that creates a Supabase client and calls `set_tenant_context` RPC
- **Reference:** Existing `createClient()` and `createServiceClient()` patterns
- **Acceptance:** Queries through this client are scoped to the tenant's data

> Wave 3 tasks are independent of each other — can run in parallel.

---

## Verification
1. Run migrations: `npm run db:migrate`
2. Check tables exist: `SELECT * FROM tenants;` should show one row (littlecafe)
3. Visit `littlecafe.localhost:3000` — should resolve to the default tenant
4. Check cookie: browser dev tools should show `x-tenant-id` cookie set
5. Test `createTenantClient()`: query should return data scoped to the default tenant
