# Phase 20: Schema Migration -- Add tenant_id - Research

**Researched:** 2026-02-13
**Domain:** PostgreSQL schema migration, Supabase migration conventions, multi-tenant column addition
**Confidence:** HIGH

## Summary

Phase 20 adds a `tenant_id uuid` column to 46 existing tables, backfills all rows with the default Little Cafe tenant UUID (`00000000-0000-0000-0000-000000000001`), adds NOT NULL and FK constraints, and creates btree indexes. The migration uses three staged SQL scripts applied manually to the dev database.

The approach is sound and well-supported by PostgreSQL. Since PostgreSQL 11, `ALTER TABLE ADD COLUMN ... DEFAULT <constant>` is a metadata-only operation that does not rewrite the table, making it effectively instant regardless of row count. The Supabase dev database runs PostgreSQL 17. The default tenant already exists in the `tenants` table from Phase 10 migrations.

The key technical concern is Stage 3: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, and Supabase CLI wraps each migration file in a transaction. Since the CONTEXT specifies manual application (not `supabase db push`), this can be handled by running Stage 3 directly via `psql` or the Supabase SQL Editor without transaction wrapping. Alternatively, each `CREATE INDEX CONCURRENTLY` statement can be placed in its own migration file.

**Primary recommendation:** Write three migration files for Stages 1-2, but Stage 3 (concurrent indexes) must either be applied manually outside a transaction or split into 46 individual migration files. Manual `psql` execution is simpler given the CONTEXT already specifies manual application.

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| PostgreSQL | 17 | Database engine | Supabase uses PG 17 for new projects; config.toml confirms `major_version = 17` |
| Supabase CLI | 2.33.9+ | Migration management | Already in project as `supabase` dev dependency |
| psql | (bundled) | Direct SQL execution | Needed for `CREATE INDEX CONCURRENTLY` outside transactions |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| Supabase SQL Editor | Run SQL directly on remote DB | Alternative to psql for manual migration application |
| `npm run db:generate` | Regenerate TypeScript types from schema | After all 3 stages complete |

## Architecture Patterns

### Three-Stage Migration Pattern
```
supabase/migrations/
├── 20260213100000_add_tenant_id_columns.sql        # Stage 1: ADD COLUMN with DEFAULT
├── 20260213100001_add_tenant_id_constraints.sql     # Stage 2: NOT NULL + FK
└── 20260213100002_add_tenant_id_indexes.sql         # Stage 3: CREATE INDEX (see note)
```

**Stage 3 caveat:** If applied via `supabase db push`, each `CREATE INDEX CONCURRENTLY` needs its own file because the CLI wraps each file in a transaction. If applied manually via psql/SQL Editor (as CONTEXT specifies), a single file works if executed without `BEGIN`/`COMMIT` wrapping.

### FK Dependency Tree (Parent-Before-Child Order)

The following ordering respects foreign key references. Tables at each tier depend only on tables in earlier tiers or on global tables (profiles, tenants). Within each tier, order does not matter.

**Tier 0 -- Standalone tables (no FK to other tenant-scoped tables)**
These reference only auth.users or profiles (global tables):
1. `orders`
2. `suppliers`
3. `inventory_locations`
4. `inventory_unit_types`
5. `inventory_settings`
6. `notifications`
7. `webhook_events`
8. `site_settings`
9. `user_favorites`
10. `user_addresses`
11. `cogs_periods`
12. `cogs_products`
13. `cogs_modifier_sets`

**Tier 1 -- Reference Tier 0 tables**
14. `order_items` (references `orders`)
15. `inventory_items` (references `suppliers`)
16. `purchase_orders` (references `suppliers`)
17. `invoices` (references `suppliers`)
18. `supplier_email_templates` (references `suppliers`)
19. `cogs_reports` (references `cogs_periods`)
20. `cogs_sellables` (references `cogs_products`)
21. `cogs_modifier_options` (references `cogs_modifier_sets`)
22. `inventory_sales_sync_runs` (references `profiles` -- global, no issue)
23. `kds_categories` (standalone)
24. `sales_transactions` (references `inventory_sales_sync_runs`)

