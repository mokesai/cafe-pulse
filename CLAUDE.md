# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Do NOT
- Don't modify the database without first verifying which Supabase project `.env.local` points to
- Don't delete `.next` without warning — it requires a full dev server restart
- Don't use CSS `display: none` hacks for showing/hiding elements across KDS themes — use component-level props instead
- Don't add new code to old KDS CSS files (`kds-warm.css`, `kds.css`) — they are deprecated; use `kds-themes.css`

### Environment Setup
Required `.env.local` variables:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` — Supabase
- `SQUARE_APPLICATION_ID` / `SQUARE_ACCESS_TOKEN` / `SQUARE_LOCATION_ID` / `SQUARE_ENVIRONMENT` — Square
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
