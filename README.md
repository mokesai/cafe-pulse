# Cafe Web Platform

A multi-tenant SaaS cafe management platform built with Next.js 15, featuring Square payments integration, kitchen display systems, real-time inventory management, purchase order workflows, cost-of-goods-sold tracking, and a platform control plane for onboarding and managing multiple tenant locations.

## 🚀 Features

### Customer-Facing Website
- 🎨 **Modern Design** — Clean, responsive layout with warm cafe aesthetics
- 🛒 **Online Ordering** — Browse menu, add to cart, checkout with Square payments
- 💳 **Square Web Payments SDK** — Secure, PCI-compliant payment processing
- 👤 **Customer Accounts** — Profiles with order history, favorites, and notifications
- 📧 **Email Receipts** — Automated order confirmations via Resend
- 🔔 **Real-time Notifications** — Order status updates
- 🚧 **Maintenance Mode** — Admin-controlled "under construction" page with staff bypass

### Kitchen Display System (KDS)
- 📺 **TV-Ready Menu Boards** — Designed for wall-mounted displays in drinks and food screens
- 🎨 **Three Themes** — `warm` (wood/cream/gold), `dark` (dark background/gold accents), `wps` (Starbucks Green)
- 🔄 **Auto-Refresh** — Screens refresh automatically to reflect menu changes
- 📊 **Google Sheets Workflow** — Export Square catalog → edit in Sheets → import to KDS database
- 🖼️ **Rotating Images** — Promo footer with configurable image rotation
- 📱 **Deployment Options** — Raspberry Pi (Chromium kiosk mode), Fire TV, Smart TV browsers
- ⚙️ **Admin-Editable** — Separate admin KDS routes for previewing and editing screens

### Admin Dashboard
- 📊 **Analytics Dashboard** — Business insights, sales reports, and trends
- 📋 **Order Management** — View, update, and manage customer orders
- 🏪 **Supplier Management** — Track suppliers, contacts, and email templates
- 📦 **Inventory Management** — Real-time stock tracking with low-stock alerts and Square sync
- 🧾 **Purchase Orders** — Full lifecycle (draft → approved → sent → received), PDF generation, email to suppliers, partial receipt logging
- 🧾 **Invoice Processing** — AI-powered invoice scanning, parsing, and matching to purchase orders with variance tracking
- 💰 **COGS Tracking** — Periodic and theoretical cost-of-goods-sold calculation with recipe management
- 📑 **Menu Management** — Update items, prices, and availability
- ⚙️ **Settings** — Locations, units, taxes, and system configuration

### Multi-Tenant Platform (Control Plane)
- 🏢 **Tenant Management** — Onboard, edit, pause, suspend, and soft-delete tenant locations
- 🌐 **Subdomain Routing** — Each tenant gets a subdomain (e.g., `littlecafe.example.com`)
- 🔐 **MFA Required** — TOTP-based multi-factor authentication for all platform admins
- 📧 **Invite System** — Email-based tenant admin invitations with resend capability
- 🔄 **Square OAuth** — Per-tenant Square credential provisioning via OAuth flow
- 📊 **Tenant Lifecycle** — State machine: `trial → active → paused → suspended → deleted`
- ♻️ **Soft Delete & Restore** — Tenants can be deleted and restored with full cascade handling
- ⏱️ **Trial Expiration** — Automated cron job expires trial tenants

