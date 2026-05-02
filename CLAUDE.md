# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Workflow (READ FIRST)

This repo uses **staging-first** branching. **`main` is the production-deploy branch** — Vercel auto-deploys it, and merges to main land in prod immediately. Never target `main` for feature/defect work.

```
feature branch (off staging) → PR to staging → tested → release PR (staging → main) → tag
```

Rules:
- **Always branch off `staging`**, never `main`. `git checkout staging && git pull && git checkout -b <branch>`.
- **Always open feature/defect PRs against `staging`**: `gh pr create --base staging ...`. Default GitHub UI base is also `staging`; do not change it for feature work.
- **Only release PRs (head = `staging`) target `main`.** A workflow check (`Enforce main merge source / verify-source`) fails any PR to main from a non-staging head, and that check is required by branch protection.
- **Use "Create a merge commit" when merging release PRs to main** — squash and rebase are disabled / will fail on the staging↔main divergence. Repo settings reflect this (squash-merge is off).
- **Don't push directly to main.** Branch protection blocks it. Don't try to bypass.
- If you accidentally open a PR to main, retarget the base instead of closing/reopening: `gh pr edit <number> --base staging`.
- **Tag main after every release.** Once a release PR (e.g. `release: v0.4.4 — ...`) merges to main AND the prod edge function deploy completes, create and push the tag at the merge commit:
  ```
  git fetch origin
  git tag -a v0.4.X <merge-commit-sha> -m "release: v0.4.X — <one-line summary>"
  git push origin v0.4.X
  ```
  The tag is the canonical reference for "what was released" — without it the version label only lives in the PR title and merge message, which makes rollbacks and changelog tooling harder.

## Domain Invariants

These rules are about how data is shaped, not about how to work with the repo. Read before touching matching, inventory, or pricing logic.

### Pack-pair invariant

For every inventory item with `pack_size > 1`, the tenant's catalog has a paired `pack_size = 1` row sharing the **same `square_item_id`**.

- The pack row is supplier-facing: POs and invoices reference it. A 4-pack croissant inventory row with `unit_cost=$1.55, pack_size=4` represents what suppliers ship.
- The single row is customer-facing: Square POS sells individuals. Receiving the pack increments the single row's `current_stock` by `pack_size`.
- Both rows share `square_item_id` because they represent the same Square POS item, distinguished only by pack size.

Implications for code:

- **Stage 4 matching** (`supabase/functions/invoice-pipeline/stages/04-match-items.ts`) — when an invoice line description matches multiple inventory rows by name, the right pick is whichever row's price interpretation (per-unit or per-pack) lands closest to the invoice's `unit_price`. The helper `pickBestPackAwareMatch` does this. Don't bypass it; don't pick the first hit.
- **Variance comparisons** — invoice `unit_price` may be the per-pack price or per-individual price. `detectPriceMode` resolves which; downstream code (cost-update writes, COGS feed, exception display) must use `effective_unit_price` (per-individual) for inventory writes, not the raw invoice value.
- **Don't deduplicate or merge pack/single pairs** — they're intentional. Came from MOK-63.
- **Stubs to filter**: a `unit_cost = 0` row with the same name as a real inventory item is a skeleton, not a legitimate pack pair. Exclude from match candidates.
- **Stale `inventory.supplier_id`** can happen after a supplier acquisition (e.g., Aspen Bakery → Bluepoint Bakery). The pipeline doesn't currently use `inventory.supplier_id` for matching, so it doesn't break stage 4, but be aware if you touch supplier-resolution code.

## Commands

### Development
- `npm run dev:webpack` - Start development server with webpack (recommended for stability)
- `npm run dev` - Start development server with Turbopack (may have API runtime issues)
- `npm run build` - Build the production application
- `npm start` - Start production server
- `npm run lint` - Run ESLint

### Database (Supabase)
- `npm run db:migrate` - Push schema changes to Supabase
- `npm run db:reset` - Reset database
- `npm run db:generate` - Generate TypeScript types from database schema
- `npm run db:link` - Link to Supabase project

