# Phase 20 Context: Schema Migration — Add tenant_id

## Goals
- Add `tenant_id` column to all tenant-scoped tables (46 of 49)
- Backfill all existing data to the default Little Cafe tenant
- Add NOT NULL constraints, FK constraints, and indexes
- Keep the running app functional on the default tenant throughout

## Table Scoping

### Global (NO tenant_id) — 3 tables
| Table | Reason |
|-------|--------|
| `profiles` | Users are global. Tenant access controlled via `tenant_memberships`. |
| `tenants` | The tenant registry itself. |
| `tenant_memberships` | Already has `tenant_id` from Phase 10. |

### Tenant-scoped (GETS tenant_id) — 46 tables
Every other table, including:
- **Orders:** `orders`, `order_items`
- **User data:** `user_favorites`, `user_addresses`, `notifications`
- **Inventory:** `inventory_items`, `stock_movements`, `inventory_settings`, `inventory_locations`, `inventory_unit_types`, `low_stock_alerts`, `inventory_sales_sync_runs`, `inventory_item_cost_history`, `inventory_valuations`
- **Purchase orders:** `purchase_orders`, `purchase_order_items`, `purchase_order_status_history`, `purchase_order_attachments`, `purchase_order_receipts`
- **Invoices:** `invoices`, `invoice_items`, `order_invoice_matches`, `supplier_invoice_templates`, `invoice_import_sessions`
- **Suppliers:** `suppliers`, `supplier_email_templates`
- **COGS:** `cogs_periods`, `cogs_reports`, `cogs_products`, `cogs_sellables`, `cogs_sellable_aliases`, `cogs_product_recipes`, `cogs_product_recipe_lines`, `cogs_sellable_recipe_overrides`, `cogs_sellable_recipe_override_ops`, `cogs_modifier_sets`, `cogs_modifier_options`, `cogs_modifier_option_recipes`, `cogs_modifier_option_recipe_lines`
- **KDS:** `kds_categories`, `kds_menu_items`, `kds_settings`, `kds_images`
- **Sales:** `sales_transactions`, `sales_transaction_items`
- **Recipes:** `recipe_ingredients`
- **Webhooks:** `webhook_events` (tenant resolved from `merchant_id`)
- **Config:** `site_settings`

### Key Scoping Principles
- `tenant_id` on **every** table in FK chains — no relying on parent joins for scope
- Users are global; their data (orders, favorites, notifications) is per-tenant
- Even where other columns identify tenant (e.g., `location_id` on `sales_transactions`), add `tenant_id` for consistency
- Notifications are tenant-scoped: user sees only notifications for current tenant

## Backfill Strategy

### Default Tenant
- UUID: `00000000-0000-0000-0000-000000000001` (Little Cafe, created in Phase 10)
- All existing rows get this tenant_id

### Technique
- `ALTER TABLE ADD COLUMN tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'` — Postgres fills all rows instantly via default mechanism
- Respect FK ordering: backfill parent tables before children
- For empty tables: same approach (DEFAULT handles future inserts too)

### Constraints
- **FK constraint:** `REFERENCES tenants(id) ON DELETE RESTRICT` — can't delete a tenant that has data
- **NOT NULL:** Added after backfill
- **Index:** Single-column btree on `tenant_id` per table (composite indexes deferred to optimize later)
- **DEFAULT kept:** `'00000000-0000-0000-0000-000000000001'` stays as default until Phase 40 so existing app code keeps working

### Rollback
- Reverse migration script (DROP COLUMN) as rollback mechanism
- No Supabase point-in-time recovery needed

## Migration Staging

### Three Staged Migrations
Located in `supabase/migrations/`

**Stage 1: Add columns**
- One SQL file with all 46 `ALTER TABLE ADD COLUMN` statements
- Column: `tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'`
- Manual checkpoint after: verify all columns added, all rows backfilled

**Stage 2: Add constraints**
- Drop DEFAULT (no — keep it for app compatibility, see App Transition)
- Add `NOT NULL` constraint
- Add `FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT`
- Manual checkpoint after: verify constraints in place, no NULL violations

**Stage 3: Add indexes**
- `CREATE INDEX CONCURRENTLY` on `tenant_id` for all 46 tables
- Non-blocking index creation
- Manual checkpoint after: verify all indexes created

### Target Database
- Dev only: `ofppjltowsdvojixeflr`
- Prod migration is a separate future concern

### Script Format
- Raw SQL scripts in `supabase/migrations/`
- NOT using `apply_migration` MCP tool — manual application

## App Transition

### What Phase 20 Does NOT Change
- No SELECT query changes — filtering by tenant_id is Phase 30 (RLS)
- No service role query changes — explicit tenant_id filtering is Phase 30+
- No app code changes — INSERT/UPDATE logic unchanged

### DEFAULT Behavior
- `DEFAULT '00000000-0000-0000-0000-000000000001'` stays on all tenant_id columns
- Existing app code continues inserting without specifying tenant_id
- DEFAULT removed in **Phase 40** when app code becomes tenant-aware

### Type Generation
- Regenerate TypeScript types after migration: `npm run db:generate`
- New types will include `tenant_id` on all scoped tables

## Verification Criteria

### Data Integrity
- `COUNT(*) WHERE tenant_id IS NULL = 0` for all 46 tables
- Row counts match before/after migration (no data loss)

### App Functionality
- `npm run build` passes (no TypeScript errors after type regeneration)
- Dev app boots and pages load on default tenant
- Manual smoke test: navigate key pages, verify data displays correctly

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| profiles scoping | Global (no tenant_id) | Users belong to multiple tenants via memberships |
| tenant_id depth | Every table in FK chains | Simple RLS policies, no join-based scoping |
| Backfill technique | ALTER + DEFAULT | Instant backfill, minimal locking |
| FK constraint | ON DELETE RESTRICT | Prevent accidental tenant deletion |
| Index strategy | Single-column btree | Optimize with composites later based on query patterns |
| Migration count | 3 staged migrations | Clean checkpoints between add/constrain/index |
| Script location | supabase/migrations/ | Standard Supabase convention |
| Stage 1 format | One file, 46 statements | Atomic, easy to review |
| DEFAULT retention | Keep until Phase 40 | App code doesn't change in Phase 20 |
| SELECT/service changes | None in Phase 20 | Phase 30 handles query scoping |
| Verification | Build + manual smoke test | Confirms both type safety and runtime behavior |
| Rollback | Reverse migration (DROP COLUMN) | Simple, no PITR needed |

## Deferred Items
- Composite indexes on (tenant_id, ...) — optimize based on query patterns in later phases
- DEFAULT removal — Phase 40 when app code is tenant-aware
- Prod migration — separate concern, not Phase 20 scope

## Open Questions
- None — all gray areas resolved