### WPS / Starbucks Compliance
- ☕ **Approved Menu Naming** — Starbucks category names with trademark symbols (FRAPPUCCINO®, TEAVANA®)
- 📋 **WPS Catalog Seeding** — Dedicated `npm run seed-wps` for compliant Square catalog
- 🎨 **KDS WPS Theme** — Starbucks Green (#00704A) theme for display screens
- 📏 **Logo Hierarchy** — Operator identity 2–4x larger than WPS Siren per brand guidelines

## 🛠 Technology Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript (strict mode) |
| **Database** | Supabase (PostgreSQL) with Row-Level Security |
| **Payments** | Square Web Payments SDK + Square OAuth |
| **Server State** | TanStack React Query |
| **Styling** | Tailwind CSS 4 |
| **Animations** | Framer Motion |
| **Email** | Resend |
| **AI** | OpenAI (invoice parsing & data extraction) |
| **PDF** | pdf-lib (PO generation), pdfjs-dist (invoice parsing) |
| **Forms** | React Hook Form + Zod validation |
| **Auth** | Supabase Auth with TOTP MFA |
| **Icons** | Lucide React |
| **Testing** | Playwright (E2E) |
| **Multi-tenancy** | Subdomain routing, RLS tenant isolation, in-memory tenant cache |

## 📋 Prerequisites

- Node.js 20+
- npm
- Square Developer Account (sandbox and/or production)
- Supabase Account
- Resend Account (for emails)
- OpenAI API Key (for invoice processing)

## 🚀 Getting Started

### 1. Installation

```bash
npm install
```

### 2. Environment Setup

Create a `.env.local` file:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SECRET_KEY=your_supabase_secret_key

# Square
SQUARE_ENVIRONMENT=sandbox  # or 'production'
SQUARE_APPLICATION_ID=your_square_application_id
SQUARE_ACCESS_TOKEN=your_square_access_token
SQUARE_LOCATION_ID=your_square_location_id
SQUARE_SECRET=your_square_oauth_app_secret
SQUARE_WEBHOOK_SIGNATURE_KEY=your_webhook_signature_key

# OpenAI (invoice processing)
OPENAI_API_KEY=your_openai_api_key

# Email
RESEND_API_KEY=your_resend_api_key

# KDS Google Sheets Data Sources
KDS_MENU_CSV_URL=your_google_sheets_csv_url
KDS_CATEGORIES_CSV_URL=your_google_sheets_csv_url

# Application
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 3. Database Setup

Link to your Supabase project and apply migrations:

```bash
npm run db:link
npm run db:migrate
```

The database includes 55+ migrations covering tenants, inventory, KDS, COGS, purchase orders, invoices, and more. See [Database Schema](#-database-schema) for details.

### 4. Development

```bash
# Start dev server (recommended — uses webpack)
npm run dev:webpack

# Alternative (Turbopack — may have API runtime issues)
npm run dev

# Build for production
npm run build

# Lint
npm run lint
```

### 5. Square Integration Setup

```bash
# Seed Square catalog with menu items
npm run seed-square

# Or seed WPS/Starbucks-compliant catalog
npm run seed-wps

# Initialize sandbox tax configuration
npm run init-taxes

# Seed local inventory to match Square items
npm run seed-inventory
```

## 📁 Project Structure

```
website/
├── src/app/
│   ├── (site)/                     # Customer-facing pages
│   │   ├── menu/, cart/, checkout/ # Ordering flow
│   │   ├── orders/[id]/           # Order tracking
│   │   ├── auth/, profile/        # Authentication & profile
│   │   ├── about/, contact/       # Info pages
│   │   ├── gallery/, favorites/   # Gallery & favorites
│   │   └── notifications/         # User notifications
│   │
│   ├── admin/
│   │   ├── login/                 # Admin login with AdminLoginForm
│   │   ├── (protected)/           # requireAdmin() gate
│   │   │   ├── dashboard/         # Analytics dashboard
│   │   │   ├── orders/, customers/
│   │   │   ├── menu/, inventory/
│   │   │   ├── purchase-orders/   # Full PO workflow
│   │   │   ├── invoices/          # AI-powered invoice processing
│   │   │   ├── suppliers/         # Supplier management
│   │   │   ├── cogs/              # Cost of goods sold
│   │   │   ├── analytics/         # Business analytics
│   │   │   └── settings/          # System configuration
│   │   └── (kds)/                 # Admin-editable KDS screens
│   │       └── kds/drinks/, kds/food/
│   │
│   ├── kds/                       # Public TV display screens
│   │   ├── drinks/, food/         # Menu board pages
│   │   └── components/            # 20+ KDS display components
│   │
│   ├── platform/                  # Multi-tenant control plane
│   │   └── tenants/               # List, create, edit, manage tenants
│   │       ├── new/               # Onboarding wizard
│   │       └── [tenantId]/        # Tenant detail & status management
│   │
│   ├── mfa-enroll/                # TOTP enrollment
│   ├── mfa-challenge/             # TOTP challenge
│   ├── under-construction/        # Maintenance mode
│   │
│   └── api/
│       ├── admin/                 # Protected admin API endpoints
│       │   ├── cogs/              # 8 sub-routes (periods, recipes, reports...)
│       │   ├── inventory/         # Stock, sync, alerts, analytics
│       │   ├── purchase-orders/   # CRUD + receipts + metrics
│       │   ├── invoices/          # Upload + AI parsing + matching
│       │   ├── suppliers/, orders/, customers/
│       │   ├── menu/, dashboard/, settings/
│       │   └── kds/               # KDS data management
│       ├── platform/
│       │   └── square-oauth/      # OAuth authorize + callback
│       ├── square/                # Payments, catalog, config
│       ├── webhooks/square/       # Catalog & inventory sync webhooks
│       └── orders/, menu/, favorites/, notifications/
│
├── src/components/                # Reusable UI components
├── src/lib/
│   ├── supabase/                  # Client, server, service role clients
│   ├── square/                    # Square SDK clients & domain operations
│   ├── tenant/                    # Tenant resolution, cache, identity
│   ├── platform/                  # Platform admin auth
│   └── services/                  # Service layer
├── src/providers/                 # React context providers
├── src/types/                     # TypeScript type definitions
│
├── scripts/                       # CLI tools & seeders
├── supabase/migrations/           # 55+ SQL migrations
├── data/                          # CSV exports, templates
├── doc/                           # Architecture & workflow documentation
└── public/images/                 # Static assets
```

## 🗄 Database Schema

The database uses Supabase (PostgreSQL) with Row-Level Security enforcing tenant isolation via `tenant_id` on every table.

| Group | Tables |
|-------|--------|
| **Multi-tenant** | `tenants`, `tenant_memberships`, `platform_admins`, `tenant_pending_invites` |
| **Core** | `profiles`, `orders`, `order_items`, `site_settings` |
| **Inventory** | `inventory_items`, `stock_movements`, `low_stock_alerts`, `inventory_counts` |
| **Purchasing** | `purchase_orders`, `purchase_order_items`, `purchase_order_receipts`, `purchase_order_status_history`, `supplier_email_templates` |
| **Invoices** | `invoices`, `invoice_items`, `order_invoice_matches` |
| **COGS** | `cogs_periods`, `cogs_reports`, `cogs_products`, `cogs_sellables`, `inventory_valuations`, `modifier_sets`, `modifier_options`, `modifier_option_recipes` |
| **KDS** | `kds_categories`, `kds_menu_items`, `kds_settings`, `kds_images` |
| **Sales** | `sales_transactions`, `sales_transaction_items`, `inventory_sales_sync_runs` |
| **Suppliers** | `suppliers` |
| **System** | `webhook_events`, `notifications` |

## 🔧 Key Systems

### Multi-Tenant Architecture
- **Shared database** with `tenant_id` column on every table
- **RLS policies** enforce `tenant_id = current_setting('app.tenant_id')` on all queries
- **Middleware** extracts subdomain → resolves tenant → sets cookies → PostgREST hook calls `set_config('app.tenant_id', ...)`
- **In-memory cache** avoids DB lookup per request for tenant resolution
- **Tenant-scoped unique constraints** prevent cross-tenant slug/name collisions
- Bare localhost (no subdomain) falls back to the default tenant (`littlecafe`)

### Kitchen Display System
- **Data pipeline**: Square Catalog → `npm run export-kds-menu` → Google Sheets (human editing) → `npm run import-kds-menu` → Supabase → KDS pages
- **Pages use `force-dynamic`** to avoid stale cached data (`revalidate = 300` causes issues otherwise)
- **Theme selection** via `?theme=warm|dark|wps` URL parameter or `kds_settings` DB value
- **Component library**: 20+ purpose-built components (grids, panels, headers, image rotators, size headers, etc.)

### Square Integration
- **Bidirectional sync** via real-time webhooks for catalog and inventory updates
- **Per-tenant credentials** stored in the `tenants` table (not environment variables for multi-tenant)
- **OAuth flow** for onboarding new tenants with Square accounts
- **Webhook signature verification** for secure processing
- **Sandbox/production** environment switching

### Purchase Order Workflow
- **Status lifecycle**: `draft → pending_approval → approved → sent → received / cancelled`
- **PDF generation** for supplier issuance via pdf-lib
- **Email to suppliers** via Resend with PDF attachment
- **Partial receipt logging** with quantity validation and automatic inventory increment
- **Invoice matching** with AI-powered parsing and variance tracking
- **Supplier scorecards**: on-time %, spend analysis, cycle time metrics

### AI-Powered Features
- **Invoice processing** — OCR and AI extraction of invoice data using OpenAI
- **Smart matching** — Automatically match invoice items to purchase orders and inventory
- **Variance detection** — Flag discrepancies between PO and invoice amounts

## 📜 Available Scripts

### Development
| Command | Description |
|---------|-------------|
| `npm run dev:webpack` | Start dev server with webpack (recommended) |
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |

### Database
| Command | Description |
|---------|-------------|
| `npm run db:migrate` | Push schema changes to Supabase |
| `npm run db:reset` | Reset database |
| `npm run db:generate` | Generate TypeScript types from schema |
| `npm run db:link` | Link to Supabase project |

### Square
| Command | Description |
|---------|-------------|
| `npm run seed-square` | Seed Square catalog with menu items |
| `npm run seed-wps` | Seed WPS/Starbucks-compliant catalog |
| `npm run clear-and-reseed` | Clear and reseed Square catalog |
| `npm run clear-and-reseed-wps` | Clear and reseed WPS catalog |
| `npm run init-taxes` | Initialize Square sandbox tax config |
| `npm run debug-square` | Debug Square environment config |
| `npm run audit-square-mapping` | Audit Square inventory mapping |
| `npm run fix-square-mapping` | Fix Square inventory mapping issues |

### Inventory & COGS
| Command | Description |
|---------|-------------|
| `npm run seed-inventory` | Seed inventory items |
| `npm run setup-inventory` | Set up inventory system |
| `npm run upload-suppliers` | Bulk upload suppliers |
| `npm run import-cogs-recipes` | Import COGS recipes from Google Sheets |
| `npm run import-cogs-product-codes` | Import product code mappings from Sheets |
| `npm run export-cogs-product-codes-template` | Export product code mapping template |

### KDS (Kitchen Display)
| Command | Description |
|---------|-------------|
| `npm run export-kds-menu` | Export Square catalog to CSV for KDS editing |
| `npm run import-kds-menu` | Import KDS menu/categories from Google Sheets |

### Testing
| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run test:e2e:ui` | Run Playwright tests with UI |
| `npm run test:ai` | Test AI invoice parsing |

## 🔐 Security

- **Tenant Isolation** — Row-Level Security on every table with `tenant_id` enforcement
- **TOTP MFA** — Required for platform admin access (enrollment + challenge flow)
- **Role-based Access** — Dual-layer auth: `profiles.role` for admin routes, `tenant_memberships.role` (owner/admin/staff/customer) for tenant-scoped access
- **Platform Admin Gate** — Separate `platform_admins` table with auth + MFA + membership check
- **Webhook Signature Verification** — Square webhook processing validates HMAC signatures
- **Tenant-Scoped Unique Constraints** — Prevent cross-tenant data collisions
- **Soft Delete** — Tenants and inventory items support soft delete with restore capability
- **Service Client Separation** — `createClient()` (user-scoped, respects RLS) vs `createServiceClient()` (service role, bypasses RLS for system operations only)

## 🚀 Deployment

### Vercel (Application)

1. Push to GitHub
2. Import repository to Vercel
3. Add all environment variables (set `SQUARE_ENVIRONMENT=production` and production credentials)
4. Automatic deployment on every push

### KDS Displays

KDS screens are designed for always-on TV displays:

- **Raspberry Pi 4** — Chromium in `--kiosk` mode (see `doc/raspberry-pi-deployment.md`)
- **Fire TV** — Silk Browser in fullscreen
- **Smart TVs** — Built-in browser pointed at KDS URL
- **Theme override** — Append `?theme=warm` (or `dark`, `wps`) to the URL

## 📚 Documentation

Additional documentation in `doc/`:

| Document | Description |
|----------|-------------|
| `multi-tenant-saas-plan.md` | Multi-tenant SaaS architecture plan |
| `troubleshoot-square-oauth.md` | Square OAuth troubleshooting guide |
| `uat-tenant-onboarding.md` | Tenant onboarding UAT test plan |
| `kds-implementation-plan.md` | KDS system architecture |
| `kds-theme-system-plan.md` | KDS theme system design |
| `kds-tv-deployment.md` | KDS TV deployment guide |
| `raspberry-pi-deployment.md` | Raspberry Pi setup for KDS displays |
| `WPS-Starbucks-Compliance-Plan.md` | WPS branding compliance plan |
| `WPS-Mobile-Ordering-Guidelines.md` | WPS mobile ordering guidelines |
| `SQUARE_SETUP.md` | Square integration setup |
| `DATABASE_SETUP.md` | Database schema setup |
| `cogs-recipes-sheets.md` | COGS recipe workflow with Google Sheets |
| `cogs-product-codes-sheets.md` | COGS product codes workflow |
| `SECURITY.md` | Security documentation |

## ⚠️ Important Notes

- **Two Supabase Projects** — Dev and prod are separate Supabase instances. Always verify `.env.local` before running database operations.
- **Stale Data in Dev** — `revalidate = 300` causes stale data. KDS pages use `dynamic = 'force-dynamic'` to avoid this.
- **Square Config** — Fetched dynamically from `/api/square/config`, not hardcoded in client components.
- **KDS CSS** — Use `kds-themes.css` only. Legacy files (`kds-warm.css`, `kds.css`) are deprecated.

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| Dependency conflicts | `npm install --legacy-peer-deps` |
| Turbopack API issues | Use `npm run dev:webpack` instead |
| Stale KDS data | Ensure `dynamic = 'force-dynamic'` on KDS pages |
| Square webhook failures | Verify webhook URLs are accessible and signature keys match |
| MFA enrollment loop | Check `platform_admins` table has an entry for the user |

---

**Cafe Web Platform** — Multi-tenant cafe management ☕