### Square Integration
- `npm run seed-square` - Seed Square catalog with menu items
- `npm run clear-and-reseed` - Clear and reseed Square catalog
- `npm run init-taxes` - Initialize Square sandbox tax configuration
- `npm run debug-square` - Debug Square environment configuration
- `npm run audit-square-mapping` - Audit Square inventory mapping
- `npm run fix-square-mapping` - Fix Square inventory mapping issues

### Inventory & COGS
- `npm run seed-inventory` - Seed database with inventory items
- `npm run setup-inventory` - Set up inventory system
- `npm run upload-suppliers` - Bulk upload suppliers
- `npm run import-cogs-recipes` - Import COGS recipes from Google Sheets
- `npm run import-cogs-product-codes` - Import COGS product codes from Google Sheets
- `npm run export-cogs-product-codes-template` - Export product code mapping template

### Testing
- `npm run test` - Run unit + integration tests
- `npm run test:watch` - Vitest watch mode
- `npm run test:unit` - Unit tests only (no DB)
- `npm run test:integration` - Integration tests (requires `.env.local` with Supabase creds)
- `npm run test:e2e` - Playwright end-to-end tests
- `npm run test:ai` - Test AI invoice parsing

## Architecture

Next.js 15 cafe management platform with Square payments, Supabase database, and admin dashboard.

### Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Database**: Supabase (PostgreSQL)
- **Payments**: Square Web Payments SDK
- **State**: TanStack React Query for server state, React Context for cart/UI
- **Styling**: Tailwind CSS 4
- **Email**: Resend
- **AI**: OpenAI (invoice parsing)

### Route Groups
The app uses Next.js route groups to organize pages:
- `(site)/` - Customer-facing pages (menu, cart, checkout, orders, profile)
- `admin/` - Admin dashboard with `(protected)/` group requiring authentication
- `api/` - API routes

### Key Layout Structure
```
src/app/
├── layout.tsx              # Root: QueryProvider wrapper
├── (site)/layout.tsx       # Customer: Square/Cart providers, maintenance mode check
└── admin/(protected)/layout.tsx  # Admin: requireAdmin() auth check, sidebar nav
```

### Data Layer

**Supabase Clients** (`src/lib/supabase/`):
- `client.ts` - Browser client for client components
- `server.ts` - Server client + service role client for API routes
- `database.ts` - Database operations (orders, profiles)

**Square Clients** (`src/lib/square/`):
- `client.ts` - Main Square SDK client (catalog, orders, payments, inventory APIs)
- `fetch-client.ts` - Alternative fetch-based client
- `catalog.ts`, `orders.ts`, `customers.ts` - Domain-specific operations

### Providers (in wrap order)
1. `QueryProvider` - TanStack Query for server state caching
2. `DynamicSquareProvider` - Square Web Payments SDK (loads dynamically)
3. `CartModalProvider` - Cart state and modal management

### API Route Patterns
- Admin routes at `/api/admin/*` - Protected by admin role check
- Square routes at `/api/square/*` - Payment and catalog operations
- Webhooks at `/api/webhooks/square/*` - Catalog and inventory sync webhooks
- GET requests to most endpoints return API documentation

### Types
Type definitions in `src/types/`:
- `menu.ts` - Menu items, categories, variations
- `orders.ts` - Order and order item types
- `cart.ts` - Cart state types
- `invoice.ts` - Invoice parsing types
- `square.ts` - Square API response types

### Business Context
Little Cafe at Kaiser Permanente, 10400 E Alameda Ave, Denver, CO. Hours: 8AM-6PM Monday-Friday. Menu items, pricing, and location details are real business data.

### Kitchen Display System (KDS)
KDS pages live in two places:
- `/kds/*` - Public display pages (drinks, food screens for TVs)
- `/admin/(kds)/kds/*` - Admin-editable versions of the same screens
- Note: `/kds/drinks/page.tsx` is a redirect only; the actual page is at `/admin/(kds)/kds/drinks/page.tsx`

KDS has a theme system with three themes: `warm`, `dark`, `wps`
- CSS variable scoping: `.theme-warm`, `.theme-dark`, `.theme-wps`
- Entry point: `src/app/kds/kds-themes.css`
- KDS data stored in: `kds_categories`, `kds_menu_items`, `kds_settings`, `kds_images` tables

### Important Warnings