**Tier 2 -- Reference Tier 1 tables**
25. `stock_movements` (references `inventory_items`)
26. `purchase_order_items` (references `purchase_orders`, `inventory_items`)
27. `low_stock_alerts` (references `inventory_items`)
28. `recipe_ingredients` (references `inventory_items`)
29. `invoice_items` (references `invoices`, `inventory_items`)
30. `order_invoice_matches` (references `purchase_orders`, `invoices`)
31. `supplier_invoice_templates` (references `suppliers`)
32. `invoice_import_sessions` (references `invoices`)
33. `inventory_valuations` (references `cogs_periods`, `inventory_items`)
34. `inventory_item_cost_history` (references `inventory_items`)
35. `cogs_sellable_aliases` (references `cogs_sellables`)
36. `cogs_product_recipes` (references `cogs_products`)
37. `cogs_sellable_recipe_overrides` (references `cogs_sellables`)
38. `cogs_modifier_option_recipes` (references `cogs_modifier_options`)
39. `kds_menu_items` (references `kds_categories`)
40. `kds_settings` (standalone key-value)
41. `kds_images` (standalone)
42. `sales_transaction_items` (references `sales_transactions`, `inventory_items`)

**Tier 3 -- Reference Tier 2 tables**
43. `purchase_order_status_history` (references `purchase_orders`)
44. `purchase_order_attachments` (references `purchase_orders`)
45. `purchase_order_receipts` (references `purchase_orders`, `purchase_order_items`)
46. `cogs_product_recipe_lines` (references `cogs_product_recipes`, `inventory_items`)
47. `cogs_sellable_recipe_override_ops` (references `cogs_sellable_recipe_overrides`, `inventory_items`)
48. `cogs_modifier_option_recipe_lines` (references `cogs_modifier_option_recipes`, `inventory_items`)

**Important note:** For `ALTER TABLE ADD COLUMN`, the FK dependency order matters only for Stage 2 (adding FK constraints). Stage 1 just adds columns with defaults and has no ordering requirement. Stage 3 (indexes) also has no ordering requirement.