#### Two Supabase Projects
The dev server connects to `ofppjltowsdvojixeflr` unless performing testing and dev in production, `etihvnzzmtxsnbifftfh` (cafe-web-app-prod). Always check `.env.local` before running any database operations.

#### Stale Data in Dev
`revalidate = 300` causes stale data in dev mode. KDS pages use `dynamic = 'force-dynamic'` to avoid this.

### Quality Gates
Before considering any code change complete, you MUST verify:
1. **Lint**: `npm run lint` — must pass with zero warnings and zero errors
2. **Build**: `npm run build` — must compile successfully
3. **Tests**: `npm run test:unit` — must pass. Run `npm run test:integration` too if the change touches admin write routes, tenant scoping, or data-layer logic.

If any check fails, fix the issues before moving on. Do not leave broken lint, build, or tests for the user to discover.

### Testing conventions

Three layers, each catches a different class of bug. Pick the lightest one that works.

**Unit tests** — `__tests__/` or co-located `*.test.ts` under `src/`.
Pure functions, schema validators, cost math, date utilities. No DB, no fetch, no Next.js runtime. Mocks for any external call.

**Integration tests** — `tests/integration/**/*.test.ts`.
Import the API route handler directly and call it in-process against a real Supabase project (`.env.local`). Use `createTenantForTest()` / `cleanupTenant()` / `buildAuthedRequest()` from `tests/integration/helpers/tenant.ts`. `next/headers`'s `cookies()` and `headers()` are mocked via `tests/integration/setup.ts`.

Every admin write route should have at least one **tenant-isolation** test following this pattern:

```ts
// 1. Create two test tenants
// 2. POST/PATCH/DELETE as tenant A's admin
// 3. Assert the row(s) exist under tenant A
// 4. Assert nothing leaked to tenant B or the default littlecafe tenant
```

Example: `tests/integration/admin-suppliers-isolation.test.ts`. This pattern catches the MOK-107 class of bug (inserts silently falling back to the default `tenant_id`).

**E2E tests** — `tests/e2e/**` (Playwright).
Full browser, real user flows, multi-page journeys. Slow — reserve for happy-path flows and multi-step flows that can't be collapsed to a single API call. See `.github/workflows/e2e.yml` for CI setup.

**CI runs all three on every PR** — see `.github/workflows/test.yml` (unit + integration) and `e2e.yml` (browser).

### Do NOT
- Don't modify the database without first verifying which Supabase project `.env.local` points to
- Don't delete `.next` without warning — it requires a full dev server restart
- Don't use CSS `display: none` hacks for showing/hiding elements across KDS themes — use component-level props instead
- Don't add new code to old KDS CSS files (`kds-warm.css`, `kds.css`) — they are deprecated; use `kds-themes.css`

### Environment Setup
Required `.env.local` variables:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` — Supabase
- `SQUARE_APPLICATION_ID` — Square application ID
- `SQUARE_ACCESS_TOKEN` — Square API access token
- `SQUARE_LOCATION_ID` — Square location ID
- `SQUARE_ENVIRONMENT` — `sandbox` or `production`
- `SQUARE_SECRET` — Square OAuth application secret (required for `/api/platform/square-oauth/callback`)
- `OPENAI_API_KEY` — AI invoice parsing
- `RESEND_API_KEY` — Email service
- `KDS_MENU_CSV_URL` / `KDS_CATEGORIES_CSV_URL` — KDS Google Sheets data sources

### Key Patterns
- Use `createClient()` for user-scoped queries, `createServiceClient()` for admin/system operations (bypasses RLS)
- KDS pages must use `dynamic = 'force-dynamic'` to avoid stale cached data
- Square config is fetched dynamically from `/api/square/config` endpoint, not hardcoded in client components
- WPS brand compliance: Starbucks Siren must be separate from operator identity (see `data/WPS-Starbucks-Logo-Requirements.pdf`)

### Documentation
Additional docs in `doc/`:
- `cogs-recipes-sheets.md` - COGS recipe workflow with Google Sheets
- `cogs-product-codes-sheets.md` - COGS product codes workflow
- `SQUARE_SETUP.md` - Square integration setup
- `DATABASE_SETUP.md` - Supabase schema setup
- `multi-tenant-saas-plan.md` - Multi-tenant SaaS architecture plan