### Anti-Patterns to Avoid
- **Wrapping Stage 3 in BEGIN/COMMIT:** `CREATE INDEX CONCURRENTLY` fails inside any transaction block.
- **Using `ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT ...` in one step:** While Postgres 17 supports this, separating the NOT NULL constraint into Stage 2 provides a clean checkpoint to verify backfill before constraining.
- **Dropping DEFAULT in Phase 20:** The DEFAULT must stay so existing app code (which doesn't specify tenant_id on INSERTs) continues working. DEFAULT is removed in Phase 40.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Backfill existing rows | UPDATE statements for each table | `ALTER TABLE ADD COLUMN ... DEFAULT` | PG 11+ metadata-only operation; UPDATE would lock tables and be slow |
| Non-blocking indexes | Regular `CREATE INDEX` | `CREATE INDEX CONCURRENTLY` | Regular index creation acquires ACCESS EXCLUSIVE lock, blocking all reads/writes |
| Migration ordering | Custom dependency resolver | The tier ordering documented above | FK tree is static and known from schema inspection |
| NULL verification | Per-table manual queries | Single dynamic SQL query (see Code Examples) | 46 tables is too many to check individually |

## Common Pitfalls

### Pitfall 1: CREATE INDEX CONCURRENTLY in Transaction
**What goes wrong:** `CREATE INDEX CONCURRENTLY` fails with error: "cannot run inside a transaction block"
**Why it happens:** Supabase CLI wraps migration files in transactions. `CREATE INDEX CONCURRENTLY` requires multiple internal transactions and cannot execute inside a user-started transaction.
**How to avoid:** Apply Stage 3 manually via `psql` or Supabase SQL Editor (not via `supabase db push`). Do NOT wrap in `BEGIN`/`COMMIT`. Alternatively, place each `CREATE INDEX CONCURRENTLY` in its own migration file.
**Warning signs:** Error message mentioning "SQLSTATE 25001" or "cannot run inside a transaction block" or "cannot be executed within a pipeline."

### Pitfall 2: Failed Concurrent Index Leaves Invalid Index
**What goes wrong:** If `CREATE INDEX CONCURRENTLY` fails partway (deadlock, connection drop), the index remains in the catalog as "invalid." It is ignored for queries but still consumes write overhead.
**Why it happens:** The concurrent index build process uses multiple transactions; failure mid-process cannot cleanly roll back.
**How to avoid:** After each concurrent index creation, verify it succeeded. If an index is left invalid, drop it with `DROP INDEX IF EXISTS` and retry. Check for invalid indexes: `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`
**Warning signs:** Index exists but queries don't use it. `\di` shows the index but `pg_index.indisvalid = false`.

### Pitfall 3: Unique Constraints Block Multi-Tenant Data
**What goes wrong:** Many tables have single-column UNIQUE constraints (e.g., `suppliers.name`, `kds_settings.key`, `kds_categories.slug`, `inventory_locations.name`, `inventory_unit_types.symbol`, `webhook_events.event_id`, `cogs_products.square_item_id`, `cogs_sellables.square_variation_id`, `cogs_modifier_sets.square_modifier_list_id`, `cogs_modifier_options.square_modifier_id`, `cogs_sellable_aliases.square_variation_id`, `sales_transactions.square_order_id`, `kds_images.filename`). These prevent two tenants from having the same value in those columns.
**Why it happens:** Original schema was single-tenant; uniqueness was global.
**How to avoid:** This is NOT Phase 20 scope. Phase 20 only adds columns, constraints, and indexes. However, this must be documented as a known limitation that a later phase must address by converting `UNIQUE(column)` to `UNIQUE(tenant_id, column)`.
**Warning signs:** INSERT fails with unique violation when a second tenant tries to create data with the same name/key/slug as the first tenant.

### Pitfall 4: site_settings Singleton Pattern
**What goes wrong:** `site_settings` uses `id integer PRIMARY KEY DEFAULT 1` as a singleton (only one row). Adding `tenant_id` means each tenant needs its own row, but the `id` column is hardcoded to 1 throughout the codebase (`WHERE id = 1`, `.eq('id', 1)`).
**Why it happens:** Singleton pattern assumes one row globally.
**How to avoid:** Phase 20 just adds the column with DEFAULT. The existing row gets tenant_id but id stays 1. The singleton id pattern must be refactored in a later phase when queries become tenant-scoped (Phase 30+). For now, the single existing row gets the default tenant_id and the app continues to work unchanged.
**Warning signs:** When a second tenant is created, they would also need an `id = 1` row, which would conflict with the PK. This is a Phase 30+ concern.

### Pitfall 5: kds_settings Key Uniqueness
**What goes wrong:** `kds_settings` has `key text UNIQUE NOT NULL`. With multiple tenants, each tenant needs the same setting keys (e.g., 'image_rotation_interval'). The UNIQUE constraint prevents this.
**Why it happens:** Key-value pattern assumed single tenant.
**How to avoid:** Same as Pitfall 3 -- this UNIQUE constraint must become `UNIQUE(tenant_id, key)` in a later phase. Phase 20 only adds the column.
**Warning signs:** Cannot insert duplicate keys for a second tenant.

### Pitfall 6: Views Referencing Modified Tables
**What goes wrong:** Two views reference tables getting tenant_id: `po_supplier_metrics_v` and `view_pending_manual_inventory_deductions`. Adding a column to the underlying tables does not break views, but the views won't include tenant_id in their output.
**Why it happens:** Views in PostgreSQL use the column list from when they were created. Adding a column to a table doesn't automatically add it to `SELECT *` in the view (though in practice, the views here use explicit column references, not `*`).
**How to avoid:** No action needed in Phase 20. Views will continue to work. They should be updated in Phase 30 when RLS policies are rewritten, to include tenant filtering.
**Warning signs:** None in Phase 20. In Phase 30, cross-tenant data will appear in view results until the views are rewritten.

## Code Examples

### Stage 1: Add Columns (single migration file)
```sql
-- Source: Pattern from project's existing migrations + PG 17 ALTER TABLE behavior
-- All 46 ALTER TABLE statements in one file
-- No BEGIN/COMMIT needed -- each ALTER TABLE is atomic and instant (metadata-only)

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';

-- ... repeat for all 46 tables
```

**Key behavior:** With a constant DEFAULT, PostgreSQL 11+ stores the default in table metadata (`pg_attribute.attmissingval`). Existing rows are NOT rewritten. The value is returned on-the-fly during reads. This is effectively O(1) regardless of table size.

### Stage 2: Add Constraints (single migration file)
```sql
-- Can use BEGIN/COMMIT since no CONCURRENTLY involved
BEGIN;

-- Add NOT NULL constraint (safe because DEFAULT already populated all rows)
ALTER TABLE public.orders ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN tenant_id SET NOT NULL;
-- ... repeat for all 46 tables

-- Add FK constraints (respect tier ordering: parents before children)
ALTER TABLE public.orders
  ADD CONSTRAINT fk_orders_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.order_items
  ADD CONSTRAINT fk_order_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
-- ... repeat for all 46 tables

COMMIT;
```

### Stage 3: Add Indexes (NO transaction wrapping)
```sql
-- IMPORTANT: Do NOT wrap in BEGIN/COMMIT
-- IMPORTANT: Do NOT apply via supabase db push (it wraps in transaction)
-- Apply directly via psql or Supabase SQL Editor

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_id
  ON public.orders (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_tenant_id
  ON public.order_items (tenant_id);

-- ... repeat for all 46 tables
```

**Fallback if CONCURRENTLY fails:** Drop invalid index and retry:
```sql
-- Check for invalid indexes
SELECT indexrelid::regclass, indrelid::regclass
FROM pg_index WHERE NOT indisvalid;

-- Drop and retry
DROP INDEX IF EXISTS idx_orders_tenant_id;
CREATE INDEX CONCURRENTLY idx_orders_tenant_id ON public.orders (tenant_id);
```

### Verification Query: Check All Tables for NULL tenant_id
```sql
-- Dynamic query to check all 46 tables at once
DO $$
DECLARE
  tbl text;
  null_count bigint;
  tables text[] := ARRAY[
    'orders', 'order_items', 'user_favorites', 'user_addresses', 'notifications',
    'inventory_items', 'stock_movements', 'inventory_settings', 'inventory_locations',
    'inventory_unit_types', 'low_stock_alerts', 'inventory_sales_sync_runs',
    'inventory_item_cost_history', 'inventory_valuations',
    'purchase_orders', 'purchase_order_items', 'purchase_order_status_history',
    'purchase_order_attachments', 'purchase_order_receipts',
    'invoices', 'invoice_items', 'order_invoice_matches',
    'supplier_invoice_templates', 'invoice_import_sessions',
    'suppliers', 'supplier_email_templates',
    'cogs_periods', 'cogs_reports', 'cogs_products', 'cogs_sellables',
    'cogs_sellable_aliases', 'cogs_product_recipes', 'cogs_product_recipe_lines',
    'cogs_sellable_recipe_overrides', 'cogs_sellable_recipe_override_ops',
    'cogs_modifier_sets', 'cogs_modifier_options',
    'cogs_modifier_option_recipes', 'cogs_modifier_option_recipe_lines',
    'kds_categories', 'kds_menu_items', 'kds_settings', 'kds_images',
    'sales_transactions', 'sales_transaction_items',
    'recipe_ingredients', 'webhook_events', 'site_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE tenant_id IS NULL', tbl)
      INTO null_count;
    IF null_count > 0 THEN
      RAISE WARNING 'Table % has % rows with NULL tenant_id', tbl, null_count;
    ELSE
      RAISE NOTICE 'Table % OK (0 NULL tenant_id)', tbl;
    END IF;
  END LOOP;
END $$;
```

### Verification Query: Row Count Comparison
```sql
-- Run BEFORE migration to capture baseline
DO $$
DECLARE
  tbl text;
  row_count bigint;
  tables text[] := ARRAY[
    'orders', 'order_items', 'user_favorites', 'user_addresses', 'notifications',
    'inventory_items', 'stock_movements', 'inventory_settings', 'inventory_locations',
    'inventory_unit_types', 'low_stock_alerts', 'inventory_sales_sync_runs',
    'inventory_item_cost_history', 'inventory_valuations',
    'purchase_orders', 'purchase_order_items', 'purchase_order_status_history',
    'purchase_order_attachments', 'purchase_order_receipts',
    'invoices', 'invoice_items', 'order_invoice_matches',
    'supplier_invoice_templates', 'invoice_import_sessions',
    'suppliers', 'supplier_email_templates',
    'cogs_periods', 'cogs_reports', 'cogs_products', 'cogs_sellables',
    'cogs_sellable_aliases', 'cogs_product_recipes', 'cogs_product_recipe_lines',
    'cogs_sellable_recipe_overrides', 'cogs_sellable_recipe_override_ops',
    'cogs_modifier_sets', 'cogs_modifier_options',
    'cogs_modifier_option_recipes', 'cogs_modifier_option_recipe_lines',
    'kds_categories', 'kds_menu_items', 'kds_settings', 'kds_images',
    'sales_transactions', 'sales_transaction_items',
    'recipe_ingredients', 'webhook_events', 'site_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM public.%I', tbl) INTO row_count;
    RAISE NOTICE 'Table %: % rows', tbl, row_count;
  END LOOP;
END $$;
```

### Verification: Check All Indexes Valid
```sql
-- After Stage 3, verify no invalid indexes
SELECT
  c.relname AS index_name,
  t.relname AS table_name
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
WHERE NOT i.indisvalid
  AND c.relname LIKE 'idx_%_tenant_id';
```

### Rollback Script (DROP COLUMN)
```sql
-- Reverse migration: remove tenant_id from all 46 tables
-- Order doesn't matter for DROP COLUMN since FK constraints are dropped with the column

ALTER TABLE public.orders DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE public.order_items DROP COLUMN IF EXISTS tenant_id;
-- ... repeat for all 46 tables
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ALTER TABLE ADD COLUMN DEFAULT` rewrites table | Metadata-only, instant for constant defaults | PostgreSQL 11 (2018) | No table rewrite, no locking, O(1) |
| `CREATE INDEX` blocks reads/writes | `CREATE INDEX CONCURRENTLY` | PostgreSQL 8.2+ | Non-blocking but cannot run in transaction |
| Supabase CLI allowed CONCURRENTLY in pipeline | CLI correctly rejects it | Supabase CLI 1.223.1+ / PG 15.6+ | Must use separate files or manual execution |

**Deprecated/outdated:**
- Manual UPDATE for backfill: Not needed since PG 11; `ALTER TABLE ADD COLUMN ... DEFAULT` handles it
- `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT ...` in one step: Works but separating into stages provides verification checkpoints

## Special Table Considerations

### site_settings (Singleton Pattern)
- Uses `id integer PRIMARY KEY DEFAULT 1` as singleton
- App code queries with `.eq('id', 1)` or `WHERE id = 1`
- Adding `tenant_id` with DEFAULT works fine for the existing single row
- Future concern: second tenant would need its own row, but can't have `id = 1` due to PK
- Resolution deferred to Phase 30+: change PK strategy or use `tenant_id` in WHERE clause

### inventory_settings (Singleton Pattern)
- Has UUID primary key but only ever has one row
- App code queries with `.limit(1).single()`
- Adding `tenant_id` with DEFAULT works fine for Phase 20
- Future concern: second tenant would need their own settings row
- The UUID PK is fine (unlike site_settings integer PK), so no PK conflict

### kds_settings (Key-Value Pattern)
- Uses `key text UNIQUE NOT NULL` with rows like `image_rotation_interval`, `refresh_interval`, etc.
- Adding `tenant_id` with DEFAULT: works for existing rows
- Future concern: UNIQUE on `key` prevents same key for different tenants
- Must become `UNIQUE(tenant_id, key)` in a later phase

### kds_categories (Position Uniqueness)
- Has `CONSTRAINT kds_categories_unique_position UNIQUE (screen, position)`
- Adding `tenant_id`: works for Phase 20
- Future concern: must become `UNIQUE(tenant_id, screen, position)` so each tenant can have their own category layout

### TypeScript Types
- Project uses **hand-crafted TypeScript types** in `src/types/`, NOT auto-generated Supabase types
- `npm run db:generate` outputs to stdout (`npx supabase gen types typescript --local` with no `--output` flag)
- The Supabase client is untyped (`createBrowserClient(url, key)` with no generic type parameter)
- Adding `tenant_id` to tables will NOT cause TypeScript build errors because:
  - Hand-crafted types don't include `tenant_id` yet
  - Supabase client queries return `any`-typed results cast to hand-crafted interfaces
  - The extra column is simply ignored by existing code
- After Phase 20: run `npm run db:generate > src/types/database.ts` if desired, but not required
- `npm run build` should pass without changes since existing types are unaffected

## Open Questions

1. **Stage 3 execution method**
   - What we know: `CREATE INDEX CONCURRENTLY` cannot run in a transaction; Supabase CLI wraps migrations in transactions; CONTEXT says "manual application"
   - What's unclear: Will the user apply via `psql`, Supabase SQL Editor, or the CLI? If CLI, 46 separate files are needed.
   - Recommendation: Document both approaches. Recommend SQL Editor for simplicity (no psql setup needed). Note that the indexes can also be created as regular (non-concurrent) indexes if downtime is acceptable on a dev database.

2. **Regular vs Concurrent indexes on dev**
   - What we know: `CREATE INDEX CONCURRENTLY` is a production best practice to avoid blocking reads/writes
   - What's unclear: On a dev database with minimal traffic, regular `CREATE INDEX` may be simpler
   - Recommendation: Use regular `CREATE INDEX` (without CONCURRENTLY) for dev. This avoids the transaction limitation entirely. Save CONCURRENTLY for the prod migration script. The CONTEXT lists CONCURRENTLY, so document the tradeoff and let the planner decide.

3. **Unique constraint migration timing**
   - What we know: 15+ tables have single-column UNIQUE constraints that will block multi-tenant data
   - What's unclear: Which phase converts these to composite `(tenant_id, column)` constraints
   - Recommendation: Phase 20 should NOT modify unique constraints. Document as a prerequisite for Phase 30 or whenever a second tenant is created.

## Sources

### Primary (HIGH confidence)
- Project codebase: All 55+ migration files in `supabase/migrations/` examined
- Project codebase: `supabase/config.toml` confirms `major_version = 17`
- Project codebase: `src/lib/supabase/server.ts`, `src/types/settings.ts`, `src/lib/kds/queries.ts` examined
- [PostgreSQL 17 CREATE INDEX documentation](https://www.postgresql.org/docs/17/sql-createindex.html) -- CONCURRENTLY limitations
- [brandur.org: Fast Column Creation with Defaults](https://brandur.org/postgres-default) -- PG 11 metadata-only behavior

### Secondary (MEDIUM confidence)
- [Supabase CLI Issue #2898](https://github.com/supabase/cli/issues/2898) -- CREATE INDEX CONCURRENTLY in migration files
- [Supabase Upgrading Docs](https://supabase.com/docs/guides/platform/upgrading) -- PG 15/17 support

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- PostgreSQL 17 behavior verified via official docs and existing project config
- Architecture (tier ordering): HIGH -- Derived from direct schema inspection of all migration files
- Pitfalls: HIGH -- Transaction limitation verified via official PG docs and Supabase CLI issue
- Special tables: HIGH -- Examined actual table definitions and app code usage patterns
- TypeScript impact: HIGH -- Verified project uses hand-crafted types, not auto-generated

**Research date:** 2026-02-13
**Valid until:** 2026-06-13 (stable domain, PostgreSQL behavior does not change between patch versions)
